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
  const accountStatusText = document.getElementById('accountStatusText');
  const accountHintText = document.getElementById('accountHintText');
  const transferStatusText = document.getElementById('transferStatusText');
  const statusText = document.getElementById('statusText');

  const loginPanel = document.getElementById('loginPanel');
  const signUpPanel = document.getElementById('signUpPanel');

  const loginEmail = document.getElementById('loginEmail');
  const loginPassword = document.getElementById('loginPassword');
  const loginBtn = document.getElementById('loginBtn');
  const toggleLoginPasswordBtn = document.getElementById('toggleLoginPasswordBtn');

  const signUpEmail = document.getElementById('signUpEmail');
  const signUpPassword = document.getElementById('signUpPassword');
  const signUpBtn = document.getElementById('signUpBtn');
  const toggleSignUpPasswordBtn = document.getElementById('toggleSignUpPasswordBtn');

  const exportDataBtn = document.getElementById('exportDataBtn');
  const importDataBtn = document.getElementById('importDataBtn');
  const cloudExportBtn = document.getElementById('cloudExportBtn');
  const cloudImportBtn = document.getElementById('cloudImportBtn');
  const importFileInput = document.getElementById('importFileInput');

  const usernameInput = document.getElementById('usernameInput');
  const saveUsernameBtn = document.getElementById('saveUsernameBtn');

  const deletePassword = document.getElementById('deletePassword');
  const deleteAccountBtn = document.getElementById('deleteAccountBtn');

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

  function parseBackup(raw) {
    const payload = JSON.parse(raw);
    if (!payload || payload.schema !== 'bilm-backup-v1') {
      throw new Error('Invalid backup schema.');
    }
    return payload;
  }

  function applyBackup(payload) {
    localStorage.clear();
    sessionStorage.clear();

    Object.entries(payload.localStorage || {}).forEach(([key, value]) => localStorage.setItem(key, value));
    Object.entries(payload.sessionStorage || {}).forEach(([key, value]) => sessionStorage.setItem(key, value));

    document.cookie.split(';').forEach((cookie) => {
      const eqPos = cookie.indexOf('=');
      const name = eqPos > -1 ? cookie.slice(0, eqPos).trim() : cookie.trim();
      if (name) {
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
      }
    });

    String(payload.cookies || '')
      .split(';')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((cookieEntry) => {
        document.cookie = `${cookieEntry};path=/`;
      });
  }

  function downloadBackup(payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bilm-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function ensureAuthReady() {
    if (window.bilmAuth?.ready) {
      await window.bilmAuth.ready();
      return;
    }
    await new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (window.bilmAuth?.ready) {
          clearInterval(timer);
          window.bilmAuth.ready().then(resolve).catch(reject);
          return;
        }
        if (Date.now() - startedAt > 15000) {
          clearInterval(timer);
          reject(new Error('Account services did not load in time.'));
        }
      }, 80);
    });
  }

  async function saveCredentialsForAutofill(email, password) {
    if (!('credentials' in navigator) || !window.PasswordCredential) return;
    try {
      const credential = new window.PasswordCredential({ id: email, password, name: 'Bilm User' });
      await navigator.credentials.store(credential);
    } catch (error) {
      console.warn('Credential save skipped:', error);
    }
  }

  function setPasswordVisibility(input, button) {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.textContent = show ? 'Hide Password' : 'Show Password';
  }

  function updateAccountUi(user) {
    const loggedIn = Boolean(user);
    accountStatusText.textContent = loggedIn
      ? `Logged in as ${user.email || 'account user'}.`
      : 'Not logged in.';
    accountHintText.textContent = loggedIn
      ? 'Use Cloud Export and Cloud Import to move your data across devices.'
      : 'Log in to use Cloud Export and Cloud Import.';

    loginPanel.hidden = loggedIn;
    signUpPanel.hidden = loggedIn;

    saveUsernameBtn.disabled = !loggedIn;
    deleteAccountBtn.disabled = !loggedIn;
    cloudExportBtn.disabled = !loggedIn;
    cloudImportBtn.disabled = !loggedIn;

    const profile = user?.profile || {};
    usernameInput.value = profile.username || '';
  }

  exportDataBtn.addEventListener('click', () => {
    try {
      const payload = collectBackupData();
      downloadBackup(payload);
      transferStatusText.textContent = 'Export Data complete. JSON file downloaded.';
    } catch (error) {
      transferStatusText.textContent = `Export failed: ${error.message}`;
    }
  });

  importDataBtn.addEventListener('click', () => {
    importFileInput.click();
  });

  importFileInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const payload = parseBackup(await file.text());
      if (!confirm('Import this backup now? This will overwrite current local data.')) return;
      applyBackup(payload);
      transferStatusText.textContent = 'Import Data complete. Reloading...';
      setTimeout(() => location.reload(), 250);
    } catch (error) {
      transferStatusText.textContent = `Import failed: ${error.message}`;
    } finally {
      importFileInput.value = '';
    }
  });

  cloudExportBtn.addEventListener('click', async () => {
    try {
      await ensureAuthReady();
      if (!window.bilmAuth.getCurrentUser()) throw new Error('Log in first.');
      await window.bilmAuth.saveCloudSnapshot(collectBackupData());
      transferStatusText.textContent = 'Cloud Export complete.';
    } catch (error) {
      transferStatusText.textContent = `Cloud Export failed: ${error.message}`;
    }
  });

  cloudImportBtn.addEventListener('click', async () => {
    try {
      await ensureAuthReady();
      if (!window.bilmAuth.getCurrentUser()) throw new Error('Log in first.');
      const payload = await window.bilmAuth.getCloudSnapshot();
      if (!payload) throw new Error('No cloud backup found for this account.');
      if (!confirm('Cloud Import will overwrite current local data. Continue?')) return;
      applyBackup(payload);
      transferStatusText.textContent = 'Cloud Import complete. Reloading...';
      setTimeout(() => location.reload(), 250);
    } catch (error) {
      transferStatusText.textContent = `Cloud Import failed: ${error.message}`;
    }
  });

  loginBtn.addEventListener('click', async () => {
    try {
      await ensureAuthReady();
      const email = loginEmail.value.trim();
      const password = loginPassword.value;
      await window.bilmAuth.signIn(email, password);
      await saveCredentialsForAutofill(email, password);
      statusText.textContent = 'Logged in.';
    } catch (error) {
      statusText.textContent = `Log in failed: ${error.message}`;
    }
  });

  signUpBtn.addEventListener('click', async () => {
    try {
      await ensureAuthReady();
      const email = signUpEmail.value.trim();
      const password = signUpPassword.value;
      await window.bilmAuth.signUp(email, password);
      await saveCredentialsForAutofill(email, password);
      statusText.textContent = 'Account created.';
    } catch (error) {
      statusText.textContent = `Sign up failed: ${error.message}`;
    }
  });

  saveUsernameBtn.addEventListener('click', async () => {
    try {
      await ensureAuthReady();
      await window.bilmAuth.updateProfile({ username: usernameInput.value.trim() });
      statusText.textContent = 'Username saved.';
    } catch (error) {
      statusText.textContent = `Username update failed: ${error.message}`;
    }
  });

  deleteAccountBtn.addEventListener('click', async () => {
    try {
      await ensureAuthReady();
      const password = deletePassword.value;
      if (!password) throw new Error('Enter your password first.');
      if (!confirm('Delete account permanently? This cannot be undone.')) return;
      await window.bilmAuth.deleteAccount(password);
      statusText.textContent = 'Account deleted. Redirecting...';
      setTimeout(() => {
        window.location.href = withBase('/settings/');
      }, 400);
    } catch (error) {
      statusText.textContent = `Delete failed: ${error.message}`;
    }
  });

  toggleLoginPasswordBtn.addEventListener('click', () => setPasswordVisibility(loginPassword, toggleLoginPasswordBtn));
  toggleSignUpPasswordBtn.addEventListener('click', () => setPasswordVisibility(signUpPassword, toggleSignUpPasswordBtn));

  (async () => {
    try {
      await ensureAuthReady();
      updateAccountUi(window.bilmAuth.getCurrentUser());
      window.bilmAuth.onAuthStateChanged((user) => {
        updateAccountUi(user);
      });
    } catch (error) {
      accountStatusText.textContent = 'Account tools unavailable right now. Refresh and try again.';
      statusText.textContent = `Auth setup failed: ${error.message}`;
    }
  })();
});
