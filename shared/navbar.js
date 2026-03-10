function detectBasePath() {
  const appRoots = new Set(['home', 'movies', 'tv', 'games', 'search', 'settings', 'random', 'test', 'shared', 'index.html']);

  const scriptSrc = document.currentScript?.src;
  if (scriptSrc) {
    try {
      const scriptPath = new URL(scriptSrc, window.location.href).pathname;
      const sharedIndex = scriptPath.lastIndexOf('/shared/');
      if (sharedIndex >= 0) {
        const prefix = scriptPath.slice(0, sharedIndex);
        return prefix || '';
      }
    } catch {
      // Fall back to pathname parsing.
    }
  }

  const parts = window.location.pathname.split('/').filter(Boolean);
  if (!parts.length || appRoots.has(parts[0])) return '';
  if (parts.length > 1 && appRoots.has(parts[1])) return `/${parts[0]}`;
  return '';
}

const BASE_PATH = detectBasePath();

function withBase(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${BASE_PATH}${normalized}`;
}
function loadAuthScript() {
  return new Promise((resolve, reject) => {
    if (window.bilmAuth) {
      resolve(window.bilmAuth);
      return;
    }
    const src = withBase('/shared/auth.js');
    const existing = document.querySelector(`script[data-bilm-auth="${src}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.bilmAuth), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load auth module.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.dataset.bilmAuth = src;
    script.addEventListener('load', () => resolve(window.bilmAuth), { once: true });
    script.addEventListener('error', () => reject(new Error('Failed to load auth module.')), { once: true });
    document.head.appendChild(script);
  });
}

(async () => {
  const container = document.getElementById('navbar-placeholder') || document.getElementById('navbarContainer');
  if (!container) return;

  document.body.classList.add('has-fixed-navbar');

  const shadow = container.shadowRoot || container.attachShadow({ mode: 'open' });

  let html = '';
  let css = '';
  try {
    const [htmlRes, cssRes] = await Promise.all([
      fetch(withBase('/shared/navbar.html')),
      fetch(withBase('/shared/navbar.css'))
    ]);

    if (!htmlRes.ok || !cssRes.ok) {
      throw new Error(`Navbar assets failed to load (html=${htmlRes.status}, css=${cssRes.status})`);
    }

    html = await htmlRes.text();
    css = await cssRes.text();
  } catch (error) {
    console.error('Failed to load navbar assets:', error);
    document.body.classList.remove('has-fixed-navbar');
    return;
  }

  shadow.innerHTML = `<style>${css}</style>${html}`;

  const globalBanner = shadow.getElementById('globalBanner');
  const globalBannerCloseBtn = shadow.getElementById('globalBannerCloseBtn');


  const chatWidget = shadow.getElementById('sharedChatWidget');
  const chatToggle = shadow.getElementById('sharedChatToggle');
  const chatPanel = shadow.getElementById('sharedChatPanel');
  const chatClose = shadow.getElementById('sharedChatClose');
  const chatForm = shadow.getElementById('sharedChatForm');
  const chatInput = shadow.getElementById('sharedChatInput');
  const chatRefreshBtn = shadow.getElementById('sharedChatRefreshBtn');
  const CHAT_REFRESH_COOLDOWN_MS = 5000;
  const CHAT_ACTIVE_POLL_MS = 4000;
  const CHAT_BACKGROUND_POLL_MS = 10000;
  let chatRefreshCooldownUntil = 0;
  const chatMessages = shadow.getElementById('sharedChatMessages');
  let chatCurrentUser = null;
  let chatRemoteMessages = [];
  let chatPendingMessages = [];
  let authApiInstance = null;
  let chatRetryTimer = null;
  let chatLivePollTimer = null;
  let chatLivePollInFlight = false;
  const CHAT_STORAGE_KEY = 'bilm-shared-chat';
  const CHAT_MAX_RETRY_DELAY_MS = 30000;


  function setChatNotice(message) {
    if (!chatMessages) return;
    if (!message) {
      renderChatMessages(composeVisibleChatMessages());
      return;
    }
    chatMessages.innerHTML = '';
    const notice = document.createElement('p');
    notice.className = 'shared-chat-empty';
    notice.textContent = message;
    chatMessages.appendChild(notice);
  }

  function formatChatTime(ts) {
    const value = Number(ts || 0) || Date.now();
    return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function normalizeChatMessages(messages = []) {
    return messages
      .map((entry) => ({
        ...entry,
        createdAtMs: Number(entry?.createdAtMs || Date.now()) || Date.now(),
        text: String(entry?.text || ''),
        author: String(entry?.author || 'Account')
      }))
      .filter((entry) => entry.text.trim().length > 0)
      .sort((a, b) => a.createdAtMs - b.createdAtMs);
  }

  function composeVisibleChatMessages() {
    return normalizeChatMessages([...(chatRemoteMessages || []), ...(chatPendingMessages || [])]);
  }

  function loadStoredChatMessages() {
    const stored = storage.getJSON(CHAT_STORAGE_KEY, []);
    return normalizeChatMessages(Array.isArray(stored) ? stored : []);
  }

  function saveStoredChatMessages(messages) {
    const normalized = normalizeChatMessages(messages).slice(-120);
    storage.setJSON(CHAT_STORAGE_KEY, normalized);
    chatRemoteMessages = normalized;
  }

  function refreshChatMessages() {
    chatRemoteMessages = loadStoredChatMessages();
    renderChatMessages(composeVisibleChatMessages());
  }

  function getChatSyncErrorMessage(errorLike) {
    const code = String(errorLike?.code || errorLike?.error || '').toLowerCase();
    if (code === 'token_expired') return 'Session expired. Please sign in again.';
    if (code === 'missing_token' || code === 'forbidden' || code === 'invalid_token') return 'Not authorized. Please sign in again.';
    if (code === 'chat_message_too_large') return 'Message is too long (max 2000 characters).';
    if (code === 'chat_rate_limited') return 'Chat is rate limited right now. Retrying soon.';
    if (code === 'chat_payload_invalid') return 'Message format is invalid.';
    if (errorLike?.status >= 500) return 'Chat server is having trouble. Retrying...';
    if (errorLike?.retryable === false) return String(errorLike?.message || 'Chat sync failed.');
    return String(errorLike?.message || 'Network issue while sending chat. Retrying...');
  }

  function setPendingChat(nextPending) {
    const pendingId = String(nextPending?.id || '').trim();
    if (!pendingId) return;
    let replaced = false;
    chatPendingMessages = chatPendingMessages.map((entry) => {
      if (entry.id !== pendingId) return entry;
      replaced = true;
      return { ...entry, ...nextPending };
    });
    if (!replaced) {
      chatPendingMessages.push({ ...nextPending });
    }
  }

  function removePendingChat(pendingId) {
    chatPendingMessages = chatPendingMessages.filter((entry) => entry.id !== pendingId);
  }

  function schedulePendingChatRetry() {
    if (chatRetryTimer) return;
    const nextPending = chatPendingMessages.find((entry) => entry.pending && entry.failed && entry.retryable !== false);
    if (!nextPending) return;
    const delayMs = Math.min(CHAT_MAX_RETRY_DELAY_MS, Math.max(1200, Number(nextPending.retryDelayMs || 1200)));
    chatRetryTimer = window.setTimeout(() => {
      chatRetryTimer = null;
      attemptSendPendingChat(nextPending.id).catch((error) => {
        console.warn('Pending chat retry failed:', error);
      });
    }, delayMs);
  }

  async function pushChatOperation(entry) {
    if (!authApiInstance || typeof authApiInstance.pushSectorOperationsNow !== 'function') {
      const fallbackError = new Error('Chat sync API is unavailable.');
      fallbackError.code = 'chat_api_unavailable';
      fallbackError.retryable = true;
      throw fallbackError;
    }

    const itemKey = `chat:${entry.id}`;
    await authApiInstance.pushSectorOperationsNow([{
      sectorKey: 'chat_messages',
      itemKey,
      deleted: false,
      updatedAtMs: Number(entry.createdAtMs || Date.now()) || Date.now(),
      payload: {
        id: entry.id,
        key: itemKey,
        text: String(entry.text || ''),
        author: String(entry.author || 'Account'),
        authorUid: String(entry.authorUid || chatCurrentUser?.uid || 'local'),
        createdAtMs: Number(entry.createdAtMs || Date.now()) || Date.now(),
        updatedAt: Number(entry.createdAtMs || Date.now()) || Date.now()
      }
    }], 'chat-send');
  }

  async function attemptSendPendingChat(pendingId) {
    const pendingEntry = chatPendingMessages.find((entry) => entry.id === pendingId);
    if (!pendingEntry) return false;

    setPendingChat({
      ...pendingEntry,
      pending: true,
      failed: false,
      errorMessage: '',
      attemptCount: Number(pendingEntry.attemptCount || 0) + 1
    });
    renderChatMessages(composeVisibleChatMessages());

    try {
      await pushChatOperation(pendingEntry);
      const current = loadStoredChatMessages();
      const withoutDupe = current.filter((message) => String(message?.id || '').trim() !== pendingEntry.id);
      withoutDupe.push({
        id: pendingEntry.id,
        key: `chat:${pendingEntry.id}`,
        text: pendingEntry.text,
        author: pendingEntry.author,
        authorUid: pendingEntry.authorUid,
        createdAtMs: pendingEntry.createdAtMs,
        updatedAt: pendingEntry.createdAtMs
      });
      saveStoredChatMessages(withoutDupe);
      removePendingChat(pendingEntry.id);
      renderChatMessages(composeVisibleChatMessages());
      return true;
    } catch (error) {
      const retryable = error?.retryable !== false;
      const nextDelay = Math.min(
        CHAT_MAX_RETRY_DELAY_MS,
        Math.max(1200, Number(pendingEntry.retryDelayMs || 1200) * 2)
      );
      setPendingChat({
        ...pendingEntry,
        pending: true,
        failed: true,
        retryable,
        retryDelayMs: nextDelay,
        errorMessage: getChatSyncErrorMessage(error)
      });
      renderChatMessages(composeVisibleChatMessages());
      if (retryable) schedulePendingChatRetry();
      return false;
    }
  }

  function handleChatSyncIssue(issue) {
    if (!issue) return;
    const listKey = String(issue.listKey || '').trim();
    const sectorKey = String(issue.sectorKey || '').trim();
    if (listKey && listKey !== CHAT_STORAGE_KEY) return;
    if (sectorKey && sectorKey !== 'chat_messages') return;
    if (!chatPendingMessages.some((entry) => entry.pending)) return;

    const retryable = issue.retryable !== false;
    const message = getChatSyncErrorMessage(issue);
    chatPendingMessages = chatPendingMessages.map((entry) => {
      if (!entry.pending) return entry;
      return {
        ...entry,
        failed: true,
        retryable,
        errorMessage: message,
        retryDelayMs: Math.min(CHAT_MAX_RETRY_DELAY_MS, Math.max(1200, Number(entry.retryDelayMs || 1200) * 2))
      };
    });
    renderChatMessages(composeVisibleChatMessages());
    if (retryable) schedulePendingChatRetry();
  }

  function setChatRefreshCooldown() {
    if (!chatRefreshBtn) return;
    chatRefreshCooldownUntil = Date.now() + CHAT_REFRESH_COOLDOWN_MS;
    chatRefreshBtn.disabled = true;
    window.setTimeout(() => {
      if (!chatRefreshBtn) return;
      if (Date.now() < chatRefreshCooldownUntil) return;
      chatRefreshBtn.disabled = false;
      chatRefreshBtn.removeAttribute('aria-busy');
    }, CHAT_REFRESH_COOLDOWN_MS);
  }

  function renderChatMessages(messages = []) {
    if (!chatMessages) return;
    chatMessages.innerHTML = '';
    if (!messages.length) {
      const empty = document.createElement('p');
      empty.className = 'shared-chat-empty';
      empty.textContent = 'No messages yet.';
      chatMessages.appendChild(empty);
      return;
    }

    messages.forEach((entry) => {
      const row = document.createElement('article');
      row.className = 'shared-chat-message';

      const meta = document.createElement('div');
      meta.className = 'shared-chat-message-meta';

      const left = document.createElement('span');
      const author = String(entry.author || 'Account').trim() || 'Account';
      left.textContent = `${author} • ${formatChatTime(entry.createdAtMs)}`;

      const del = document.createElement('button');
      del.type = 'button';
      if (entry.pending && entry.failed) {
        del.textContent = entry.retryable === false ? 'Failed' : 'Retry';
      } else if (entry.pending) {
        del.textContent = 'Sending';
      } else {
        del.textContent = 'Delete';
      }
      del.disabled = Boolean(entry.pending && !entry.failed);
      del.addEventListener('click', async () => {
        if (entry.pending) {
          if (entry.failed && entry.retryable !== false) {
            await attemptSendPendingChat(entry.id);
          }
          return;
        }
        try {
          const current = loadStoredChatMessages();
          saveStoredChatMessages(current.filter((message) => message.id !== entry.id));
          renderChatMessages(composeVisibleChatMessages());
        } catch (error) {
          console.warn('Failed to delete chat message:', error);
        }
      });

      meta.append(left, del);

      const body = document.createElement('p');
      body.textContent = String(entry.text || '');

      row.append(meta, body);
      if (entry.pending && entry.failed && entry.errorMessage) {
        const errorText = document.createElement('p');
        errorText.className = 'shared-chat-empty';
        errorText.textContent = `Failed: ${entry.errorMessage}`;
        row.appendChild(errorText);
      }
      chatMessages.appendChild(row);
    });

    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function toggleChatPanel(nextOpen) {
    if (!chatPanel || !chatToggle) return;
    const open = Boolean(nextOpen);
    chatPanel.hidden = !open;
    chatToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open && chatInput) chatInput.focus();
    if (open) {
      triggerLiveChatPull('panel-open');
    }
    scheduleLiveChatPoll('panel-toggle');
  }

  function isChatPanelOpen() {
    return Boolean(chatPanel && chatPanel.hidden === false);
  }

  function getChatPollIntervalMs() {
    if (!chatCurrentUser) return CHAT_BACKGROUND_POLL_MS;
    const pageVisible = document.visibilityState === 'visible';
    const focused = document.hasFocus?.() === true;
    const active = pageVisible && focused && isChatPanelOpen();
    return active ? CHAT_ACTIVE_POLL_MS : CHAT_BACKGROUND_POLL_MS;
  }

  async function runLiveChatPull(reason = 'poll') {
    if (!authApiInstance || !chatCurrentUser || chatLivePollInFlight) return false;
    if (typeof authApiInstance.pullChatNow !== 'function') return false;
    chatLivePollInFlight = true;
    try {
      await authApiInstance.pullChatNow({ reason, limit: 120 });
      refreshChatMessages();
      return true;
    } catch (error) {
      console.warn(`Live chat pull failed (${reason}):`, error);
      return false;
    } finally {
      chatLivePollInFlight = false;
    }
  }

  function clearLiveChatPoll() {
    if (!chatLivePollTimer) return;
    window.clearTimeout(chatLivePollTimer);
    chatLivePollTimer = null;
  }

  function scheduleLiveChatPoll(reason = 'poll') {
    clearLiveChatPoll();
    if (!chatCurrentUser || !authApiInstance) return;
    const delayMs = getChatPollIntervalMs();
    chatLivePollTimer = window.setTimeout(async () => {
      chatLivePollTimer = null;
      await runLiveChatPull(reason);
      scheduleLiveChatPoll('loop');
    }, delayMs);
  }

  function triggerLiveChatPull(reason = 'manual') {
    runLiveChatPull(reason).finally(() => {
      scheduleLiveChatPoll('after-pull');
    });
  }

  // Always start collapsed on a fresh page load.
  toggleChatPanel(false);

  if (chatToggle) {
    chatToggle.addEventListener('click', () => {
      toggleChatPanel(chatPanel?.hidden === true);
    });
  }

  if (chatClose) {
    chatClose.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleChatPanel(false);
    });
  }

  const pathParts = location.pathname.split('/').filter(Boolean);
  const appSections = new Set(['home', 'movies', 'tv', 'games', 'search', 'settings', 'random', 'test']);
  const section = pathParts.find(part => appSections.has(part)) || 'home';
  const fileName = pathParts.at(-1) || '';
  const isSearchPage = section === 'search' || fileName.startsWith('search');
  let page = section;


  const logoLink = shadow.querySelector('.logo');
  if (logoLink) {
    const homeUrl = withBase('/home/');
    logoLink.setAttribute('href', homeUrl);
    logoLink.addEventListener('click', (event) => {
      event.preventDefault();
      window.location.href = homeUrl;
    });
  }

  const SEARCH_HISTORY_KEY = 'bilm-search-history';
  const INCOGNITO_SEARCH_MAP_KEY = 'bilm-incognito-search-map';
  const storage = window.bilmTheme?.storage || {
    getJSON: (key, fallback = []) => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : fallback;
      } catch {
        return fallback;
      }
    },
    setJSON: (key, value) => {
      localStorage.setItem(key, JSON.stringify(value));
    }
  };


  const GLOBAL_BANNER_DISMISS_KEY = 'bilm-global-message-dismissed-migrating-data';

  function isGlobalBannerDismissed() {
    try {
      return localStorage.getItem(GLOBAL_BANNER_DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  }

  function dismissGlobalBanner() {
    if (globalBanner) {
      globalBanner.hidden = true;
      globalBanner.setAttribute('aria-hidden', 'true');
    }
    try {
      localStorage.setItem(GLOBAL_BANNER_DISMISS_KEY, '1');
    } catch {
      // If storage is blocked, keep UI behavior without crashing.
    }
  }

  function setupGlobalBanner() {
    if (!globalBanner) return;
    const dismissed = isGlobalBannerDismissed();
    globalBanner.hidden = dismissed;
    globalBanner.setAttribute('aria-hidden', dismissed ? 'true' : 'false');

    if (!dismissed && globalBannerCloseBtn && globalBannerCloseBtn.dataset.bound !== '1') {
      globalBannerCloseBtn.dataset.bound = '1';
      globalBannerCloseBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        dismissGlobalBanner();
      });
    }
  }

  function loadList(key) {
    const list = storage.getJSON(key, []);
    return Array.isArray(list) ? list : [];
  }

  function saveList(key, list) {
    storage.setJSON(key, list);
  }

  function saveSearchHistoryEntry(query) {
    const settings = window.bilmTheme?.getSettings?.() || {};
    if (settings.searchHistory === false || settings.incognito === true) return;
    const history = loadList(SEARCH_HISTORY_KEY);
    const normalizedQuery = query.toLowerCase();
    const next = [
      { query, updatedAt: Date.now() },
      ...history.filter((entry) => String(entry?.query || '').trim().toLowerCase() !== normalizedQuery)
    ].slice(0, 120);
    saveList(SEARCH_HISTORY_KEY, next);
  }

  function saveIncognitoSearch(query) {
    const token = Math.random().toString(36).slice(2, 12);
    let map = {};
    try {
      map = JSON.parse(sessionStorage.getItem(INCOGNITO_SEARCH_MAP_KEY) || '{}') || {};
    } catch {
      map = {};
    }
    map[token] = query;
    const orderedEntries = Object.entries(map).slice(-50);
    const compactMap = Object.fromEntries(orderedEntries);
    try {
      sessionStorage.setItem(INCOGNITO_SEARCH_MAP_KEY, JSON.stringify(compactMap));
    } catch {
      return query;
    }
    return token;
  }

  function submitSearch(query, { closeMobileOverlay = false } = {}) {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;
    const settings = window.bilmTheme?.getSettings?.() || {};
    saveSearchHistoryEntry(trimmedQuery);
    if (closeMobileOverlay) {
      const overlay = shadow.getElementById('mobileSearchOverlay');
      const input = shadow.getElementById('mobileSearchInput');
      const clearBtn = shadow.getElementById('mobileSearchCloseBtn');
      if (overlay) {
        overlay.classList.remove('active');
      }
      if (input) {
        input.value = '';
      }
      if (clearBtn) {
        clearBtn.style.display = 'none';
      }
      document.body.style.overflow = '';
    }
    const outgoingQuery = settings.incognito === true
      ? saveIncognitoSearch(trimmedQuery)
      : trimmedQuery;
    window.location.href = `${withBase('/search/')}?q=${encodeURIComponent(outgoingQuery)}`;
  }

  setupGlobalBanner();

  // Desktop nav buttons
  const buttons = shadow.querySelectorAll('nav.navbar button[data-page]');
  buttons.forEach(btn => {
    if (btn.dataset.page === page) {
      btn.classList.add('active');
    }
    btn.onclick = () => {
      const target = btn.dataset.page;
      window.location.href = withBase(`/${target === 'home' ? 'home' : target}/`);
    };
  });

  // Mobile nav buttons
  const mobileButtons = shadow.querySelectorAll('nav.mobile-bottom-nav button[data-page]');
  mobileButtons.forEach(btn => {
    if (btn.dataset.page === page || (isSearchPage && btn.dataset.page === 'search')) {
      btn.classList.add('active');
    }
    btn.onclick = () => {
      const target = btn.dataset.page;
      if (target === 'search') {
        const overlay = shadow.getElementById('mobileSearchOverlay');
        const input = shadow.getElementById('mobileSearchInput');
        overlay.classList.add('active');
        input.focus();
        document.body.style.overflow = 'hidden';
        return;
      }
      window.location.href = withBase(`/${target === 'home' ? 'home' : target}/`);
    };
  });


  const accountBtn = shadow.getElementById('navbarAccountBtn');
  loadAuthScript().then(async (authApi) => {
    authApiInstance = authApi;
    await authApi.init();

    if (chatWidget) {
      chatWidget.hidden = false;
    }

    const syncAccountButton = (user) => {
      chatCurrentUser = user || null;
      if (chatCurrentUser && chatPendingMessages.some((entry) => entry.pending && entry.failed && entry.retryable !== false)) {
        schedulePendingChatRetry();
      }
      if (chatCurrentUser) {
        triggerLiveChatPull('auth-state');
      } else {
        clearLiveChatPoll();
      }

      if (!accountBtn) return;
      accountBtn.textContent = user ? (user.displayName || user.email || 'Account') : 'Account';
      accountBtn.title = user ? 'Open account settings / log out' : 'Log in or create account';
    };

    refreshChatMessages();
    chatPendingMessages = [];

    syncAccountButton(authApi.getCurrentUser());
    authApi.onAuthStateChanged(syncAccountButton);
    authApi.onListSyncApplied?.((event) => {
      const listKeys = Array.isArray(event?.listKeys) ? event.listKeys : [];
      if (!listKeys.includes(CHAT_STORAGE_KEY)) return;
      refreshChatMessages();
    });
    authApi.onSyncIssue?.((issue) => {
      handleChatSyncIssue(issue);
    });
    window.addEventListener('storage', (event) => {
      if (event.key !== CHAT_STORAGE_KEY) return;
      refreshChatMessages();
    });
    window.addEventListener('focus', () => {
      if (!chatCurrentUser) return;
      triggerLiveChatPull('window-focus');
    });
    document.addEventListener('visibilitychange', () => {
      if (!chatCurrentUser) return;
      if (document.visibilityState === 'visible') {
        triggerLiveChatPull('visibility-visible');
      } else {
        scheduleLiveChatPoll('visibility-hidden');
      }
    });

    if (chatRefreshBtn) {
      chatRefreshBtn.addEventListener('click', async () => {
        if (Date.now() < chatRefreshCooldownUntil) return;
        chatRefreshBtn.setAttribute('aria-busy', 'true');
        try {
          if (typeof authApi.pullChatNow === 'function') {
            await authApi.pullChatNow({ reason: 'manual-refresh', limit: 120 });
          } else {
            await authApi.syncFromCloudNow?.();
          }
        } catch (error) {
          console.warn('Manual chat sync refresh failed:', error);
        }
        refreshChatMessages();
        setChatRefreshCooldown();
        scheduleLiveChatPoll('manual-refresh');
      });
    }

    if (chatForm && chatInput) {
      chatForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const text = chatInput.value.trim();
        if (!text) return;
        if (!chatCurrentUser) {
          setChatNotice('Sign in to sync and send chat messages.');
          return;
        }

        const author = chatCurrentUser?.displayName || chatCurrentUser?.email || 'Guest';
        const authorUid = chatCurrentUser?.uid || 'local';

        const optimisticId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const optimisticMessage = {
          id: optimisticId,
          pending: true,
          failed: false,
          retryable: true,
          retryDelayMs: 1200,
          attemptCount: 0,
          text,
          author,
          authorUid,
          createdAtMs: Date.now()
        };

        setPendingChat(optimisticMessage);
        renderChatMessages(composeVisibleChatMessages());
        chatInput.value = '';
        await attemptSendPendingChat(optimisticId);
        triggerLiveChatPull('send-success');
      });
    }
  }).catch(() => {
    if (accountBtn) {
      accountBtn.textContent = 'Account';
      accountBtn.addEventListener('click', () => {
        window.location.href = withBase('/settings/account/');
      });
    }
  });

  const searchInput = shadow.querySelector('#searchInput');
  const navbarSearchForm = shadow.getElementById('navbarSearchForm');
  const desktopClearBtn = shadow.getElementById('desktopSearchClearBtn');
  if (navbarSearchForm && searchInput) {
    navbarSearchForm.addEventListener('submit', event => {
      event.preventDefault();
      submitSearch(searchInput.value);
    });

    const toggleDesktopClear = () => {
      if (!desktopClearBtn) return;
      const hasText = searchInput.value.trim().length > 0;
      desktopClearBtn.hidden = !hasText;
      desktopClearBtn.style.display = hasText ? 'flex' : 'none';
    };

    toggleDesktopClear();
    searchInput.addEventListener('input', toggleDesktopClear);
    if (desktopClearBtn) {
      desktopClearBtn.addEventListener('click', () => {
        searchInput.value = '';
        toggleDesktopClear();
        searchInput.focus();
      });
    }
  }

  // Mobile search overlay handlers (no changes here)
  const overlay = shadow.getElementById('mobileSearchOverlay');
  if (overlay) {
    const input = shadow.getElementById('mobileSearchInput');
    const clearBtn = shadow.getElementById('mobileSearchCloseBtn');
    const topCloseBtn = shadow.getElementById('mobileSearchTopCloseBtn');

    const closeOverlay = () => {
      overlay.classList.remove('active');
      input.value = '';
      clearBtn.style.display = 'none';
      document.body.style.overflow = '';
    };

    input.addEventListener('input', () => {
      clearBtn.style.display = input.value.length > 0 ? 'block' : 'none';
    });

    clearBtn.addEventListener('click', () => {
      input.value = '';
      clearBtn.style.display = 'none';
      input.focus();
    });

    topCloseBtn.addEventListener('click', closeOverlay);

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const query = input.value.trim();
        if (query) {
          submitSearch(query, { closeMobileOverlay: true });
        }
      } else if (e.key === 'Escape') {
        closeOverlay();
      }
    });
  }
})();

