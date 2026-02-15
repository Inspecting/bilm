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

function setPasswordVisibility(input, button) {
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  button.textContent = isPassword ? 'Hide Password' : 'Show Password';
}

document.addEventListener('DOMContentLoaded', () => {
  const accountStatusText = document.getElementById('accountStatusText');
  const accountHintText = document.getElementById('accountHintText');
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

  const usernameInput = document.getElementById('usernameInput');
  const saveUsernameBtn = document.getElementById('saveUsernameBtn');

  const deletePassword = document.getElementById('deletePassword');
  const deleteAccountBtn = document.getElementById('deleteAccountBtn');

  const saveCloudBtn = document.getElementById('saveCloudBtn');
  const syncCloudBtn = document.getElementById('syncCloudBtn');

  async function saveCredentialsForAutofill(email, password) {
    if (!('credentials' in navigator) || !window.PasswordCredential) return;
    try {
      const credential = new window.PasswordCredential({ id: email, password, name: email });
      await navigator.credentials.store(credential);
    } catch {
      // Not supported or blocked.
    }
  }

  async function ensureAuthReady() {
    const start = Date.now();
    while (!window.bilmAuth && Date.now() - start < 7000) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!window.bilmAuth) throw new Error('Auth module did not load.');
    await window.bilmAuth.init();
  }

  function updateUserUi(user) {
    const username = user?.displayName ? `@${user.displayName}` : '';
    const email = user?.email ? ` (${user.email})` : '';
    const loggedIn = Boolean(user);

    accountStatusText.textContent = loggedIn ? `Logged in ${username}${email}` : 'You are not signed in.';
    accountHintText.textContent = loggedIn
      ? 'Your account is simple: email/password login + manual cloud controls.'
      : 'Log in with email and password, or create a new account.';

    loginPanel.hidden = loggedIn;
    signUpPanel.hidden = loggedIn;
    saveUsernameBtn.disabled = !loggedIn;
    deleteAccountBtn.disabled = !loggedIn;
    saveCloudBtn.disabled = !loggedIn;
    syncCloudBtn.disabled = !loggedIn;
    usernameInput.value = user?.displayName || '';
  }

  async function autoSyncAfterLogin() {
    const cloudSnapshot = await window.bilmAuth.getCloudSnapshot();
    if (!cloudSnapshot) {
      await window.bilmAuth.saveCloudSnapshot();
      return 'No cloud backup existed, so your current local data was saved.';
    }

    const synced = await window.bilmAuth.syncFromCloudNow();
    if (synced) {
      setTimeout(() => window.location.reload(), 250);
      return 'Synced from cloud. Reloading with account data...';
    }

    return 'Cloud sync completed.';
  }

  loginBtn.addEventListener('click', async () => {
    try {
      await ensureAuthReady();
      const email = loginEmail.value.trim();
      const password = loginPassword.value;
      await window.bilmAuth.signIn(email, password);
      await saveCredentialsForAutofill(email, password);
      statusText.textContent = await autoSyncAfterLogin();
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
      statusText.textContent = await autoSyncAfterLogin();
    } catch (error) {
      statusText.textContent = `Sign up failed: ${error.message}`;
    }
  });

  saveUsernameBtn.addEventListener('click', async () => {
    try {
      await ensureAuthReady();
      if (!window.bilmAuth.getCurrentUser()) throw new Error('Log in first.');
      const username = usernameInput.value.trim();
      if (username && !/^[A-Za-z0-9_.-]{3,30}$/.test(username)) {
        throw new Error('Username must be 3-30 chars and use letters, numbers, ., _, or -.');
      }
      await window.bilmAuth.setUsername(username);
      statusText.textContent = username
        ? `Username updated to @${username}.`
        : 'Username cleared. Navbar will show email.';
      updateUserUi(window.bilmAuth.getCurrentUser());
    } catch (error) {
      statusText.textContent = `Username update failed: ${error.message}`;
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

  saveCloudBtn.addEventListener('click', async () => {
    try {
      await ensureAuthReady();
      if (!window.bilmAuth.getCurrentUser()) throw new Error('Log in first.');
      await window.bilmAuth.saveCloudSnapshot();
      statusText.textContent = 'Saved current local data to cloud.';
    } catch (error) {
      statusText.textContent = `Cloud save failed: ${error.message}`;
    }
  });

  syncCloudBtn.addEventListener('click', async () => {
    try {
      await ensureAuthReady();
      if (!window.bilmAuth.getCurrentUser()) throw new Error('Log in first.');
      const synced = await window.bilmAuth.syncFromCloudNow();
      if (!synced) {
        statusText.textContent = 'No cloud backup found yet.';
        return;
      }
      statusText.textContent = 'Synced from cloud. Reloading...';
      setTimeout(() => window.location.reload(), 250);
    } catch (error) {
      statusText.textContent = `Cloud sync failed: ${error.message}`;
    }
  });

  toggleLoginPasswordBtn.addEventListener('click', () => setPasswordVisibility(loginPassword, toggleLoginPasswordBtn));
  toggleSignUpPasswordBtn.addEventListener('click', () => setPasswordVisibility(signUpPassword, toggleSignUpPasswordBtn));

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
