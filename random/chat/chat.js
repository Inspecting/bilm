(() => {
  const TAB_STORAGE_KEY = 'bilm-chat-open-tabs-v1';
  const ACTIVE_TAB_STORAGE_KEY = 'bilm-chat-active-tab-v1';
  const POLL_INTERVAL_MS = 12000;

  const state = {
    apiBases: [],
    authApi: null,
    currentUser: null,
    conversations: [],
    conversationsById: new Map(),
    openTabs: [],
    activeConversationId: '',
    messagesByConversation: new Map(),
    tabsHydrated: false,
    filterText: '',
    pollingTimer: null,
    loadingConversations: false
  };

  const elements = {};

  function detectBasePath() {
    const appRoots = new Set(['home', 'movies', 'tv', 'search', 'settings', 'random', 'test', 'shared', 'index.html']);
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (!parts.length) return '';

    const appRootIndex = parts.findIndex((part) => appRoots.has(part));
    if (appRootIndex >= 0) {
      if (appRootIndex === 0) return '';
      return `/${parts.slice(0, appRootIndex).join('/')}`;
    }
    if (parts[0] === 'gh' && parts.length >= 3) return `/${parts.slice(0, 3).join('/')}`;
    if (parts[0] === 'npm' && parts.length >= 2) return `/${parts.slice(0, 2).join('/')}`;
    if (parts.length === 1) return `/${parts[0]}`;
    return '';
  }

  function withBase(path) {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return `${detectBasePath()}${normalized}`;
  }

  function getApiOrigin() {
    return String(window.location.hostname || '').toLowerCase() === 'cdn.jsdelivr.net'
      ? 'https://watchbilm.org'
      : window.location.origin;
  }

  function buildApiBases() {
    const originProxy = new URL('/api/chat', getApiOrigin()).toString().replace(/\/$/, '');
    const directCloudflare = 'https://chat-api.watchbilm.org';
    const host = String(window.location.hostname || '').trim().toLowerCase();
    const preferDirectHost = host === 'watchbilm.org' || host === 'www.watchbilm.org';
    const ordered = preferDirectHost
      ? [directCloudflare, originProxy]
      : [originProxy, directCloudflare];
    return [...new Set(ordered.map((value) => String(value || '').trim()).filter(Boolean))];
  }

  function normalizeAuthMode(mode = 'login') {
    return String(mode || '').trim().toLowerCase() === 'signup' ? 'signup' : 'login';
  }

  function safeParse(raw, fallback = null) {
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function formatDateTime(timestampMs) {
    const timestamp = Number(timestampMs || 0) || 0;
    if (!timestamp) return 'No messages yet';
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return 'No messages yet';
    }
  }

  function showToast(message, tone = 'info', duration = 1500) {
    window.bilmToast?.show?.(message, { tone, duration });
  }

  function setComposerStatus(message = '', tone = 'muted') {
    if (!elements.composerStatus) return;
    elements.composerStatus.textContent = String(message || '');
    elements.composerStatus.dataset.tone = tone;
  }

  function setConversations(conversations) {
    const normalized = Array.isArray(conversations) ? conversations : [];
    state.conversations = normalized;
    state.conversationsById = new Map(normalized.map((conversation) => [conversation.id, conversation]));
  }

  function readStoredTabs() {
    const storedTabs = safeParse(localStorage.getItem(TAB_STORAGE_KEY), []);
    return Array.isArray(storedTabs) ? storedTabs.filter((item) => typeof item === 'string' && item.trim()) : [];
  }

  function saveTabState() {
    localStorage.setItem(TAB_STORAGE_KEY, JSON.stringify(state.openTabs));
    if (state.activeConversationId) {
      localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, state.activeConversationId);
    } else {
      localStorage.removeItem(ACTIVE_TAB_STORAGE_KEY);
    }
  }

  function hydrateTabState() {
    if (state.tabsHydrated) return;
    state.tabsHydrated = true;
    state.openTabs = readStoredTabs();
    state.activeConversationId = String(localStorage.getItem(ACTIVE_TAB_STORAGE_KEY) || '').trim();
  }

  function reconcileTabs() {
    state.openTabs = state.openTabs.filter((conversationId) => state.conversationsById.has(conversationId));
    if (!state.openTabs.includes(state.activeConversationId)) {
      state.activeConversationId = state.openTabs[0] || '';
    }
    saveTabState();
  }

  function setLoginStatus(user) {
    if (!elements.chatLoginStatus) return;
    if (!user) {
      elements.chatLoginStatus.textContent = 'You are not logged in. Log in to send and sync messages.';
      return;
    }
    elements.chatLoginStatus.textContent = `Logged in as ${user.email || 'account user'}.`;
  }

  function closeAuthPromptModal() {
    if (!elements.authPromptModal) return;
    elements.authPromptModal.hidden = true;
  }

  function openAuthPromptModal(message = 'To use chat, log in or create an account.') {
    if (!elements.authPromptModal) {
      ensureAuthModalOpen('login');
      return;
    }
    if (elements.authPromptMessage) {
      elements.authPromptMessage.textContent = String(message || 'To use chat, log in or create an account.');
    }
    elements.authPromptModal.hidden = false;
  }

  function promptForAuth(message = 'To use chat, log in or create an account.') {
    const alreadyOpen = Boolean(elements.authPromptModal && !elements.authPromptModal.hidden);
    openAuthPromptModal(message);
    if (!alreadyOpen) {
      showToast('Log in or create an account to keep chatting.', 'info');
    }
  }

  function isAuthError(error) {
    const status = Number(error?.status || 0);
    const code = String(error?.code || '').trim().toLowerCase();
    const message = String(error?.message || '').trim().toLowerCase();
    if (status === 401) return true;
    if (code === 'missing_token'
      || code === 'token_expired'
      || code === 'invalid_token'
      || code === 'email_required') {
      return true;
    }
    if (status !== 403) return false;
    return message.includes('token')
      || message.includes('authorization')
      || message.includes('auth')
      || message.includes('sign in')
      || message.includes('signed in')
      || message.includes('email required');
  }

  function normalizeRequestError(error) {
    const input = error instanceof Error ? error : new Error(String(error?.message || error || 'Chat request failed.'));
    const message = String(input.message || '').toLowerCase();
    const networkFailure = input.name === 'TypeError'
      || message.includes('failed to fetch')
      || message.includes('networkerror');
    if (networkFailure) {
      const fallback = new Error('Chat request failed. Check your connection and try again.');
      fallback.code = 'network_request_failed';
      return fallback;
    }
    return input;
  }

  function shouldTryNextApiBase(error) {
    const status = Number(error?.status || 0);
    if (!Number.isFinite(status) || status <= 0) return true;
    return status === 401
      || status === 403
      || status === 404
      || status === 405
      || status === 408
      || status === 409
      || status === 425
      || status === 429
      || status === 500
      || status === 502
      || status === 503
      || status === 504;
  }

  function ensureAuthModalOpen(mode = 'login') {
    const normalizedMode = normalizeAuthMode(mode);
    if (window.bilmAuthUi?.open) {
      window.bilmAuthUi.open(normalizedMode);
      return;
    }
    let opened = false;
    const tryOpenNow = () => {
      if (opened) return;
      if (!window.bilmAuthUi?.open) return;
      opened = true;
      window.bilmAuthUi.open(normalizedMode);
    };
    window.addEventListener('bilm:auth-modal-ready', tryOpenNow, { once: true });
    window.dispatchEvent(new CustomEvent('bilm:open-auth-modal', { detail: { mode: normalizedMode } }));
    window.setTimeout(tryOpenNow, 250);
  }

  async function authedRequest(path, { method = 'GET', body = undefined } = {}) {
    if (!state.currentUser || typeof state.currentUser.getIdToken !== 'function') {
      const error = new Error('Log in required.');
      error.status = 401;
      error.code = 'missing_session';
      throw error;
    }
    const token = await state.currentUser.getIdToken();
    if (!token) {
      const error = new Error('Missing auth token.');
      error.status = 401;
      error.code = 'missing_token';
      throw error;
    }

    let lastError = null;
    for (let index = 0; index < state.apiBases.length; index += 1) {
      const apiBase = state.apiBases[index];
      const isLastBase = index === state.apiBases.length - 1;
      const headers = {
        accept: 'application/json',
        authorization: `Bearer ${token}`
      };
      const requestInit = {
        method,
        headers,
        cache: 'no-store'
      };
      if (typeof body !== 'undefined') {
        headers['content-type'] = 'application/json';
        requestInit.body = JSON.stringify(body);
      }

      try {
        const response = await fetch(`${apiBase}${path}`, requestInit);
        const text = await response.text();
        const payload = text ? safeParse(text, null) : null;
        const contentType = String(response.headers.get('content-type') || '').toLowerCase();
        if (response.ok) {
          const validJsonPayload = payload && typeof payload === 'object' && !Array.isArray(payload);
          if (validJsonPayload) {
            return payload;
          }
          const error = new Error('Chat endpoint returned an invalid response.');
          error.status = 502;
          error.code = 'invalid_chat_response';
          error.apiBase = apiBase;
          error.contentType = contentType;
          throw error;
        }

        const error = new Error(String(payload?.message || payload?.error || `Request failed (${response.status})`));
        error.status = response.status;
        error.code = payload?.code || '';
        error.apiBase = apiBase;

        if (isLastBase) {
          throw error;
        }
        if (!shouldTryNextApiBase(error)) {
          throw error;
        }
        lastError = error;
      } catch (rawError) {
        const error = normalizeRequestError(rawError);
        if (isLastBase) {
          throw error;
        }
        if (!shouldTryNextApiBase(error)) {
          throw error;
        }
        lastError = error;
      }
    }

    throw normalizeRequestError(lastError || new Error('Chat request failed.'));
  }

  async function ensureAuthReady() {
    const start = Date.now();
    while (!window.bilmAuth && Date.now() - start < 7000) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!window.bilmAuth) throw new Error('Auth module did not load.');
    await window.bilmAuth.init();
    return window.bilmAuth;
  }

  function getActiveConversation() {
    return state.conversationsById.get(state.activeConversationId) || null;
  }

  function renderConversationList() {
    if (!elements.conversationList) return;
    elements.conversationList.innerHTML = '';

    if (!state.currentUser) {
      const row = document.createElement('div');
      row.className = 'message-empty';
      row.textContent = 'Log in to load your chats.';
      elements.conversationList.appendChild(row);
      return;
    }

    const filter = state.filterText.trim().toLowerCase();
    const conversations = state.conversations.filter((conversation) => (
      !filter || String(conversation.partnerEmail || '').toLowerCase().includes(filter)
    ));
    if (!conversations.length) {
      const row = document.createElement('div');
      row.className = 'message-empty';
      row.textContent = filter ? 'No chats match this filter.' : 'No chats yet. Start one with New Chat.';
      elements.conversationList.appendChild(row);
      return;
    }

    conversations.forEach((conversation) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'conversation-item';
      if (conversation.id === state.activeConversationId) item.classList.add('is-active');
      item.addEventListener('click', () => {
        openConversationTab(conversation.id, { focus: true });
      });

      const title = document.createElement('span');
      title.className = 'conversation-email';
      title.textContent = conversation.partnerEmail || 'Unknown user';

      const preview = document.createElement('span');
      preview.className = 'conversation-preview';
      preview.textContent = conversation.lastMessagePreview || 'No messages yet.';

      const meta = document.createElement('span');
      meta.className = 'conversation-meta';
      const time = document.createElement('span');
      time.textContent = formatDateTime(conversation.lastMessageAtMs);
      meta.appendChild(time);
      if (conversation.unread) {
        const unread = document.createElement('span');
        unread.className = 'conversation-unread';
        unread.textContent = 'New';
        meta.appendChild(unread);
      }

      item.appendChild(title);
      item.appendChild(preview);
      item.appendChild(meta);
      elements.conversationList.appendChild(item);
    });
  }

  function renderTabs() {
    if (!elements.chatTabs) return;
    elements.chatTabs.innerHTML = '';
    state.openTabs.forEach((conversationId) => {
      const conversation = state.conversationsById.get(conversationId);
      if (!conversation) return;

      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'chat-tab';
      if (conversationId === state.activeConversationId) tab.classList.add('is-active');
      tab.addEventListener('click', () => openConversationTab(conversationId, { focus: true }));

      const label = document.createElement('span');
      label.textContent = conversation.partnerEmail || 'Conversation';

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'chat-tab-close';
      close.textContent = '×';
      close.setAttribute('aria-label', 'Close tab');
      close.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeConversationTab(conversationId);
      });

      tab.appendChild(label);
      tab.appendChild(close);
      elements.chatTabs.appendChild(tab);
    });
  }

  function renderMessages() {
    if (!elements.messageList) return;
    const conversation = getActiveConversation();
    elements.messageList.innerHTML = '';
    if (!conversation) return;
    const messages = state.messagesByConversation.get(conversation.id) || [];
    if (!messages.length) {
      const empty = document.createElement('div');
      empty.className = 'message-empty';
      empty.textContent = 'No messages yet. Say hello.';
      elements.messageList.appendChild(empty);
      return;
    }
    const currentEmail = normalizeEmail(state.currentUser?.email || '');
    messages.forEach((message) => {
      const row = document.createElement('article');
      row.className = `message-row ${normalizeEmail(message.senderEmail) === currentEmail ? 'mine' : 'theirs'}`;
      row.textContent = String(message.text || '');

      const meta = document.createElement('span');
      meta.className = 'message-meta';
      meta.textContent = `${message.senderEmail || 'unknown'} • ${formatDateTime(message.createdAtMs)}`;
      row.appendChild(meta);
      elements.messageList.appendChild(row);
    });
    elements.messageList.scrollTop = elements.messageList.scrollHeight;
  }

  function syncMainView() {
    const hasActive = Boolean(getActiveConversation());
    elements.chatEmptyState.hidden = hasActive;
    elements.chatView.hidden = !hasActive;
    const canCompose = hasActive && Boolean(state.currentUser);
    elements.messageInput.disabled = !canCompose;
    elements.sendMessageBtn.disabled = !canCompose;
  }

  function renderActiveConversationHeader() {
    const conversation = getActiveConversation();
    if (!conversation) {
      elements.activeChatTitle.textContent = 'Conversation';
      elements.activeChatMeta.textContent = 'No chat selected.';
      return;
    }
    elements.activeChatTitle.textContent = conversation.partnerEmail || 'Conversation';
    elements.activeChatMeta.textContent = `Updated ${formatDateTime(conversation.lastMessageAtMs || conversation.updatedAtMs)}.`;
  }

  async function fetchMessages(conversationId, { quiet = false } = {}) {
    if (!conversationId) return;
    if (!state.currentUser) return;
    try {
      const payload = await authedRequest(`/conversations/${encodeURIComponent(conversationId)}/messages?limit=180&before=${Number.MAX_SAFE_INTEGER}`);
      state.messagesByConversation.set(conversationId, Array.isArray(payload.messages) ? payload.messages : []);
      if (payload.conversation?.id) {
        state.conversationsById.set(payload.conversation.id, payload.conversation);
        state.conversations = state.conversations.map((entry) => (
          entry.id === payload.conversation.id ? payload.conversation : entry
        ));
      }
      if (conversationId === state.activeConversationId) {
        renderActiveConversationHeader();
        renderMessages();
      }
    } catch (error) {
      if (isAuthError(error)) {
        promptForAuth('Your session expired. Log in or create an account to load messages.');
        return;
      }
      if (!quiet) setComposerStatus(error.message || 'Failed to load messages.', 'error');
    }
  }

  async function loadConversations({ quiet = false } = {}) {
    if (!state.currentUser) {
      setConversations([]);
      state.messagesByConversation.clear();
      renderConversationList();
      renderTabs();
      syncMainView();
      return;
    }
    if (state.loadingConversations) return;
    state.loadingConversations = true;
    try {
      const payload = await authedRequest('/conversations?limit=200');
      setConversations(Array.isArray(payload.conversations) ? payload.conversations : []);
      hydrateTabState();
      reconcileTabs();
      renderConversationList();
      renderTabs();
      renderActiveConversationHeader();
      syncMainView();
      if (state.activeConversationId) {
        await fetchMessages(state.activeConversationId, { quiet: true });
      }
    } catch (error) {
      if (isAuthError(error)) {
        promptForAuth('Your session expired. Log in or create an account to load chats.');
        return;
      }
      if (!quiet) showToast(error.message || 'Could not load chats.', 'error');
    } finally {
      state.loadingConversations = false;
    }
  }

  function openConversationTab(conversationId, { focus = true } = {}) {
    if (!state.conversationsById.has(conversationId)) return;
    if (!state.openTabs.includes(conversationId)) state.openTabs.push(conversationId);
    if (focus) state.activeConversationId = conversationId;
    saveTabState();
    renderConversationList();
    renderTabs();
    renderActiveConversationHeader();
    syncMainView();
    void fetchMessages(conversationId, { quiet: true });
  }

  function closeConversationTab(conversationId) {
    state.openTabs = state.openTabs.filter((id) => id !== conversationId);
    if (state.activeConversationId === conversationId) {
      state.activeConversationId = state.openTabs[0] || '';
    }
    saveTabState();
    renderConversationList();
    renderTabs();
    renderActiveConversationHeader();
    syncMainView();
    renderMessages();
  }

  function openNewChatModal(prefill = '') {
    elements.newChatEmailInput.value = String(prefill || '').trim();
    elements.newChatFormStatus.textContent = '';
    elements.newChatModal.hidden = false;
    elements.newChatEmailInput.focus();
  }

  function closeNewChatModal() {
    elements.newChatModal.hidden = true;
    elements.newChatFormStatus.textContent = '';
    elements.newChatEmailInput.value = '';
  }

  async function createOrOpenConversation(targetEmail) {
    const payload = await authedRequest('/conversations', {
      method: 'POST',
      body: { targetEmail }
    });
    const conversation = payload?.conversation;
    if (!conversation?.id) throw new Error('Conversation could not be created.');
    const existingIndex = state.conversations.findIndex((entry) => entry.id === conversation.id);
    if (existingIndex >= 0) {
      state.conversations.splice(existingIndex, 1, conversation);
    } else {
      state.conversations.unshift(conversation);
    }
    state.conversationsById.set(conversation.id, conversation);
    openConversationTab(conversation.id, { focus: true });
    return conversation;
  }

  async function submitNewChatForm(event) {
    event.preventDefault();
    if (!state.currentUser) {
      closeNewChatModal();
      promptForAuth('Create an account or log in to start a chat.');
      return;
    }
    const targetEmail = normalizeEmail(elements.newChatEmailInput.value);
    if (!targetEmail) {
      elements.newChatFormStatus.textContent = 'Email is required.';
      return;
    }
    elements.newChatFormStatus.textContent = 'Opening chat...';
    try {
      const conversation = await createOrOpenConversation(targetEmail);
      closeNewChatModal();
      showToast(`Opened chat with ${conversation.partnerEmail}.`, 'success');
      renderConversationList();
      renderTabs();
      renderActiveConversationHeader();
      syncMainView();
    } catch (error) {
      if (isAuthError(error)) {
        closeNewChatModal();
        promptForAuth('Create an account or log in to start a chat.');
        return;
      }
      elements.newChatFormStatus.textContent = error.message || 'Could not open chat.';
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!state.currentUser) {
      promptForAuth('Create an account or log in to send messages.');
      return;
    }
    const conversation = getActiveConversation();
    if (!conversation) return;

    const text = String(elements.messageInput.value || '').trim();
    if (!text) {
      setComposerStatus('Type a message first.', 'error');
      return;
    }

    elements.sendMessageBtn.disabled = true;
    setComposerStatus('Sending...', 'muted');
    try {
      const payload = await authedRequest(`/conversations/${encodeURIComponent(conversation.id)}/messages`, {
        method: 'POST',
        body: { text }
      });
      const nextMessage = payload?.message;
      const nextConversation = payload?.conversation;
      if (nextConversation?.id) {
        const index = state.conversations.findIndex((entry) => entry.id === nextConversation.id);
        if (index >= 0) state.conversations.splice(index, 1, nextConversation);
        else state.conversations.unshift(nextConversation);
        state.conversationsById.set(nextConversation.id, nextConversation);
      }
      if (nextMessage?.id) {
        const current = state.messagesByConversation.get(conversation.id) || [];
        state.messagesByConversation.set(conversation.id, [...current, nextMessage]);
      }
      elements.messageInput.value = '';
      setComposerStatus('Message sent.', 'success');
      renderConversationList();
      renderTabs();
      renderActiveConversationHeader();
      renderMessages();
    } catch (error) {
      if (isAuthError(error)) {
        setComposerStatus('Create an account or log in to send messages.', 'error');
        promptForAuth('Create an account or log in to send messages.');
        return;
      }
      setComposerStatus(error.message || 'Failed to send.', 'error');
      showToast(error.message || 'Failed to send.', 'error');
    } finally {
      elements.sendMessageBtn.disabled = false;
      syncMainView();
    }
  }

  async function deleteActiveConversation() {
    const conversation = getActiveConversation();
    if (!conversation) return;
    if (!confirm(`Delete chat with ${conversation.partnerEmail}? This will hide it from your list.`)) return;
    try {
      await authedRequest(`/conversations/${encodeURIComponent(conversation.id)}`, { method: 'DELETE' });
      state.conversations = state.conversations.filter((entry) => entry.id !== conversation.id);
      state.conversationsById.delete(conversation.id);
      state.messagesByConversation.delete(conversation.id);
      closeConversationTab(conversation.id);
      renderConversationList();
      showToast('Chat deleted.', 'success');
    } catch (error) {
      if (isAuthError(error)) {
        promptForAuth('Create an account or log in to manage chats.');
        return;
      }
      showToast(error.message || 'Could not delete chat.', 'error');
    }
  }

  function startPolling() {
    stopPolling();
    state.pollingTimer = window.setInterval(async () => {
      if (document.hidden || !state.currentUser) return;
      await loadConversations({ quiet: true });
      if (state.activeConversationId) {
        await fetchMessages(state.activeConversationId, { quiet: true });
      }
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (!state.pollingTimer) return;
    window.clearInterval(state.pollingTimer);
    state.pollingTimer = null;
  }

  function handleAuthChange(user) {
    state.currentUser = user || null;
    setLoginStatus(state.currentUser);
    if (!state.currentUser) {
      stopPolling();
      setComposerStatus('Log in to start chatting.', 'muted');
      loadConversations({ quiet: true });
      return;
    }
    closeAuthPromptModal();
    startPolling();
    setComposerStatus('', 'muted');
    void loadConversations({ quiet: true });
  }

  async function initAuth() {
    try {
      state.authApi = await ensureAuthReady();
      state.currentUser = state.authApi.getCurrentUser?.() || null;
      setLoginStatus(state.currentUser);
      state.authApi.onAuthStateChanged?.((user) => {
        handleAuthChange(user);
      });
      if (state.currentUser) startPolling();
      await loadConversations({ quiet: true });
    } catch (error) {
      setLoginStatus(null);
      setComposerStatus(error.message || 'Auth failed to load.', 'error');
    }
  }

  function bindElements() {
    elements.chatLoginStatus = document.getElementById('chatLoginStatus');
    elements.newChatBtn = document.getElementById('newChatBtn');
    elements.refreshChatsBtn = document.getElementById('refreshChatsBtn');
    elements.conversationFilterInput = document.getElementById('conversationFilterInput');
    elements.conversationList = document.getElementById('conversationList');
    elements.chatTabs = document.getElementById('chatTabs');
    elements.newTabBtn = document.getElementById('newTabBtn');
    elements.chatEmptyState = document.getElementById('chatEmptyState');
    elements.chatView = document.getElementById('chatView');
    elements.activeChatTitle = document.getElementById('activeChatTitle');
    elements.activeChatMeta = document.getElementById('activeChatMeta');
    elements.closeTabBtn = document.getElementById('closeTabBtn');
    elements.deleteChatBtn = document.getElementById('deleteChatBtn');
    elements.messageList = document.getElementById('messageList');
    elements.messageComposer = document.getElementById('messageComposer');
    elements.messageInput = document.getElementById('messageInput');
    elements.sendMessageBtn = document.getElementById('sendMessageBtn');
    elements.composerStatus = document.getElementById('composerStatus');
    elements.newChatModal = document.getElementById('newChatModal');
    elements.newChatModalCloseBtn = document.getElementById('newChatModalCloseBtn');
    elements.newChatForm = document.getElementById('newChatForm');
    elements.newChatEmailInput = document.getElementById('newChatEmailInput');
    elements.newChatFormStatus = document.getElementById('newChatFormStatus');
    elements.cancelNewChatBtn = document.getElementById('cancelNewChatBtn');
    elements.authPromptModal = document.getElementById('authPromptModal');
    elements.authPromptMessage = document.getElementById('authPromptMessage');
    elements.authPromptCloseBtn = document.getElementById('authPromptCloseBtn');
    elements.authPromptCancelBtn = document.getElementById('authPromptCancelBtn');
    elements.authPromptSignupBtn = document.getElementById('authPromptSignupBtn');
    elements.authPromptLoginBtn = document.getElementById('authPromptLoginBtn');
  }

  function bindEvents() {
    elements.newChatBtn.addEventListener('click', () => {
      if (!state.currentUser) {
        promptForAuth('Create an account or log in to start a chat.');
        return;
      }
      openNewChatModal();
    });

    elements.newTabBtn.addEventListener('click', () => {
      if (!state.currentUser) {
        promptForAuth('Create an account or log in to open a chat tab.');
        return;
      }
      openNewChatModal();
    });

    elements.refreshChatsBtn.addEventListener('click', async () => {
      if (!state.currentUser) {
        promptForAuth('Create an account or log in to load chats.');
        return;
      }
      await loadConversations();
      if (state.activeConversationId) {
        await fetchMessages(state.activeConversationId);
      }
      showToast('Chats refreshed.', 'success', 900);
    });

    elements.conversationFilterInput.addEventListener('input', () => {
      state.filterText = String(elements.conversationFilterInput.value || '').trim();
      renderConversationList();
    });

    elements.closeTabBtn.addEventListener('click', () => {
      if (!state.activeConversationId) return;
      closeConversationTab(state.activeConversationId);
    });

    elements.deleteChatBtn.addEventListener('click', () => {
      void deleteActiveConversation();
    });

    elements.messageComposer.addEventListener('submit', (event) => {
      void sendMessage(event);
    });

    elements.messageInput.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        void sendMessage(event);
      }
    });

    elements.newChatForm.addEventListener('submit', (event) => {
      void submitNewChatForm(event);
    });
    elements.cancelNewChatBtn.addEventListener('click', closeNewChatModal);
    elements.newChatModalCloseBtn.addEventListener('click', closeNewChatModal);
    elements.newChatModal.addEventListener('click', (event) => {
      if (event.target === elements.newChatModal) closeNewChatModal();
    });
    elements.authPromptCancelBtn.addEventListener('click', closeAuthPromptModal);
    elements.authPromptCloseBtn.addEventListener('click', closeAuthPromptModal);
    elements.authPromptModal.addEventListener('click', (event) => {
      if (event.target === elements.authPromptModal) closeAuthPromptModal();
    });
    elements.authPromptLoginBtn.addEventListener('click', () => {
      closeAuthPromptModal();
      ensureAuthModalOpen('login');
    });
    elements.authPromptSignupBtn.addEventListener('click', () => {
      closeAuthPromptModal();
      ensureAuthModalOpen('signup');
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeNewChatModal();
        closeAuthPromptModal();
      }
    });

    window.addEventListener('pagehide', () => {
      stopPolling();
    });
  }

  async function init() {
    bindElements();
    bindEvents();
    state.apiBases = buildApiBases();
    setComposerStatus('Loading chat...', 'muted');
    renderConversationList();
    renderTabs();
    syncMainView();
    await initAuth();
    syncMainView();
  }

  document.addEventListener('DOMContentLoaded', () => {
    void init();
  });
})();
