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
  const transferStatusText = document.getElementById('transferStatusText');
  const authPanel = document.getElementById('authPanel');

  const openLoginModalBtn = document.getElementById('openLoginModalBtn');
  const openSignUpModalBtn = document.getElementById('openSignUpModalBtn');

  const exportDataBtn = document.getElementById('exportDataBtn');
  const importDataBtn = document.getElementById('importDataBtn');
  const importFileInput = document.getElementById('importFileInput');

  const loginModal = document.getElementById('loginModal');
  const signUpModal = document.getElementById('signUpModal');
  const dataModal = document.getElementById('dataModal');

  const closeLoginModalBtn = document.getElementById('closeLoginModalBtn');
  const closeSignUpModalBtn = document.getElementById('closeSignUpModalBtn');
  const closeDataModalBtn = document.getElementById('closeDataModalBtn');
  const openCreateAccountBtn = document.getElementById('openCreateAccountBtn');
  const backToLoginBtn = document.getElementById('backToLoginBtn');

  const loginForm = document.getElementById('loginForm');
  const signUpForm = document.getElementById('signUpForm');

  const loginEmail = document.getElementById('loginEmail');
  const loginPassword = document.getElementById('loginPassword');
  const loginBtn = document.getElementById('loginBtn');
  const toggleLoginPasswordBtn = document.getElementById('toggleLoginPasswordBtn');

  const signUpEmail = document.getElementById('signUpEmail');
  const signUpPassword = document.getElementById('signUpPassword');
  const signUpBtn = document.getElementById('signUpBtn');
  const toggleSignUpPasswordBtn = document.getElementById('toggleSignUpPasswordBtn');

  const dataModalTitle = document.getElementById('dataModalTitle');
  const dataModalMessage = document.getElementById('dataModalMessage');
  const dataCodeField = document.getElementById('dataCodeField');
  const copyDataBtn = document.getElementById('copyDataBtn');
  const downloadDataBtn = document.getElementById('downloadDataBtn');
  const cloudExportBtn = document.getElementById('cloudExportBtn');
  const pasteImportBtn = document.getElementById('pasteImportBtn');
  const uploadImportBtn = document.getElementById('uploadImportBtn');
  const cloudImportBtn = document.getElementById('cloudImportBtn');
  const applyImportBtn = document.getElementById('applyImportBtn');

  const usernameInput = document.getElementById('usernameInput');
  const saveUsernameBtn = document.getElementById('saveUsernameBtn');

  const deletePassword = document.getElementById('deletePassword');
  const deleteAccountBtn = document.getElementById('deleteAccountBtn');
  const signOutBtn = document.getElementById('signOutBtn');

  let pendingImportPayload = null;

  function openModal(modal) {
    modal?.classList.add('open');
  }

  function closeModal(modal) {
    modal?.classList.remove('open');
  }

  function closeAllModals() {
    closeModal(loginModal);
    closeModal(signUpModal);
    closeModal(dataModal);
    pendingImportPayload = null;
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

  const BACKUP_FORMAT_PREFIX = 'BLM1';
  const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

  function hashSeed(input) {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function buildKeystream(length, nonceHex) {
    let state = hashSeed(`${nonceHex}|bilm-backup`);
    const stream = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      stream[i] = state & 0xff;
    }
    return stream;
  }

  function checksumBytes(bytes) {
    let checksum = 2166136261;
    bytes.forEach((byte) => {
      checksum ^= byte;
      checksum = Math.imul(checksum, 16777619);
    });
    return checksum >>> 0;
  }

  function bytesToBase62(bytes) {
    if (!bytes.length) return BASE62_ALPHABET[0];
    let value = 0n;
    bytes.forEach((byte) => {
      value = (value << 8n) | BigInt(byte);
    });
    const base = 62n;
    let output = '';
    while (value > 0n) {
      const remainder = Number(value % base);
      output = BASE62_ALPHABET[remainder] + output;
      value /= base;
    }
    return output || BASE62_ALPHABET[0];
  }

  function base62ToBytes(input) {
    const text = String(input || '').trim();
    if (!text) return new Uint8Array();
    const base = 62n;
    let value = 0n;
    for (const char of text) {
      const index = BASE62_ALPHABET.indexOf(char);
      if (index < 0) throw new Error('Backup code has invalid characters.');
      value = value * base + BigInt(index);
    }
    const bytes = [];
    while (value > 0n) {
      bytes.unshift(Number(value & 255n));
      value >>= 8n;
    }
    return new Uint8Array(bytes);
  }

  function encodeBackup(payload) {
    const encoder = new TextEncoder();
    const plainBytes = encoder.encode(JSON.stringify(payload));
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const nonceHex = Array.from(nonce).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const keystream = buildKeystream(plainBytes.length, nonceHex);
    const encrypted = plainBytes.map((byte, index) => byte ^ keystream[index]);
    const check = checksumBytes(plainBytes);
    const packed = new Uint8Array(nonce.length + encrypted.length + 4);
    packed.set(nonce, 0);
    packed.set(encrypted, nonce.length);
    packed[packed.length - 4] = (check >>> 24) & 0xff;
    packed[packed.length - 3] = (check >>> 16) & 0xff;
    packed[packed.length - 2] = (check >>> 8) & 0xff;
    packed[packed.length - 1] = check & 0xff;
    return `${BACKUP_FORMAT_PREFIX}${bytesToBase62(packed)}`;
  }

  function decodeBackup(code) {
    if (!String(code || '').startsWith(BACKUP_FORMAT_PREFIX)) {
      return JSON.parse(code);
    }
    const packed = base62ToBytes(String(code).slice(BACKUP_FORMAT_PREFIX.length));
    if (packed.length < 17) {
      throw new Error('Backup code is too short.');
    }
    const nonce = packed.slice(0, 12);
    const checksumOffset = packed.length - 4;
    const encrypted = packed.slice(12, checksumOffset);
    const expectedChecksum = ((packed[checksumOffset] << 24) | (packed[checksumOffset + 1] << 16) | (packed[checksumOffset + 2] << 8) | packed[checksumOffset + 3]) >>> 0;
    const nonceHex = Array.from(nonce).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const keystream = buildKeystream(encrypted.length, nonceHex);
    const decrypted = encrypted.map((byte, index) => byte ^ keystream[index]);
    const actualChecksum = checksumBytes(decrypted);
    if (actualChecksum !== expectedChecksum) {
      throw new Error('Backup code failed verification.');
    }
    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(decrypted));
  }

  function parseBackup(raw) {
    const payload = decodeBackup(raw);
    if (!payload || payload.schema !== 'bilm-backup-v1') {
      throw new Error('Invalid backup schema.');
    }
    return payload;
  }

  function applyBackup(payload) {
    localStorage.clear();
    sessionStorage.clear();

    Object.entries(payload.localStorage || {}).forEach(([key, value]) => {
      localStorage.setItem(key, value);
    });

    Object.entries(payload.sessionStorage || {}).forEach(([key, value]) => {
      sessionStorage.setItem(key, value);
    });

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

  async function ensureAuthReady() {
    const start = Date.now();
    while (!window.bilmAuth && Date.now() - start < 10000) {
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    if (!window.bilmAuth) throw new Error('Account services did not load in time.');
    await window.bilmAuth.init();
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
      : 'You are in guest mode. Log in to enable account features.';
    accountHintText.textContent = loggedIn
      ? 'Account ready. You can use cloud transfer, update display name, and manage account safety below.'
      : 'Use Log In or Sign Up for cloud transfer and account options.';

    authPanel.hidden = loggedIn;
    signOutBtn.hidden = !loggedIn;
    saveUsernameBtn.disabled = !loggedIn;
    deleteAccountBtn.disabled = !loggedIn;
    usernameInput.value = user?.displayName || '';
  }

  function openDataModal({ title, message, code = '', importMode = false }) {
    dataModalTitle.textContent = title;
    dataModalMessage.textContent = message;
    dataCodeField.value = code;
    dataCodeField.readOnly = !importMode;

    copyDataBtn.hidden = importMode;
    downloadDataBtn.hidden = importMode;
    cloudExportBtn.hidden = importMode;
    pasteImportBtn.hidden = !importMode;
    uploadImportBtn.hidden = !importMode;
    cloudImportBtn.hidden = !importMode;
    applyImportBtn.hidden = !importMode;

    openModal(dataModal);
  }

  openLoginModalBtn?.addEventListener('click', () => {
    closeModal(signUpModal);
    openModal(loginModal);
  });

  openSignUpModalBtn?.addEventListener('click', () => {
    closeModal(loginModal);
    openModal(signUpModal);
  });

  closeLoginModalBtn?.addEventListener('click', () => closeModal(loginModal));
  closeSignUpModalBtn?.addEventListener('click', () => closeModal(signUpModal));
  closeDataModalBtn?.addEventListener('click', () => closeModal(dataModal));

  openCreateAccountBtn?.addEventListener('click', () => {
    closeModal(loginModal);
    openModal(signUpModal);
  });

  backToLoginBtn?.addEventListener('click', () => {
    closeModal(signUpModal);
    openModal(loginModal);
  });

  [loginModal, signUpModal, dataModal].forEach((modal) => {
    modal?.addEventListener('click', (event) => {
      if (event.target === modal) closeModal(modal);
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAllModals();
  });

  loginForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    loginBtn.click();
  });

  signUpForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    signUpBtn.click();
  });

  exportDataBtn?.addEventListener('click', () => {
    const payload = collectBackupData();
    const code = encodeBackup(payload);
    openDataModal({
      title: 'Export Backup Code',
      message: 'Copy this secure backup code or download it as a coded file. Keep it private; it contains your site data.',
      code,
      importMode: false
    });
    transferStatusText.textContent = 'Export popup opened.';
  });

  importDataBtn?.addEventListener('click', () => {
    openDataModal({
      title: 'Import Backup Code',
      message: 'Paste a backup code or upload a save file, then apply import to replace your current local data.',
      importMode: true
    });
    transferStatusText.textContent = 'Import popup opened.';
  });

  copyDataBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(dataCodeField.value);
      transferStatusText.textContent = 'Backup code copied.';
    } catch (error) {
      transferStatusText.textContent = 'Clipboard blocked. Copy manually from the text box.';
    }
  });

  downloadDataBtn?.addEventListener('click', () => {
    const blob = new Blob([dataCodeField.value], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bilm-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.bilm`; 
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    transferStatusText.textContent = 'Export downloaded.';
  });

  uploadImportBtn?.addEventListener('click', () => {
    importFileInput.click();
  });

  importFileInput?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    dataCodeField.value = await file.text();
    transferStatusText.textContent = `Loaded ${file.name}.`;
    importFileInput.value = '';
  });

  pasteImportBtn?.addEventListener('click', async () => {
    try {
      const clipboardText = await navigator.clipboard.readText();
      dataCodeField.value = clipboardText;
      transferStatusText.textContent = 'Backup code pasted from clipboard.';
    } catch (error) {
      transferStatusText.textContent = 'Clipboard read blocked. Paste manually into the text box.';
    }
  });

  cloudExportBtn?.addEventListener('click', async () => {
    try {
      await ensureAuthReady();
      if (!window.bilmAuth.getCurrentUser()) {
        openModal(loginModal);
        throw new Error('Please log in first.');
      }
      await window.bilmAuth.saveCloudSnapshot(collectBackupData());
      transferStatusText.textContent = 'Export successful.';
      alert('Export successful.');
      transferStatusText.textContent = 'Cloud export successful. Your latest local data is now saved to your account.';
    } catch (error) {
      transferStatusText.textContent = `Cloud export failed: ${error.message}`;
    }
  });

  cloudImportBtn?.addEventListener('click', async () => {
    try {
      await ensureAuthReady();
      if (!window.bilmAuth.getCurrentUser()) {
        openModal(loginModal);
        throw new Error('Please log in first.');
      }
      const snapshot = await window.bilmAuth.getCloudSnapshot();
      if (!snapshot) throw new Error('No cloud backup found for this account.');
      dataCodeField.value = encodeBackup(snapshot);
      transferStatusText.textContent = 'Cloud backup loaded into the import box. Review it, then select Apply Import when ready.';
    } catch (error) {
      transferStatusText.textContent = `Cloud import failed: ${error.message}`;
    }
  });

  applyImportBtn?.addEventListener('click', () => {
    try {
      pendingImportPayload = parseBackup(dataCodeField.value);
      if (!confirm('Import this backup now? This will overwrite current local data.')) return;
      applyBackup(pendingImportPayload);
      transferStatusText.textContent = 'Import complete. Reloading...';
      setTimeout(() => location.reload(), 250);
    } catch (error) {
      transferStatusText.textContent = `Import failed: ${error.message}`;
    }
  });

  loginBtn?.addEventListener('click', async () => {
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

  signUpBtn?.addEventListener('click', async () => {
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

  saveUsernameBtn?.addEventListener('click', async () => {
    try {
      await ensureAuthReady();
      await window.bilmAuth.setUsername(usernameInput.value.trim());
      statusText.textContent = 'Username saved.';
    } catch (error) {
      statusText.textContent = `Username update failed: ${error.message}`;
    }
  });

  deleteAccountBtn?.addEventListener('click', async () => {
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

  signOutBtn?.addEventListener('click', async () => {
    try {
      await ensureAuthReady();
      if (!confirm('Sign out of your account?')) return;
      await window.bilmAuth.signOut();
      transferStatusText.textContent = 'Signed out successfully.';
      statusText.textContent = 'Signed out.';
    } catch (error) {
      statusText.textContent = `Sign out failed: ${error.message}`;
    }
  });

  toggleLoginPasswordBtn?.addEventListener('click', () => setPasswordVisibility(loginPassword, toggleLoginPasswordBtn));
  toggleSignUpPasswordBtn?.addEventListener('click', () => setPasswordVisibility(signUpPassword, toggleSignUpPasswordBtn));

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
