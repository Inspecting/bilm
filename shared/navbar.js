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
  let chatRefreshCooldownUntil = 0;
  const chatMessages = shadow.getElementById('sharedChatMessages');
  let chatCurrentUser = null;
  let chatRemoteMessages = [];
  let chatPendingMessages = [];
  let authApiInstance = null;
  let chatCloudSaveTimer = null;
  const CHAT_CLOUD_SAVE_DEBOUNCE_MS = 250;
  let chatFirestoreUnsubscribe = null;
  let chatFirestoreLive = false;
  let chatFirestoreFailed = false;
  const CHAT_STORAGE_KEY = 'bilm-shared-chat';


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

  function getChatMessageKey(entry) {
    if (!entry || typeof entry !== 'object') return '';
    const id = String(entry.id || '').trim();
    if (id) return `id:${id}`;
    const explicitKey = String(entry.key || '').trim();
    if (explicitKey) return `key:${explicitKey}`;
    const createdAtMs = Number(entry.createdAtMs || entry.updatedAt || 0) || 0;
    const text = String(entry.text || '').trim().toLowerCase();
    const authorUid = String(entry.authorUid || entry.author || '').trim().toLowerCase();
    return text ? `fallback:${createdAtMs}:${authorUid}:${text}` : '';
  }

  function getChatMessageUpdatedAt(entry) {
    return Number(entry?.updatedAt || entry?.createdAtMs || 0) || 0;
  }

  function mergeChatMessages(...lists) {
    const byKey = new Map();
    lists
      .flat()
      .forEach((entry) => {
        const normalizedEntry = normalizeChatMessages([entry])[0];
        if (!normalizedEntry) return;
        const key = getChatMessageKey(normalizedEntry);
        if (!key) return;
        const existing = byKey.get(key);
        if (!existing || getChatMessageUpdatedAt(normalizedEntry) >= getChatMessageUpdatedAt(existing)) {
          byKey.set(key, normalizedEntry);
        }
      });
    return normalizeChatMessages([...byKey.values()]).slice(-120);
  }

  function parseChatMessagesFromSnapshot(snapshot) {
    const raw = snapshot?.localStorage?.[CHAT_STORAGE_KEY];
    if (typeof raw !== 'string') return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? normalizeChatMessages(parsed) : [];
    } catch {
      return [];
    }
  }

  function composeVisibleChatMessages() {
    return normalizeChatMessages([...(chatRemoteMessages || []), ...(chatPendingMessages || [])]);
  }

  function loadStoredChatMessages() {
    const stored = storage.getJSON(CHAT_STORAGE_KEY, []);
    return normalizeChatMessages(Array.isArray(stored) ? stored : []);
  }

  function saveStoredChatMessages(messages, { syncCloud = true } = {}) {
    const normalized = normalizeChatMessages(messages).slice(-120);
    storage.setJSON(CHAT_STORAGE_KEY, normalized);
    chatRemoteMessages = normalized;
    if (syncCloud) scheduleChatCloudSave();
  }

  function scheduleChatCloudSave() {
    if (!authApiInstance || !chatCurrentUser || typeof authApiInstance.scheduleCloudSave !== 'function') return;
    window.clearTimeout(chatCloudSaveTimer);
    chatCloudSaveTimer = window.setTimeout(() => {
      authApiInstance.scheduleCloudSave('manual').catch((error) => {
        console.warn('Shared chat cloud save failed:', error);
      });
    }, CHAT_CLOUD_SAVE_DEBOUNCE_MS);
  }

  function refreshChatMessages() {
    chatRemoteMessages = loadStoredChatMessages();
    renderChatMessages(composeVisibleChatMessages());
  }

  function getChatFirestoreDeps() {
    const modules = window.bilmAuthModules;
    const firestore = modules?.getFirestore?.();
    if (!modules || !firestore) return null;
    return { modules, firestore };
  }

  function stopChatFirestoreListener() {
    if (typeof chatFirestoreUnsubscribe === 'function') {
      chatFirestoreUnsubscribe();
    }
    chatFirestoreUnsubscribe = null;
    chatFirestoreLive = false;
    chatFirestoreFailed = false;
  }

  function startChatFirestoreListener() {
    stopChatFirestoreListener();
    if (!chatCurrentUser) return;

    const deps = getChatFirestoreDeps();
    if (!deps) return;

    const { modules, firestore } = deps;
    const userDocRef = modules.doc(firestore, 'users', chatCurrentUser.uid);

    chatFirestoreUnsubscribe = modules.onSnapshot(userDocRef, (docSnap) => {
      chatFirestoreLive = true;
      chatFirestoreFailed = false;

      const data = docSnap.data() || {};
      const rawMessages = Array.isArray(data?.sharedChat?.messages)
        ? data.sharedChat.messages
        : [];
      const fromFirestore = normalizeChatMessages(rawMessages.map((entry) => ({
        ...entry,
        firebase: true,
        id: String(entry?.id || entry?.key || '').trim() || `msg-${Number(entry?.createdAtMs || Date.now())}`,
        text: String(entry?.text || ''),
        author: String(entry?.author || 'Account'),
        createdAtMs: Number(entry?.createdAtMs || entry?.updatedAt || Date.now()) || Date.now(),
        updatedAt: Number(entry?.updatedAt || entry?.createdAtMs || Date.now()) || Date.now()
      })));

      chatRemoteMessages = fromFirestore;
      chatPendingMessages = chatPendingMessages.filter((pending) => (
        !fromFirestore.some((entry) => String(entry.key || '') && String(entry.key || '') === String(pending.key || ''))
      ));

      // Keep local/API backup in sync while Firebase drives realtime UI.
      saveStoredChatMessages(fromFirestore, { syncCloud: false });
      renderChatMessages(composeVisibleChatMessages());
    }, (error) => {
      chatFirestoreLive = false;
      chatFirestoreFailed = true;
      console.warn('Shared chat realtime listener failed:', error);
      if (chatPanel && chatPanel.hidden === false) {
        setChatNotice('Live chat unavailable right now. Showing saved chat.');
      }
    });
  }

  async function updateFirebaseChatMessages(mutator) {
    if (!chatCurrentUser) return false;
    const deps = getChatFirestoreDeps();
    if (!deps) return false;

    const { modules, firestore } = deps;
    const userDocRef = modules.doc(firestore, 'users', chatCurrentUser.uid);

    const applyMutation = (existingMessages = []) => {
      const safeExisting = Array.isArray(existingMessages) ? existingMessages : [];
      const next = normalizeChatMessages(mutator(normalizeChatMessages(safeExisting))).slice(-120);
      return next.map((entry) => ({
        id: String(entry.id || '').trim() || `msg-${Number(entry.createdAtMs || Date.now())}-${Math.random().toString(36).slice(2, 6)}`,
        key: String(entry.key || '').trim() || `chat:${Number(entry.createdAtMs || Date.now())}:${Math.random().toString(36).slice(2, 8)}`,
        text: String(entry.text || ''),
        author: String(entry.author || 'Account'),
        authorUid: String(entry.authorUid || ''),
        createdAtMs: Number(entry.createdAtMs || Date.now()) || Date.now(),
        updatedAt: Number(entry.updatedAt || entry.createdAtMs || Date.now()) || Date.now()
      }));
    };

    if (typeof modules.runTransaction === 'function') {
      await modules.runTransaction(firestore, async (transaction) => {
        const snap = await transaction.get(userDocRef);
        const data = snap.data() || {};
        const existingMessages = data?.sharedChat?.messages || [];
        const nextMessages = applyMutation(existingMessages);
        transaction.set(userDocRef, {
          sharedChat: {
            messages: nextMessages,
            updatedAtMs: Date.now(),
            version: 1
          }
        }, { merge: true });
      });
      return true;
    }

    const snap = await modules.getDoc(userDocRef);
    const data = snap.data() || {};
    const existingMessages = data?.sharedChat?.messages || [];
    const nextMessages = applyMutation(existingMessages);
    await modules.setDoc(userDocRef, {
      sharedChat: {
        messages: nextMessages,
        updatedAtMs: Date.now(),
        version: 1
      }
    }, { merge: true });
    return true;
  }

  async function sendChatMessageToFirestore(message) {
    const nextMessage = {
      id: String(message?.id || '').trim() || `msg-${Number(message?.createdAtMs || Date.now())}-${Math.random().toString(36).slice(2, 6)}`,
      key: String(message?.key || ''),
      text: String(message?.text || ''),
      author: String(message?.author || 'Account'),
      authorUid: String(message?.authorUid || chatCurrentUser?.uid || ''),
      createdAtMs: Number(message?.createdAtMs || Date.now()) || Date.now(),
      updatedAt: Number(message?.updatedAt || message?.createdAtMs || Date.now()) || Date.now()
    };
    const updated = await updateFirebaseChatMessages((existing) => mergeChatMessages(existing, [nextMessage]));
    if (updated) scheduleChatCloudSave();
    return updated;
  }

  async function deleteChatMessage(entry) {
    if (!entry || entry.pending) return;
    if (chatCurrentUser) {
      const removed = await updateFirebaseChatMessages((existing) => (
        existing.filter((message) => getChatMessageKey(message) !== getChatMessageKey(entry))
      ));
      if (removed) {
        scheduleChatCloudSave();
        return;
      }
    }

    const current = loadStoredChatMessages();
    saveStoredChatMessages(current.filter((message) => message.id !== entry.id));
    renderChatMessages(composeVisibleChatMessages());
  }

  function updateChatRealtimeLoopState() {
    if (chatCurrentUser) {
      startChatFirestoreListener();
      return;
    }
    stopChatFirestoreListener();
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
      del.textContent = entry.pending ? 'Pending' : 'Delete';
      del.disabled = Boolean(entry.pending);
      del.addEventListener('click', async () => {
        try {
          await deleteChatMessage(entry);
        } catch (error) {
          console.warn('Failed to delete chat message:', error);
        }
      });

      meta.append(left, del);

      const body = document.createElement('p');
      body.textContent = String(entry.text || '');

      row.append(meta, body);
      chatMessages.appendChild(row);
    });

    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function toggleChatPanel(nextOpen) {
    if (!chatPanel || !chatToggle) return;
    const open = Boolean(nextOpen);
    chatPanel.hidden = !open;
    chatToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      if (chatFirestoreFailed) {
        startChatFirestoreListener();
      }
      refreshChatMessages();
      if (chatInput) chatInput.focus();
    }
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
      updateChatRealtimeLoopState();

      if (!accountBtn) return;
      accountBtn.textContent = user ? (user.displayName || user.email || 'Account') : 'Account';
      accountBtn.title = user ? 'Open account settings / log out' : 'Log in or create account';
    };

    refreshChatMessages();
    chatPendingMessages = [];

    syncAccountButton(authApi.getCurrentUser());
    authApi.onAuthStateChanged(syncAccountButton);
    authApi.onCloudSnapshotChanged((event) => {
      if (chatFirestoreLive) return;
      if (!event?.snapshot) return;
      const remoteMessages = parseChatMessagesFromSnapshot(event.snapshot);
      const localMessages = loadStoredChatMessages();
      const mergedMessages = mergeChatMessages(localMessages, remoteMessages);
      saveStoredChatMessages(mergedMessages, { syncCloud: false });
      renderChatMessages(composeVisibleChatMessages());
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (chatCurrentUser && chatFirestoreFailed) {
        startChatFirestoreListener();
      }
    });
    window.addEventListener('storage', (event) => {
      if (event.key !== CHAT_STORAGE_KEY) return;
      refreshChatMessages();
    });

    if (chatRefreshBtn) {
      chatRefreshBtn.addEventListener('click', async () => {
        if (Date.now() < chatRefreshCooldownUntil) return;
        chatRefreshBtn.setAttribute('aria-busy', 'true');
        if (chatCurrentUser && chatFirestoreFailed) {
          startChatFirestoreListener();
        }
        refreshChatMessages();
        setChatRefreshCooldown();
      });
    }

    if (chatForm && chatInput) {
      chatForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const text = chatInput.value.trim();
        if (!text) return;

        const author = chatCurrentUser?.displayName || chatCurrentUser?.email || 'Guest';
        const authorUid = chatCurrentUser?.uid || 'local';
        const createdAtMs = Date.now();
        const messageKey = `chat:${createdAtMs}:${Math.random().toString(36).slice(2, 8)}`;

        const optimisticId = `pending-${createdAtMs}-${Math.random().toString(36).slice(2, 8)}`;
        const optimisticMessage = {
          id: optimisticId,
          pending: true,
          key: messageKey,
          text,
          author,
          authorUid,
          createdAtMs
        };

        chatPendingMessages.push(optimisticMessage);
        renderChatMessages(composeVisibleChatMessages());
        chatInput.value = '';

        try {
          const sentToFirestore = await sendChatMessageToFirestore({
            text,
            author: optimisticMessage.author,
            authorUid,
            createdAtMs: optimisticMessage.createdAtMs,
            updatedAt: optimisticMessage.createdAtMs,
            key: messageKey
          });

          if (!sentToFirestore) {
            const current = loadStoredChatMessages();
            current.push({
              id: `msg-${optimisticMessage.createdAtMs}-${Math.random().toString(36).slice(2, 8)}`,
              key: messageKey,
              text,
              author: optimisticMessage.author,
              authorUid,
              createdAtMs: optimisticMessage.createdAtMs,
              updatedAt: optimisticMessage.createdAtMs
            });
            saveStoredChatMessages(current);
            chatPendingMessages = chatPendingMessages.filter((entry) => entry.id !== optimisticId);
            renderChatMessages(composeVisibleChatMessages());
          }
        } catch (error) {
          // If Firebase send fails, keep chat functional locally and let API backup carry this message.
          const current = loadStoredChatMessages();
          current.push({
            id: `msg-${optimisticMessage.createdAtMs}-${Math.random().toString(36).slice(2, 8)}`,
            key: messageKey,
            text,
            author: optimisticMessage.author,
            authorUid,
            createdAtMs: optimisticMessage.createdAtMs,
            updatedAt: optimisticMessage.createdAtMs
          });
          saveStoredChatMessages(current);
          chatPendingMessages = chatPendingMessages.filter((entry) => entry.id !== optimisticId);
          renderChatMessages(composeVisibleChatMessages());
          console.warn('Failed to send shared chat message to Firebase (saved locally instead):', error);
        }
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

