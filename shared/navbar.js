function detectBasePath() {
  const appRoots = new Set(['home', 'movies', 'tv', 'search', 'settings', 'random', 'test', 'shared', 'index.html']);
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (!parts.length) return '';
  
  const appRootIndex = parts.findIndex((part) => appRoots.has(part));
  if (appRootIndex >= 0) {
    if (appRootIndex === 0) return '';
    return `/${parts.slice(0, appRootIndex).join('/')}`;
  }
  
  if (parts[0] === 'gh' && parts.length >= 3) {
    return `/${parts.slice(0, 3).join('/')}`;
  }
  if (parts[0] === 'npm' && parts.length >= 2) {
    return `/${parts.slice(0, 2).join('/')}`;
  }
  if (parts.length === 1) {
    return `/${parts[0]}`;
  }
  return '';
}

const BASE_PATH = detectBasePath();
const NAVBAR_ASSET_CACHE_KEY = 'bilm-navbar-assets-v2';
const NAVBAR_ASSET_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const LEGACY_NAVBAR_ASSET_CACHE_KEYS = ['bilm-navbar-assets-v1'];

function withBase(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${BASE_PATH}${normalized}`;
}

function readCachedNavbarAssets() {
  try {
    const raw = localStorage.getItem(NAVBAR_ASSET_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const cachedAtMs = Number(parsed?.cachedAtMs || 0);
    if (!parsed?.html || !parsed?.css || !cachedAtMs) return null;
    if (Date.now() - cachedAtMs > NAVBAR_ASSET_CACHE_MAX_AGE_MS) return null;
    return {
      html: String(parsed.html),
      css: String(parsed.css)
    };
  } catch {
    return null;
  }
}

function writeCachedNavbarAssets(html, css) {
  if (!html || !css) return;
  try {
    localStorage.setItem(NAVBAR_ASSET_CACHE_KEY, JSON.stringify({
      cachedAtMs: Date.now(),
      html,
      css
    }));
  } catch {
    // Ignore storage failures.
  }
}

function purgeLegacyNavbarAssetCache() {
  LEGACY_NAVBAR_ASSET_CACHE_KEYS.forEach((key) => {
    if (!key || key === NAVBAR_ASSET_CACHE_KEY) return;
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore storage failures.
    }
  });
}

function normalizeShadowBaseRoutes(shadowRoot) {
  if (!shadowRoot) return;

  shadowRoot.querySelectorAll('a[href]').forEach((anchor) => {
    const explicitRoute = String(anchor.getAttribute('data-route') || '').trim();
    const href = String(anchor.getAttribute('href') || '').trim();
    if (explicitRoute) {
      anchor.setAttribute('href', withBase(explicitRoute));
      return;
    }
    if (href.startsWith('/')) {
      anchor.setAttribute('href', withBase(href));
    }
  });

  shadowRoot.querySelectorAll('form[action]').forEach((form) => {
    const explicitAction = String(form.getAttribute('data-route-action') || '').trim();
    const action = String(form.getAttribute('action') || '').trim();
    if (explicitAction) {
      form.setAttribute('action', withBase(explicitAction));
      return;
    }
    if (action.startsWith('/')) {
      form.setAttribute('action', withBase(action));
    }
  });
}

function renderNavbarSkeleton(shadow) {
  shadow.innerHTML = `
    <style>
      :host {
        display: block;
        font-family: 'Poppins', sans-serif;
      }
      .bilm-navbar-skeleton {
        height: 64px;
        width: 100%;
        border-bottom: 1px solid rgba(255, 255, 255, 0.12);
        background: linear-gradient(90deg, rgba(22, 19, 36, 0.95), rgba(30, 24, 44, 0.95), rgba(22, 19, 36, 0.95));
        background-size: 240% 100%;
        animation: bilm-navbar-skeleton-shimmer 1.2s linear infinite;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 20px;
        box-sizing: border-box;
      }
      .bilm-navbar-skeleton-logo {
        color: rgba(245, 243, 255, 0.95);
        font-weight: 700;
        font-size: 1.25rem;
        letter-spacing: 0.01em;
      }
      .bilm-navbar-skeleton-pill {
        width: 120px;
        height: 14px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.18);
      }
      @keyframes bilm-navbar-skeleton-shimmer {
        0% { background-position: 100% 0; }
        100% { background-position: 0 0; }
      }
      @media (max-width: 768px) {
        .bilm-navbar-skeleton {
          height: 58px;
          padding: 10px 14px;
        }
        .bilm-navbar-skeleton-pill {
          width: 88px;
        }
      }
    </style>
    <div class="bilm-navbar-skeleton" role="presentation" aria-hidden="true">
      <div class="bilm-navbar-skeleton-logo">Bilm</div>
      <div class="bilm-navbar-skeleton-pill"></div>
    </div>
  `;
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

function loadToastScript() {
  return new Promise((resolve, reject) => {
    if (window.bilmToast?.show) {
      resolve(window.bilmToast);
      return;
    }
    const src = withBase('/shared/toast.js');
    const existing = document.querySelector(`script[data-bilm-toast="${src}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.bilmToast), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load toast module.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.dataset.bilmToast = src;
    script.addEventListener('load', () => resolve(window.bilmToast), { once: true });
    script.addEventListener('error', () => reject(new Error('Failed to load toast module.')), { once: true });
    document.head.appendChild(script);
  });
}

function loadProxyGateScript() {
  return new Promise((resolve, reject) => {
    if (window.bilmProxyGate) {
      resolve(window.bilmProxyGate);
      return;
    }
    const src = withBase('/shared/proxy-gate.js');
    const existing = document.querySelector(`script[data-bilm-proxy-gate="${src}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.bilmProxyGate), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load proxy gate module.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.dataset.bilmProxyGate = src;
    script.addEventListener('load', () => resolve(window.bilmProxyGate), { once: true });
    script.addEventListener('error', () => reject(new Error('Failed to load proxy gate module.')), { once: true });
    document.head.appendChild(script);
  });
}

async function maybeActivateProxiedMode() {
  try {
    const proxyGate = await loadProxyGateScript();
    if (!proxyGate?.activateProxiedMode) return false;
    return await proxyGate.activateProxiedMode({
      targetUrl: 'https://bilm-scramjet.fly.dev/',
      timeoutMs: 7000
    });
  } catch {
    return false;
  }
}

(async () => {
  if (await maybeActivateProxiedMode()) {
    return;
  }

  purgeLegacyNavbarAssetCache();

  const container = document.getElementById('navbar-placeholder') || document.getElementById('navbarContainer');
  if (!container) return;

  document.body.classList.add('has-fixed-navbar');

  const shadow = container.shadowRoot || container.attachShadow({ mode: 'open' });
  renderNavbarSkeleton(shadow);

  let html = '';
  let css = '';
  const cachedAssets = readCachedNavbarAssets();
  if (cachedAssets?.html && cachedAssets?.css) {
    html = cachedAssets.html;
    css = cachedAssets.css;
  } else {
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
      writeCachedNavbarAssets(html, css);
    } catch (error) {
      console.error('Failed to load navbar assets:', error);
      return;
    }
  }

  shadow.innerHTML = `<style>${css}</style>${html}`;
  normalizeShadowBaseRoutes(shadow);

  const globalBanner = shadow.getElementById('globalBanner');
  const globalBannerCloseBtn = shadow.getElementById('globalBannerCloseBtn');
  const accountMenuWrap = shadow.getElementById('navbarAccountMenuWrap');
  const accountMenu = shadow.getElementById('navbarAccountMenu');
  const accountLoginBtn = shadow.getElementById('navbarAccountLoginBtn');
  const accountSignUpBtn = shadow.getElementById('navbarAccountSignUpBtn');
  const accountSettingsBtn = shadow.getElementById('navbarAccountSettingsBtn');
  const accountManualSyncBtn = shadow.getElementById('navbarAccountManualSyncBtn');
  const accountSignOutBtn = shadow.getElementById('navbarAccountSignOutBtn');
  const accountMenuHint = shadow.getElementById('navbarAccountMenuHint');
  const authModal = shadow.getElementById('navbarAuthModal');
  const authModalCloseBtn = shadow.getElementById('navbarAuthCloseBtn');
  const authForm = shadow.getElementById('navbarAuthForm');
  const authEmailInput = shadow.getElementById('navbarAuthEmail');
  const authPasswordInput = shadow.getElementById('navbarAuthPassword');
  const authPasswordToggleBtn = shadow.getElementById('navbarAuthPasswordToggleBtn');
  const authStatus = shadow.getElementById('navbarAuthStatus');
  const authSubmitBtn = shadow.getElementById('navbarAuthSubmitBtn');
  const authSwitchBtn = shadow.getElementById('navbarAuthSwitchBtn');
  const authTitle = shadow.getElementById('navbarAuthTitle');
  const authHint = shadow.getElementById('navbarAuthHint');

  loadToastScript().catch((error) => {
    console.warn('Toast module unavailable:', error);
  });

  function showToast(message, tone = 'info', duration = 1000) {
    window.bilmToast?.show?.(message, { tone, duration });
  }


  const ACCOUNT_MANUAL_SYNC_COOLDOWN_MS = 5000;
  let authApiInstance = null;
  let accountManualSyncCooldownUntil = 0;
  let accountManualSyncCooldownTimer = null;
  let authDialogMode = 'login';
  let authPasswordVisible = false;

  function cleanupLegacyChatState() {
    const CHAT_STORAGE_KEY = 'bilm-shared-chat';
    const SYNC_META_KEY = 'bilm-sync-meta';
    const CHAT_SYNC_CURSOR_META_KEY = 'lastChatSyncCursorMs';
    const SYNC_USER_STATE_META_KEY = 'userSyncState';

    try {
      localStorage.removeItem(CHAT_STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }

    try {
      const raw = localStorage.getItem(SYNC_META_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;

      let changed = false;
      if (Object.prototype.hasOwnProperty.call(parsed, CHAT_SYNC_CURSOR_META_KEY)) {
        delete parsed[CHAT_SYNC_CURSOR_META_KEY];
        changed = true;
      }

      const scoped = parsed[SYNC_USER_STATE_META_KEY];
      if (scoped && typeof scoped === 'object' && !Array.isArray(scoped)) {
        Object.keys(scoped).forEach((userKey) => {
          const userState = scoped[userKey];
          if (!userState || typeof userState !== 'object' || Array.isArray(userState)) return;
          if (!Object.prototype.hasOwnProperty.call(userState, CHAT_SYNC_CURSOR_META_KEY)) return;
          delete userState[CHAT_SYNC_CURSOR_META_KEY];
          changed = true;
        });
      }

      if (changed) {
        localStorage.setItem(SYNC_META_KEY, JSON.stringify(parsed));
      }
    } catch {
      // Ignore storage failures.
    }
  }

  cleanupLegacyChatState();

  const pathParts = location.pathname.split('/').filter(Boolean);
  const appSections = new Set(['home', 'movies', 'tv', 'search', 'settings', 'random', 'test']);
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
  function closeAccountMenu() {
    if (!accountMenu || !accountBtn) return;
    accountMenu.hidden = true;
    accountBtn.setAttribute('aria-expanded', 'false');
  }

  function openAccountMenu() {
    if (!accountMenu || !accountBtn) return;
    accountMenu.hidden = false;
    accountBtn.setAttribute('aria-expanded', 'true');
  }

  function setAuthPasswordVisibility(visible) {
    const shouldShow = Boolean(visible);
    authPasswordVisible = shouldShow;
    if (!authPasswordInput) return;

    authPasswordInput.type = shouldShow ? 'text' : 'password';
    if (!authPasswordToggleBtn) return;
    authPasswordToggleBtn.setAttribute('aria-label', shouldShow ? 'Hide password' : 'Show password');
    authPasswordToggleBtn.setAttribute('title', shouldShow ? 'Hide password' : 'Show password');
  }

  function setAuthModalMode(mode = 'login') {
    const normalized = mode === 'signup' ? 'signup' : 'login';
    authDialogMode = normalized;
    if (!authTitle || !authHint || !authSubmitBtn || !authSwitchBtn || !authPasswordInput) return;
    if (normalized === 'signup') {
      authTitle.textContent = 'Sign Up';
      authHint.textContent = 'Create an account with your email and password.';
      authSubmitBtn.textContent = 'Create Account';
      authSwitchBtn.textContent = 'Already have an account?';
      authPasswordInput.autocomplete = 'new-password';
    } else {
      authTitle.textContent = 'Log In';
      authHint.textContent = 'Use your email and password.';
      authSubmitBtn.textContent = 'Log In';
      authSwitchBtn.textContent = 'Create account';
      authPasswordInput.autocomplete = 'current-password';
    }
    setAuthPasswordVisibility(false);
    if (authStatus) authStatus.textContent = '';
  }

  function openAuthModal(mode = 'login') {
    if (!authModal) return;
    setAuthModalMode(mode);
    authModal.hidden = false;
    if (authEmailInput) {
      authEmailInput.focus();
    }
  }

  function closeAuthModal() {
    if (!authModal) return;
    authModal.hidden = true;
    if (authStatus) authStatus.textContent = '';
    if (authPasswordInput) authPasswordInput.value = '';
    setAuthPasswordVisibility(false);
  }

  window.bilmAuthUi = window.bilmAuthUi || {};
  window.bilmAuthUi.open = (mode = 'login') => openAuthModal(mode);
  window.bilmAuthUi.close = () => closeAuthModal();
  window.dispatchEvent(new CustomEvent('bilm:auth-modal-ready'));
  window.addEventListener('bilm:open-auth-modal', (event) => {
    const mode = String(event?.detail?.mode || '').trim().toLowerCase() === 'signup'
      ? 'signup'
      : 'login';
    openAuthModal(mode);
  });

  function updateManualSyncCooldownUi() {
    if (!accountManualSyncBtn) return;
    const remainingMs = accountManualSyncCooldownUntil - Date.now();
    if (remainingMs <= 0) {
      accountManualSyncBtn.disabled = false;
      accountManualSyncBtn.textContent = 'Manual Sync';
      return;
    }
    const seconds = Math.ceil(remainingMs / 1000);
    accountManualSyncBtn.disabled = true;
    accountManualSyncBtn.textContent = `Manual Sync (${seconds}s)`;
  }

  function startManualSyncCooldown() {
    accountManualSyncCooldownUntil = Date.now() + ACCOUNT_MANUAL_SYNC_COOLDOWN_MS;
    if (accountManualSyncCooldownTimer) {
      window.clearInterval(accountManualSyncCooldownTimer);
      accountManualSyncCooldownTimer = null;
    }
    updateManualSyncCooldownUi();
    accountManualSyncCooldownTimer = window.setInterval(() => {
      if (Date.now() < accountManualSyncCooldownUntil) {
        updateManualSyncCooldownUi();
        return;
      }
      window.clearInterval(accountManualSyncCooldownTimer);
      accountManualSyncCooldownTimer = null;
      updateManualSyncCooldownUi();
    }, 250);
  }

  async function runNavbarManualSync(authApi) {
    if (!authApi) {
      showToast('Sync services unavailable.', 'error');
      return;
    }
    if (Date.now() < accountManualSyncCooldownUntil) return;
    startManualSyncCooldown();
    authApi.noteUserActivity?.('navbar-manual-sync');
    const currentUser = authApi.getCurrentUser?.() || null;
    if (!currentUser) {
      if (accountMenuHint) accountMenuHint.textContent = 'Log in required for manual sync.';
      showToast('Log in required.', 'error');
      return;
    }
    showToast('Syncing...', 'info', 0);
    try {
      await authApi.syncFromCloudNow?.();
      await authApi.flushSyncNow?.('navbar-manual-sync');
      showToast('Sync complete.', 'success');
    } catch (error) {
      console.warn('Navbar manual sync failed:', error);
      showToast('Manual sync failed.', 'error');
    }
  }

  if (accountBtn) {
    accountBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      authApiInstance?.noteUserActivity?.('account-menu-toggle');
      const nextOpen = accountMenu?.hidden !== false;
      if (nextOpen) {
        openAccountMenu();
      } else {
        closeAccountMenu();
      }
    });
  }

  if (accountSettingsBtn) {
    accountSettingsBtn.addEventListener('click', () => {
      closeAccountMenu();
      window.location.href = withBase('/settings/account/');
    });
  }

  if (accountLoginBtn) {
    accountLoginBtn.addEventListener('click', () => {
      closeAccountMenu();
      openAuthModal('login');
    });
  }

  if (accountSignUpBtn) {
    accountSignUpBtn.addEventListener('click', () => {
      closeAccountMenu();
      openAuthModal('signup');
    });
  }

  if (accountManualSyncBtn) {
    accountManualSyncBtn.addEventListener('click', async () => {
      await runNavbarManualSync(authApiInstance);
    });
  }

  if (accountSignOutBtn) {
    accountSignOutBtn.addEventListener('click', async () => {
      if (!authApiInstance) {
        showToast('Sign out unavailable right now.', 'error');
        return;
      }
      try {
        await authApiInstance.signOut?.();
        closeAccountMenu();
        showToast('Signed out.', 'success');
      } catch (error) {
        console.warn('Navbar sign out failed:', error);
        showToast('Sign out failed.', 'error');
      }
    });
  }

  if (authSwitchBtn) {
    authSwitchBtn.addEventListener('click', () => {
      setAuthModalMode(authDialogMode === 'login' ? 'signup' : 'login');
    });
  }

  if (authPasswordToggleBtn) {
    authPasswordToggleBtn.addEventListener('click', () => {
      setAuthPasswordVisibility(!authPasswordVisible);
      authPasswordInput?.focus();
    });
  }

  if (authModalCloseBtn) {
    authModalCloseBtn.addEventListener('click', () => {
      closeAuthModal();
    });
  }

  if (authModal) {
    authModal.addEventListener('click', (event) => {
      if (event.target === authModal) {
        closeAuthModal();
      }
    });
  }

  if (authForm) {
    authForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!authApiInstance) {
        if (authStatus) authStatus.textContent = 'Account services are unavailable right now.';
        showToast('Account services unavailable.', 'error');
        return;
      }
      const email = String(authEmailInput?.value || '').trim();
      const password = String(authPasswordInput?.value || '');
      if (!email || !password) {
        if (authStatus) authStatus.textContent = 'Email and password are required.';
        return;
      }
      if (authStatus) authStatus.textContent = authDialogMode === 'signup' ? 'Creating account...' : 'Signing in...';
      try {
        if (authDialogMode === 'signup') {
          await authApiInstance.signUp?.(email, password);
          showToast('Account created.', 'success');
        } else {
          await authApiInstance.signIn?.(email, password);
          showToast('Logged in.', 'success');
        }
        closeAuthModal();
        closeAccountMenu();
      } catch (error) {
        const message = String(error?.message || 'Authentication failed.');
        if (authStatus) authStatus.textContent = message;
        showToast(message, 'error');
      }
    });
  }

  document.addEventListener('click', (event) => {
    if (!accountMenu || accountMenu.hidden) return;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    if (path.includes(accountMenuWrap)) return;
    closeAccountMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAccountMenu();
      closeAuthModal();
    }
  });

  setAuthModalMode('login');
  updateManualSyncCooldownUi();

  loadAuthScript().then(async (authApi) => {
    authApiInstance = authApi;
    await authApi.init();

    const syncAccountButton = (user) => {
      if (!accountBtn) return;
      accountBtn.textContent = user ? (user.displayName || user.email || 'Account') : 'Account';
      accountBtn.title = user ? 'Open account settings / log out' : 'Log in or create account';
      if (accountLoginBtn) accountLoginBtn.hidden = Boolean(user);
      if (accountSignUpBtn) accountSignUpBtn.hidden = Boolean(user);
      if (accountSignOutBtn) accountSignOutBtn.hidden = !user;
      if (accountMenuHint) {
        accountMenuHint.textContent = user
          ? `Signed in as ${user.displayName || user.email || 'account user'}.`
          : 'Log in for cloud sync.';
      }
    };

    syncAccountButton(authApi.getCurrentUser());
    authApi.onAuthStateChanged?.(syncAccountButton);
    updateManualSyncCooldownUi();
  }).catch((error) => {
    console.warn('Auth module unavailable in navbar:', error);
    closeAccountMenu();
    if (accountBtn) {
      accountBtn.textContent = 'Account';
      accountBtn.title = 'Open account settings';
    }
    if (accountLoginBtn) accountLoginBtn.hidden = true;
    if (accountSignUpBtn) accountSignUpBtn.hidden = true;
    if (accountSignOutBtn) accountSignOutBtn.hidden = true;
    if (accountManualSyncBtn) accountManualSyncBtn.disabled = true;
    if (accountMenuHint) {
      accountMenuHint.textContent = 'Account services unavailable. Use Account Settings.';
    }
  });

  const searchInput = shadow.querySelector('#searchInput');
  const navbarSearchForm = shadow.getElementById('navbarSearchForm');
  const desktopClearBtn = shadow.getElementById('desktopSearchClearBtn');
  if (navbarSearchForm && searchInput) {
    navbarSearchForm.setAttribute('action', withBase('/search/'));
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

