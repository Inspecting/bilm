(() => {
  const DEFAULT_PROXY_URL = 'https://bilm-scramjet.fly.dev/';
  const SHELL_ID = 'bilmProxyShell';
  const SHELL_STYLE_ID = 'bilmProxyShellStyle';
  const AUTH_HINT_KEY = 'bilm-auth-last-known';
  const AUTH_TIMEOUT_MS = 7000;
  const AUTH_STATE_TIMEOUT_MS = 1200;
  const FRAME_LOAD_TIMEOUT_MS = 20000;
  const MAX_AUTO_RETRIES = 2;

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
        // Fall through to pathname parsing.
      }
    }

    const parts = window.location.pathname.split('/').filter(Boolean);
    if (!parts.length || appRoots.has(parts[0])) return '';
    if (parts.length > 1 && appRoots.has(parts[1])) return `/${parts[0]}`;
    return '';
  }

  function withBase(path) {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return `${detectBasePath()}${normalized}`;
  }

  function withTimeout(taskPromise, timeoutMs) {
    let timerId = null;
    return Promise.race([
      Promise.resolve(taskPromise),
      new Promise((_, reject) => {
        timerId = setTimeout(() => reject(new Error('Timed out')), timeoutMs);
      })
    ]).finally(() => {
      if (timerId) clearTimeout(timerId);
    });
  }

  function loadScriptOnce(src, datasetKey) {
    return new Promise((resolve, reject) => {
      const selector = `script[${datasetKey}="${src}"]`;
      const existing = document.querySelector(selector);
      if (existing) {
        if (existing.dataset.loaded === '1') {
          resolve();
          return;
        }
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Failed loading ${src}`)), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.defer = true;
      script.setAttribute(datasetKey, src);
      script.addEventListener('load', () => {
        script.dataset.loaded = '1';
        resolve();
      }, { once: true });
      script.addEventListener('error', () => reject(new Error(`Failed loading ${src}`)), { once: true });
      document.head.appendChild(script);
    });
  }

  async function loadAuthScript(timeoutMs = AUTH_TIMEOUT_MS) {
    if (window.bilmAuth) return window.bilmAuth;
    const src = withBase('/shared/auth.js');
    await withTimeout(loadScriptOnce(src, 'data-bilm-auth'), timeoutMs);
    return window.bilmAuth || null;
  }

  async function ensureAuthReady(options = {}) {
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || AUTH_TIMEOUT_MS));
    try {
      const authApi = window.bilmAuth || await loadAuthScript(timeoutMs);
      if (!authApi || typeof authApi.init !== 'function') return null;
      await withTimeout(authApi.init(), timeoutMs);
      return authApi;
    } catch {
      return null;
    }
  }

  async function resolveCurrentUser(options = {}) {
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || AUTH_TIMEOUT_MS));
    const stateTimeoutMs = Math.max(250, Number(options.stateTimeoutMs || AUTH_STATE_TIMEOUT_MS));
    const authApi = await ensureAuthReady({ timeoutMs });
    if (!authApi) {
      writeAuthHint(false);
      return null;
    }

    try {
      const current = authApi.getCurrentUser?.();
      if (current) {
        writeAuthHint(true);
        return current;
      }

      if (typeof authApi.onAuthStateChanged !== 'function') {
        writeAuthHint(false);
        return null;
      }

      return await new Promise((resolve) => {
        let settled = false;
        let unsubscribe = () => {};
        const complete = (user) => {
          if (settled) return;
          settled = true;
          writeAuthHint(Boolean(user));
          try {
            unsubscribe();
          } catch {
            // Ignore cleanup failures.
          }
          resolve(user || null);
        };

        const timerId = setTimeout(() => {
          complete(authApi.getCurrentUser?.() || null);
        }, stateTimeoutMs);

        try {
          unsubscribe = authApi.onAuthStateChanged((user) => {
            clearTimeout(timerId);
            complete(user || null);
          });
        } catch {
          clearTimeout(timerId);
          complete(authApi.getCurrentUser?.() || null);
        }
      });
    } catch {
      writeAuthHint(false);
      return null;
    }
  }

  function getSettings() {
    return window.bilmTheme?.getSettings?.() || {};
  }

  function readAuthHint() {
    try {
      return localStorage.getItem(AUTH_HINT_KEY) === '1';
    } catch {
      return false;
    }
  }

  function writeAuthHint(isLoggedIn) {
    try {
      localStorage.setItem(AUTH_HINT_KEY, isLoggedIn ? '1' : '0');
    } catch {
      // Ignore storage errors.
    }
  }

  function setProxiedEnabled(enabled) {
    const current = getSettings();
    if (window.bilmTheme?.setSettings) {
      window.bilmTheme.setSettings({ ...current, proxied: enabled === true });
      return;
    }
    try {
      localStorage.setItem('bilm-theme-settings', JSON.stringify({ ...current, proxied: enabled === true }));
    } catch {
      // Ignore storage errors.
    }
  }

  async function getEligibility(options = {}) {
    const user = await resolveCurrentUser(options);
    const proxiedEnabled = getSettings().proxied === true;
    return {
      user,
      proxiedEnabled,
      eligible: Boolean(user && proxiedEnabled)
    };
  }

  function ensureShellStyles() {
    if (document.getElementById(SHELL_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = SHELL_STYLE_ID;
    style.textContent = `
      #${SHELL_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        background: #05050b;
        color: #f8f8ff;
        display: flex;
        flex-direction: column;
      }

      #${SHELL_ID} .bilm-proxy-shell__topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-height: 56px;
        padding: 10px 14px;
        background: rgba(5, 5, 11, 0.95);
        border-bottom: 1px solid rgba(255, 255, 255, 0.15);
      }

      #${SHELL_ID} .bilm-proxy-shell__title {
        font-size: 0.95rem;
        font-weight: 700;
        white-space: nowrap;
      }

      #${SHELL_ID} .bilm-proxy-shell__status {
        font-size: 0.85rem;
        opacity: 0.9;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
      }

      #${SHELL_ID} .bilm-proxy-shell__actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      #${SHELL_ID} .bilm-proxy-shell__button {
        border: 1px solid rgba(255, 255, 255, 0.25);
        background: rgba(255, 255, 255, 0.08);
        color: #f8f8ff;
        border-radius: 8px;
        font: inherit;
        font-size: 0.8rem;
        padding: 7px 10px;
        cursor: pointer;
      }

      #${SHELL_ID} .bilm-proxy-shell__button:hover {
        background: rgba(255, 255, 255, 0.16);
      }

      #${SHELL_ID} .bilm-proxy-shell__button--danger {
        border-color: rgba(248, 113, 113, 0.5);
        background: rgba(127, 29, 29, 0.4);
      }

      #${SHELL_ID} .bilm-proxy-shell__frame-wrap {
        position: relative;
        flex: 1;
        min-height: 0;
      }

      #${SHELL_ID} .bilm-proxy-shell__frame {
        width: 100%;
        height: 100%;
        border: none;
        background: #05050b;
      }

      #${SHELL_ID} .bilm-proxy-shell__error {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(5, 5, 11, 0.9);
        padding: 16px;
      }

      #${SHELL_ID} .bilm-proxy-shell__error[hidden] {
        display: none !important;
      }

      #${SHELL_ID} .bilm-proxy-shell__error-panel {
        max-width: 520px;
        width: min(100%, 520px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 12px;
        padding: 18px;
        background: rgba(17, 24, 39, 0.95);
        display: grid;
        gap: 12px;
      }

      #${SHELL_ID} .bilm-proxy-shell__error-panel h2 {
        margin: 0;
        font-size: 1rem;
      }

      #${SHELL_ID} .bilm-proxy-shell__error-panel p {
        margin: 0;
        font-size: 0.88rem;
        line-height: 1.4;
        color: rgba(248, 250, 252, 0.9);
      }
    `;
    document.head.appendChild(style);
  }

  function unmountProxiedShell() {
    const shell = document.getElementById(SHELL_ID);
    if (shell) shell.remove();
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }

  function mountProxiedShell(options = {}) {
    const targetUrl = String(options.targetUrl || DEFAULT_PROXY_URL).trim() || DEFAULT_PROXY_URL;
    const existing = document.getElementById(SHELL_ID);
    if (existing) return existing;

    ensureShellStyles();

    const shell = document.createElement('div');
    shell.id = SHELL_ID;
    shell.setAttribute('role', 'region');
    shell.setAttribute('aria-label', 'Bilm proxied mode');

    shell.innerHTML = `
      <div class="bilm-proxy-shell__topbar">
        <div class="bilm-proxy-shell__title">Bilm Proxied</div>
        <div class="bilm-proxy-shell__status" id="bilmProxyShellStatus">Loading proxied site...</div>
        <div class="bilm-proxy-shell__actions">
          <button type="button" class="bilm-proxy-shell__button bilm-proxy-shell__button--danger" id="bilmProxyExitBtn">Exit Proxied</button>
        </div>
      </div>
      <div class="bilm-proxy-shell__frame-wrap">
        <iframe class="bilm-proxy-shell__frame" id="bilmProxyFrame" referrerpolicy="no-referrer" allow="fullscreen; clipboard-read; clipboard-write; encrypted-media"></iframe>
        <div class="bilm-proxy-shell__error" id="bilmProxyErrorPanel" hidden>
          <div class="bilm-proxy-shell__error-panel">
            <h2>Proxy load problem</h2>
            <p>We could not fully load the proxied site in this embedded view yet.</p>
            <div class="bilm-proxy-shell__actions">
              <button type="button" class="bilm-proxy-shell__button" id="bilmProxyRetryBtn">Retry</button>
              <button type="button" class="bilm-proxy-shell__button" id="bilmProxyOpenTabBtn">Open in new tab</button>
            </div>
          </div>
        </div>
      </div>
    `;

    const frame = shell.querySelector('#bilmProxyFrame');
    const status = shell.querySelector('#bilmProxyShellStatus');
    const errorPanel = shell.querySelector('#bilmProxyErrorPanel');
    const exitBtn = shell.querySelector('#bilmProxyExitBtn');
    const retryBtn = shell.querySelector('#bilmProxyRetryBtn');
    const openTabBtn = shell.querySelector('#bilmProxyOpenTabBtn');
    let frameTimeoutId = null;
    let autoRetryCount = 0;

    const hideErrorPanel = (nextStatus = 'Loading proxied site...') => {
      errorPanel.hidden = true;
      status.textContent = nextStatus;
    };

    const showErrorPanel = () => {
      errorPanel.hidden = false;
      status.textContent = 'Proxy load issue detected.';
    };

    const setFrameSource = (url, forceRefresh = false, preserveRetryCount = false) => {
      if (!preserveRetryCount) {
        autoRetryCount = 0;
      }
      hideErrorPanel(preserveRetryCount ? `Retrying proxy load (${autoRetryCount}/${MAX_AUTO_RETRIES})...` : 'Loading proxied site...');
      if (frameTimeoutId) clearTimeout(frameTimeoutId);
      frameTimeoutId = setTimeout(() => {
        if (autoRetryCount < MAX_AUTO_RETRIES) {
          autoRetryCount += 1;
          setFrameSource(url, true, true);
          return;
        }
        showErrorPanel();
      }, FRAME_LOAD_TIMEOUT_MS);
      if (!forceRefresh) {
        frame.src = url;
        return;
      }
      const retryUrl = new URL(url, window.location.href);
      retryUrl.searchParams.set('_bilmRetry', String(Date.now()));
      frame.src = retryUrl.toString();
    };

    frame.addEventListener('load', () => {
      if (frameTimeoutId) clearTimeout(frameTimeoutId);
      autoRetryCount = 0;
      status.textContent = 'Proxied mode active.';
      errorPanel.hidden = true;
    });

    frame.addEventListener('error', () => {
      if (frameTimeoutId) clearTimeout(frameTimeoutId);
      if (autoRetryCount < MAX_AUTO_RETRIES) {
        autoRetryCount += 1;
        setFrameSource(targetUrl, true, true);
        return;
      }
      showErrorPanel();
    });

    retryBtn.addEventListener('click', () => {
      setFrameSource(targetUrl, true, false);
    });

    openTabBtn.addEventListener('click', () => {
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    });

    exitBtn.addEventListener('click', () => {
      setProxiedEnabled(false);
      window.location.reload();
    });

    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.appendChild(shell);
    setFrameSource(targetUrl);
    return shell;
  }

  async function activateProxiedMode(options = {}) {
    if (getSettings().proxied !== true) {
      if (document.getElementById(SHELL_ID)) {
        unmountProxiedShell();
      }
      return false;
    }

    const existing = document.getElementById(SHELL_ID);
    if (existing) return true;

    let mountedFromHint = false;
    if (readAuthHint()) {
      mountProxiedShell(options);
      mountedFromHint = true;
    }

    const eligibility = await getEligibility(options);
    if (!eligibility.eligible) {
      if (mountedFromHint) {
        unmountProxiedShell();
      }
      return false;
    }

    if (!document.getElementById(SHELL_ID)) {
      mountProxiedShell(options);
    }
    return true;
  }

  window.bilmProxyGate = {
    DEFAULT_PROXY_URL,
    withBase,
    ensureAuthReady,
    resolveCurrentUser,
    getEligibility,
    mountProxiedShell,
    unmountProxiedShell,
    activateProxiedMode
  };
})();
