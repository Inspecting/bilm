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
  const statusText = document.getElementById('statusText');

  const authPanel = document.getElementById('authPanel');

  const openLoginModalBtn = document.getElementById('openLoginModalBtn');
  const openSignUpModalBtn = document.getElementById('openSignUpModalBtn');

  const loginModal = document.getElementById('loginModal');
  const signUpModal = document.getElementById('signUpModal');
  const closeLoginModalBtn = document.getElementById('closeLoginModalBtn');
  const closeSignUpModalBtn = document.getElementById('closeSignUpModalBtn');
  const openCreateAccountBtn = document.getElementById('openCreateAccountBtn');
  const backToLoginBtn = document.getElementById('backToLoginBtn');

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

  function openModal(modal) {
    if (modal) modal.classList.add('open');
  }

  function closeModal(modal) {
    if (modal) modal.classList.remove('open');
  }

  function closeAllModals() {
    closeModal(loginModal);
    closeModal(signUpModal);
  }

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

  function closeModal(modal) {
    if (modal) modal.classList.remove('open');
  }

  function closeAllModals() {
    closeModal(loginModal);
    closeModal(signUpModal);
  }

  async function ensureAuthReady() {
    const start = Date.now();
    while (!window.bilmAuth && Date.now() - start < 15000) {
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    if (!window.bilmAuth) throw new Error('Account services did not load in time.');

    if (typeof window.bilmAuth.ready === 'function') {
      await window.bilmAuth.ready();
      return;
    }

    if (typeof window.bilmAuth.init === 'function') {
      await window.bilmAuth.init();
      return;
    }

    throw new Error('Account services are unavailable.');
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
      ? 'Account ready. You can use cloud transfer, update display name, and manage account safety below.'
      : 'Use Log In or Sign Up for cloud transfer and account options.';
      ? 'Account ready. You can update your display name and manage account safety below.'
      : 'Use Log In or Sign Up to access account options.';

    authPanel.hidden = loggedIn;

    saveUsernameBtn.disabled = !loggedIn;
    deleteAccountBtn.disabled = !loggedIn;

    usernameInput.value = user?.displayName || '';
  }

  openLoginModalBtn.addEventListener('click', () => {
    closeModal(signUpModal);
    openModal(loginModal);
  });

  openSignUpModalBtn.addEventListener('click', () => {
    closeModal(loginModal);
    openModal(signUpModal);
  });

  closeLoginModalBtn.addEventListener('click', () => closeModal(loginModal));
  closeSignUpModalBtn.addEventListener('click', () => closeModal(signUpModal));

  openCreateAccountBtn.addEventListener('click', () => {
    closeModal(loginModal);
    openModal(signUpModal);
  });

  backToLoginBtn.addEventListener('click', () => {
    closeModal(signUpModal);
    openModal(loginModal);
  });

  [loginModal, signUpModal].forEach((modal) => {
    if (!modal) return;
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        closeModal(modal);
      }
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAllModals();
    }
  });

  exportDataBtn.addEventListener('click', () => {
    try {
      const payload = collectBackupData();
      downloadBackup(payload);
      transferStatusText.textContent = 'Export Data complete. JSON file downloaded.';
    } catch (error) {
      transferStatusText.textContent = `Export failed: ${error.message}`;
    }
  });

  openSignUpModalBtn.addEventListener('click', () => {
    closeModal(loginModal);
    openModal(signUpModal);
  });

  closeLoginModalBtn.addEventListener('click', () => closeModal(loginModal));
  closeSignUpModalBtn.addEventListener('click', () => closeModal(signUpModal));

  openCreateAccountBtn.addEventListener('click', () => {
    closeModal(loginModal);
    openModal(signUpModal);
  });

  backToLoginBtn.addEventListener('click', () => {
    closeModal(signUpModal);
    openModal(loginModal);
  });

  [loginModal, signUpModal].forEach((modal) => {
    if (!modal) return;
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        closeModal(modal);
      }
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAllModals();
    }
  });

  loginBtn.addEventListener('click', async () => {
    try {
      await ensureAuthReady();
      const email = loginEmail.value.trim();
      const password = loginPassword.value;
      await window.bilmAuth.signIn(email, password);
      await saveCredentialsForAutofill(email, password);
      closeModal(loginModal);
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
      closeModal(signUpModal);
      statusText.textContent = 'Account created.';
    } catch (error) {
      statusText.textContent = `Sign up failed: ${error.message}`;
    }
  });

  saveUsernameBtn.addEventListener('click', async () => {
    try {
      await ensureAuthReady();
      await window.bilmAuth.setUsername(usernameInput.value.trim());
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
