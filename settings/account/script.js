function detectBasePath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const appRoots = new Set(['home', 'movies', 'tv', 'games', 'search', 'settings', 'random', 'test', 'shared', 'index.html']);
  if (!parts.length || appRoots.has(parts[0])) return '';
  return `/${parts[0]}`;
}

function withBase(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${detectBasePath()}${normalized}`;
}

document.addEventListener('DOMContentLoaded', () => {
  const autoSyncToggle = document.getElementById('autoSyncToggle');
  const accountStatusText = document.getElementById('accountStatusText');
  const accountHintText = document.getElementById('accountHintText');
  const statusText = document.getElementById('statusText');

  const loginEmail = document.getElementById('loginEmail');
  const loginPassword = document.getElementById('loginPassword');
  const loginBtn = document.getElementById('loginBtn');

  const signUpEmail = document.getElementById('signUpEmail');
  const signUpPassword = document.getElementById('signUpPassword');
  const signUpBtn = document.getElementById('signUpBtn');

  const syncNowBtn = document.getElementById('syncNowBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const deletePassword = document.getElementById('deletePassword');
  const deleteAccountBtn = document.getElementById('deleteAccountBtn');

  const getSettings = () => window.bilmTheme?.getSettings?.() || {};
  const setSettings = (partial) => {
    const current = getSettings();
    window.bilmTheme?.setSettings?.({ ...current, ...partial });
  };

  function readStorage(storage) {
    return Object.entries(storage).reduce((all, [key, value]) => {
      all[key] = value;
      return all;
    }, {});
  }

  function collectBackupData() {
    return {
      schema: 'bilm-backup-v1',
      exportedAt: new Date().toISOString(),
      origin: location.origin,
      pathname: location.pathname,
      localStorage: readStorage(localStorage),
      sessionStorage: readStorage(sessionStorage),
      cookies: document.cookie
    };
  }

  function applyBackup(payload) {
    localStorage.clear();
    sessionStorage.clear();

    Object.entries(payload.localStorage || {}).forEach(([key, value]) => localStorage.setItem(key, value));
    Object.entries(payload.sessionStorage || {}).forEach(([key, value]) => sessionStorage.setItem(key, value));
  }

  function mergeSnapshots(localSnapshot, cloudSnapshot) {
    return {
      ...localSnapshot,
      ...cloudSnapshot,
      localStorage: {
        ...(localSnapshot.localStorage || {}),
        ...(cloudSnapshot.localStorage || {})
      },
      sessionStorage: {
        ...(localSnapshot.sessionStorage || {}),
        ...(cloudSnapshot.sessionStorage || {})
      },
      cookies: cloudSnapshot.cookies || localSnapshot.cookies || ''
    };
  }

  async function autoSyncAfterSignIn() {
    const localSnapshot = collectBackupData();
    const cloudSnapshot = await window.bilmAuth.getCloudSnapshot();
    if (!cloudSnapshot) {
      await window.bilmAuth.saveCloudSnapshot(localSnapshot);
      statusText.textContent = 'New account detected. Local data was merged into your account.';
      return;
    }
    const merged = mergeSnapshots(localSnapshot, cloudSnapshot);
    applyBackup(merged);
    await window.bilmAuth.saveCloudSnapshot(merged);
    statusText.textContent = 'Auto Sync complete. Reloading with your account data...';
    setTimeout(() => location.reload(), 300);
  }

  async function runManualSync() {
    const localSnapshot = collectBackupData();
    const cloudSnapshot = await window.bilmAuth.getCloudSnapshot();
    if (!cloudSnapshot) {
      await window.bilmAuth.saveCloudSnapshot(localSnapshot);
      statusText.textContent = 'No cloud data existed. Uploaded your local data.';
      return;
    }
    const merged = mergeSnapshots(localSnapshot, cloudSnapshot);
    applyBackup(merged);
    await window.bilmAuth.saveCloudSnapshot(merged);
    statusText.textContent = 'Sync complete. Reloading...';
    setTimeout(() => location.reload(), 250);
  }

  function updateUserUi(user) {
    const username = user?.displayName ? `@${user.displayName}` : '';
    const email = user?.email ? ` (${user.email})` : '';
    accountStatusText.textContent = user ? `Logged in ${username}${email}` : 'You are not signed in.';
    accountHintText.textContent = user
      ? 'Your account can sync local and cloud data anytime.'
      : 'Log in with email and password, or create a new account.';
  }

  async function ensureAuthReady() {
    const start = Date.now();
    while (!window.bilmAuth && Date.now() - start < 7000) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!window.bilmAuth) throw new Error('Auth module did not load.');
    await window.bilmAuth.init();
  }


  async function clearAllLocalData() {
    localStorage.clear();
    sessionStorage.clear();

    document.cookie.split(';').forEach((cookie) => {
      const eqPos = cookie.indexOf('=');
      const name = eqPos > -1 ? cookie.slice(0, eqPos).trim() : cookie.trim();
      if (name) {
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
      }
    });

    if (window.indexedDB?.databases) {
      const databases = await window.indexedDB.databases();
      await Promise.all((databases || []).map((db) => new Promise((resolve) => {
        if (!db.name) {
          resolve();
          return;
        }
        const request = window.indexedDB.deleteDatabase(db.name);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      })));
    }

    if (window.caches?.keys) {
      const cacheKeys = await window.caches.keys();
      await Promise.all(cacheKeys.map((cacheKey) => window.caches.delete(cacheKey)));
    }
  }

  autoSyncToggle.checked = getSettings().accountAutoSync !== false;
  autoSyncToggle.addEventListener('change', () => {
    setSettings({ accountAutoSync: autoSyncToggle.checked });
    statusText.textContent = `Auto Sync ${autoSyncToggle.checked ? 'enabled' : 'disabled'}.`;
  });

  loginBtn.addEventListener('click', async () => {
    try {
      await ensureAuthReady();
      await window.bilmAuth.signIn(loginEmail.value, loginPassword.value);
      statusText.textContent = 'Logged in.';
      if (getSettings().accountAutoSync !== false) {
        await autoSyncAfterSignIn();
      }
    } catch (error) {
      statusText.textContent = `Log in failed: ${error.message}`;
    }
  });

  signUpBtn.addEventListener('click', async () => {
    try {
      await ensureAuthReady();
      await window.bilmAuth.signUp(signUpEmail.value, signUpPassword.value);
      statusText.textContent = 'Account created and logged in.';
      if (getSettings().accountAutoSync !== false) {
        await autoSyncAfterSignIn();
      }
    } catch (error) {
      statusText.textContent = `Sign up failed: ${error.message}`;
    }
  });

  syncNowBtn.addEventListener('click', async () => {
    try {
      await ensureAuthReady();
      if (!window.bilmAuth.getCurrentUser()) throw new Error('Log in first.');
      await runManualSync();
    } catch (error) {
      statusText.textContent = `Sync failed: ${error.message}`;
    }
  });

  logoutBtn.addEventListener('click', async () => {
    try {
      await ensureAuthReady();
      if (!window.bilmAuth.getCurrentUser()) throw new Error('Already logged out.');
      if (!confirm('Log out of your account now?')) return;
      await window.bilmAuth.signOut();
      await clearAllLocalData();
      statusText.textContent = 'Logged out and cleared local data. Reloading...';
      setTimeout(() => location.reload(), 250);
    } catch (error) {
      statusText.textContent = `Logout failed: ${error.message}`;
    }
  });

  deleteAccountBtn.addEventListener('click', async () => {
    try {
      await ensureAuthReady();
      if (!window.bilmAuth.getCurrentUser()) throw new Error('Log in first.');
      if (!deletePassword.value) throw new Error('Enter your password to confirm delete.');
      if (!confirm('Delete account permanently? This cannot be undone.')) return;
      await window.bilmAuth.deleteAccount(deletePassword.value);
      statusText.textContent = 'Account deleted permanently.';
      setTimeout(() => {
        window.location.href = withBase('/settings/');
      }, 450);
    } catch (error) {
      statusText.textContent = `Delete failed: ${error.message}`;
    }
  });

  (async () => {
    try {
      await ensureAuthReady();
      updateUserUi(window.bilmAuth.getCurrentUser());
      window.bilmAuth.onAuthStateChanged((user) => updateUserUi(user));
    } catch (error) {
      accountStatusText.textContent = 'Account services are temporarily unavailable.';
      statusText.textContent = error.message;
    }
  })();
});
