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
  const openMergeModalBtn = document.getElementById('openMergeModalBtn');
  const importOneBtn = document.getElementById('importOneBtn');
  const importTwoBtn = document.getElementById('importTwoBtn');
  const mergeDataBtn = document.getElementById('mergeDataBtn');
  const importOneStatus = document.getElementById('importOneStatus');
  const importTwoStatus = document.getElementById('importTwoStatus');
  const importFileInput = document.getElementById('importFileInput');

  const loginModal = document.getElementById('loginModal');
  const signUpModal = document.getElementById('signUpModal');
  const dataModal = document.getElementById('dataModal');
  const mergeModal = document.getElementById('mergeModal');
  const cloudAuthPromptModal = document.getElementById('cloudAuthPromptModal');

  const closeLoginModalBtn = document.getElementById('closeLoginModalBtn');
  const closeSignUpModalBtn = document.getElementById('closeSignUpModalBtn');
  const closeDataModalBtn = document.getElementById('closeDataModalBtn');
  const closeMergeModalBtn = document.getElementById('closeMergeModalBtn');
  const confirmCloudLoginBtn = document.getElementById('confirmCloudLoginBtn');
  const cancelCloudLoginBtn = document.getElementById('cancelCloudLoginBtn');
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
  const clearOnLogoutToggle = document.getElementById('clearOnLogoutToggle');
  const syncToggle = document.getElementById('syncToggle');
  const syncStatusText = document.getElementById('syncStatusText');
  const lastSyncText = document.getElementById('lastSyncText');
  const manualFirebaseBackupBtn = document.getElementById('manualFirebaseBackupBtn');
  const firebaseBackupAutoText = document.getElementById('firebaseBackupAutoText');
  const firebaseBackupManualText = document.getElementById('firebaseBackupManualText');
  const firebaseBackupCadenceText = document.getElementById('firebaseBackupCadenceText');
  const firebaseBackupCooldownText = document.getElementById('firebaseBackupCooldownText');

  let pendingImportPayload = null;
  let activeImportSlot = null;
  let reopenMergeAfterImportClose = false;
  const importSlots = { one: null, two: null };
  const CLEAR_ON_LOGOUT_KEY = 'bilm-clear-local-on-logout';
  const SYNC_ENABLED_KEY = 'bilm-sync-enabled';
  const SYNC_META_KEY = 'bilm-sync-meta';
  const SYNC_DEVICE_ID_KEY = 'bilm-sync-device-id';
  const INCOGNITO_BACKUP_KEY = 'bilm-incognito-backup';
  const INCOGNITO_SEARCH_MAP_KEY = 'bilm-incognito-search-map';
  const DEBUG_ISSUE_LOCAL_KEY = 'debug-local-issue';
  const BACKUP_LOCAL_ALLOWLIST = [/^bilm-/, /^theme-/];
  const BACKUP_SESSION_ALLOWLIST = [/^bilm-/];
  const BACKUP_EXCLUDED_STORAGE_KEY_PATTERNS = [/^tmdb-/i, /^debug-/i];

  function showToast(message, tone = 'info', duration = 1000) {
    window.bilmToast?.show?.(message, { tone, duration });
  }

  function openSharedAuthModal(mode = 'login') {
    const normalizedMode = mode === 'signup' ? 'signup' : 'login';
    const openFn = window.bilmAuthUi?.open;
    if (typeof openFn === 'function') {
      openFn(normalizedMode);
      return;
    }

    window.addEventListener('bilm:auth-modal-ready', () => {
      window.bilmAuthUi?.open?.(normalizedMode);
    }, { once: true });

    window.dispatchEvent(new CustomEvent('bilm:open-auth-modal', {
      detail: { mode: normalizedMode }
    }));

    if (normalizedMode === 'signup') {
      closeModal(loginModal);
      openModal(signUpModal);
      return;
    }
    closeModal(signUpModal);
    openModal(loginModal);
  }

  function openModal(modal) {
    modal?.classList.add('open');
  }

  function closeModal(modal) {
    modal?.classList.remove('open');
  }

  function closeDataImportModal() {
    activeImportSlot = null;
    closeModal(dataModal);
    if (reopenMergeAfterImportClose) {
      reopenMergeAfterImportClose = false;
      updateMergeUi();
      openModal(mergeModal);
    }
  }

  function closeAllModals() {
    closeModal(loginModal);
    closeModal(signUpModal);
    closeModal(dataModal);
    closeModal(mergeModal);
    closeModal(cloudAuthPromptModal);
    pendingImportPayload = null;
    reopenMergeAfterImportClose = false;
  }

  function shouldIncludeStorageKey(key, allowlist) {
    return allowlist.some((pattern) => pattern.test(String(key || '')));
  }

  function isBackupStorageKeyExcluded(key) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) return true;
    if (normalizedKey.includes('/') || normalizedKey.includes('\\')) return true;
    return BACKUP_EXCLUDED_STORAGE_KEY_PATTERNS.some((pattern) => pattern.test(normalizedKey));
  }

  function readStorage(storage, allowlist = []) {
    return Object.entries(storage).reduce((all, [key, value]) => {
      if (allowlist.length && !shouldIncludeStorageKey(key, allowlist)) return all;
      if (isBackupStorageKeyExcluded(key)) return all;
      all[key] = value;
      return all;
    }, {});
  }

  function collectBackupData() {
    const localState = readStorage(localStorage, BACKUP_LOCAL_ALLOWLIST);
    const sessionState = readStorage(sessionStorage, BACKUP_SESSION_ALLOWLIST);
    delete localState[SYNC_ENABLED_KEY];
    delete localState[SYNC_META_KEY];
    delete localState[SYNC_DEVICE_ID_KEY];
    delete localState[INCOGNITO_BACKUP_KEY];
    delete localState[INCOGNITO_SEARCH_MAP_KEY];
    delete localState[DEBUG_ISSUE_LOCAL_KEY];
    delete sessionState[INCOGNITO_BACKUP_KEY];
    delete sessionState[INCOGNITO_SEARCH_MAP_KEY];
    return {
      schema: 'bilm-backup-v1',
      exportedAt: new Date().toISOString(),
      origin: location.origin,
      pathname: location.pathname,
      localStorage: localState,
      sessionStorage: sessionState
    };
  }

  function formatBackup(payload) {
    return JSON.stringify(payload, null, 2);
  }


  function sanitizeImportText(raw) {
    return String(raw || '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\r\n?/g, '\n')
      .trim();
  }

  function tryParseJsonCandidate(candidate) {
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  }

  function salvageBackupInput(raw) {
    const sanitized = sanitizeImportText(raw);
    if (!sanitized) throw new Error('Backup code is empty.');

    const directPayload = tryParseJsonCandidate(sanitized);
    if (directPayload) return directPayload;

    const jsonMatch = sanitized.match(/\{[\s\S]*\}/);
    if (jsonMatch?.[0]) {
      const extracted = tryParseJsonCandidate(jsonMatch[0]);
      if (extracted) return extracted;
    }

    throw new Error('Backup data must be valid JSON.');
  }

  function parseBackup(raw) {
    const payload = salvageBackupInput(raw);
    if (!payload || payload.schema !== 'bilm-backup-v1') {
      throw new Error('Invalid backup schema.');
    }
    return payload;
  }

  function getPayloadUpdatedAt(payload) {
    const timestamp = Date.parse(String(payload?.exportedAt || ''));
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function mergeBackupPayloads(payloadA, payloadB, payloadLocal) {
    if (!payloadA || !payloadB) throw new Error('Both import slots are required to merge data.');

    const sources = [payloadA, payloadB, payloadLocal].filter(Boolean);
    const mergeAsHistoryKeys = new Set([
      'bilm-continue-watching',
      'bilm-watch-history',
      'bilm-favorites',
      'bilm-watch-later',
      'bilm-search-history'
    ]);

    const parseJson = (value, fallback) => {
      if (typeof value !== 'string') return fallback;
      try {
        return JSON.parse(value);
      } catch {
        return fallback;
      }
    };

    const sortByRecent = (items) => [...items].sort((left, right) => {
      const leftTime = Number(left?.updatedAt) || 0;
      const rightTime = Number(right?.updatedAt) || 0;
      if (leftTime === rightTime) return 0;
      return rightTime - leftTime;
    });

    const mergeList = (key) => {
      const merged = [];
      const seen = new Set();

      sources.forEach((source) => {
        const list = parseJson(source?.localStorage?.[key], []);
        if (!Array.isArray(list)) return;
        list.forEach((entry) => {
          const identity = entry && typeof entry === 'object'
            ? (entry.key || entry.query || `${entry.type || 'item'}-${entry.id || ''}-${entry.title || ''}`)
            : String(entry);
          if (!identity || seen.has(identity)) return;
          seen.add(identity);
          merged.push(entry);
        });
      });

      return JSON.stringify(sortByRecent(merged));
    };

    const mergeStorageMap = (bucket) => {
      const allKeys = new Set();
      sources.forEach((source) => {
        Object.keys(source?.[bucket] || {}).forEach((key) => allKeys.add(key));
      });

      const merged = {};
      allKeys.forEach((key) => {
        if (mergeAsHistoryKeys.has(key)) {
          merged[key] = mergeList(key);
          return;
        }

        const preferredSource = [...sources]
          .sort((left, right) => getPayloadUpdatedAt(right) - getPayloadUpdatedAt(left))
          .find((source) => Object.prototype.hasOwnProperty.call(source?.[bucket] || {}, key));
        const preferredValue = preferredSource?.[bucket]?.[key];
        if (typeof preferredValue !== 'undefined') {
          merged[key] = preferredValue;
        }
      });
      return merged;
    };

    return {
      schema: 'bilm-backup-v1',
      exportedAt: new Date().toISOString(),
      origin: location.origin,
      pathname: location.pathname,
      localStorage: mergeStorageMap('localStorage'),
      sessionStorage: mergeStorageMap('sessionStorage')
    };
  }

  function getClearOnLogoutSetting() {
    return localStorage.getItem(CLEAR_ON_LOGOUT_KEY) !== '0';
  }

  function setClearOnLogoutSetting(value) {
    localStorage.setItem(CLEAR_ON_LOGOUT_KEY, value ? '1' : '0');
  }

  function isSyncEnabled() {
    return localStorage.getItem(SYNC_ENABLED_KEY) !== '0';
  }

  function setSyncEnabled(enabled) {
    localStorage.setItem(SYNC_ENABLED_KEY, enabled ? '1' : '0');
    if (syncToggle) syncToggle.checked = enabled;
    if (syncStatusText) {
      const incognitoEnabled = window.bilmTheme?.getSettings?.()?.incognito === true;
      syncStatusText.textContent = enabled
        ? (incognitoEnabled
          ? 'Live sync is enabled but paused while incognito is on.'
          : 'Live sync is on for this device.')
        : 'Live sync is paused on this device.';
    }
    refreshLastSyncText();
    refreshFirebaseBackupStatus();
  }

  function readSyncMeta() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SYNC_META_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function formatSyncAt(atMs) {
    const value = Number(atMs || 0);
    if (!Number.isFinite(value) || value <= 0) return 'Never';
    try {
      return new Date(value).toLocaleString();
    } catch {
      return 'Never';
    }
  }

  function getLatestSuccessfulSyncAt(meta = {}) {
    return Math.max(
      Number(meta?.lastCloudPullAt || 0) || 0,
      Number(meta?.lastListSyncPushAt || 0) || 0,
      Number(meta?.lastCloudPushAt || 0) || 0
    );
  }

  function refreshLastSyncText() {
    if (!lastSyncText) return;
    const syncMeta = readSyncMeta();
    const latestAt = getLatestSuccessfulSyncAt(syncMeta);
    lastSyncText.textContent = `Last successful sync: ${formatSyncAt(latestAt)}`;
  }

  function refreshFirebaseBackupStatus() {
    if (!window.bilmAuth?.getFirebaseBackupStatus) return;
    const status = window.bilmAuth.getFirebaseBackupStatus();
    const loggedIn = Boolean(window.bilmAuth?.getCurrentUser?.());
    const incognitoEnabled = window.bilmTheme?.getSettings?.()?.incognito === true;
    if (firebaseBackupAutoText) {
      firebaseBackupAutoText.textContent = `Last automatic Firebase backup: ${formatSyncAt(status?.lastAutoBackupAtMs || 0)}`;
    }
    if (firebaseBackupManualText) {
      firebaseBackupManualText.textContent = `Last manual Firebase backup: ${formatSyncAt(status?.lastManualBackupAtMs || 0)}`;
    }
    if (firebaseBackupCadenceText) {
      firebaseBackupCadenceText.textContent = status?.cadenceText
        || 'Automatic backup runs daily at 12:00 AM (local time), once every 24 hours.';
    }
    const nextManualAtMs = Number(status?.nextManualBackupAtMs || 0);
    const availableNow = status?.manualBackupAvailable !== false;
    if (firebaseBackupCooldownText) {
      firebaseBackupCooldownText.textContent = incognitoEnabled
        ? 'Manual backup is unavailable while incognito is on.'
        : (availableNow || !nextManualAtMs
        ? 'Manual backup availability: now'
        : `Manual backup next available at: ${formatSyncAt(nextManualAtMs)}`);
    }
    if (manualFirebaseBackupBtn) {
      manualFirebaseBackupBtn.disabled = !loggedIn
        || incognitoEnabled
        || (!availableNow && nextManualAtMs > Date.now());
    }
  }

  async function requestCloudLoginPermission() {
    await ensureAuthReady();
    if (window.bilmAuth.getCurrentUser()) return true;
    openModal(cloudAuthPromptModal);
    return false;
  }

  function updateMergeUi() {
    const oneReady = Boolean(importSlots.one);
    const twoReady = Boolean(importSlots.two);
    if (importOneStatus) {
      importOneStatus.textContent = oneReady ? '✓ Loaded' : '○ Not loaded';
      importOneStatus.classList.toggle('is-ready', oneReady);
    }
    if (importTwoStatus) {
      importTwoStatus.textContent = twoReady ? '✓ Loaded' : '○ Not loaded';
      importTwoStatus.classList.toggle('is-ready', twoReady);
    }
    if (mergeDataBtn) {
      mergeDataBtn.disabled = !(oneReady && twoReady);
    }
  }

  async function applyBackup(payload, reason = 'account-import') {
    await ensureAuthReady();
    if (!window.bilmAuth?.applyImportedBackupSnapshot) {
      throw new Error('Import service unavailable. Refresh and try again.');
    }
    await window.bilmAuth.applyImportedBackupSnapshot(payload, {
      reason,
      preserveSyncPreference: true,
      preserveSyncMeta: true
    });
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
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
    if (manualFirebaseBackupBtn) {
      manualFirebaseBackupBtn.disabled = !loggedIn;
    }
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
    openSharedAuthModal('login');
  });

  openSignUpModalBtn?.addEventListener('click', () => {
    openSharedAuthModal('signup');
  });

  closeLoginModalBtn?.addEventListener('click', () => closeModal(loginModal));
  closeSignUpModalBtn?.addEventListener('click', () => closeModal(signUpModal));
  closeDataModalBtn?.addEventListener('click', () => {
    closeDataImportModal();
  });
  closeMergeModalBtn?.addEventListener('click', () => closeModal(mergeModal));

  openCreateAccountBtn?.addEventListener('click', () => {
    openSharedAuthModal('signup');
  });

  backToLoginBtn?.addEventListener('click', () => {
    openSharedAuthModal('login');
  });

  [loginModal, signUpModal, dataModal, mergeModal, cloudAuthPromptModal].forEach((modal) => {
    modal?.addEventListener('click', (event) => {
      if (event.target === modal) {
        if (modal === dataModal) {
          closeDataImportModal();
          return;
        }
        closeModal(modal);
      }
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
    const backupJson = formatBackup(payload);
    openDataModal({
      title: 'Export Backup Data',
      message: 'Copy this JSON backup data or download it as a file. It contains your site data as plain text.',
      code: backupJson,
      importMode: false
    });
    transferStatusText.textContent = 'Export popup opened.';
  });

  importDataBtn?.addEventListener('click', () => {
    activeImportSlot = null;
    reopenMergeAfterImportClose = false;
    openDataModal({
      title: 'Import Backup Data',
      message: 'Paste backup JSON or upload a JSON save file. Import auto-salvages spacing and extra wrapper text.',
      importMode: true
    });
    transferStatusText.textContent = 'Import popup opened.';
  });

  openMergeModalBtn?.addEventListener('click', () => {
    updateMergeUi();
    openModal(mergeModal);
  });

  importOneBtn?.addEventListener('click', () => {
    activeImportSlot = 'one';
    reopenMergeAfterImportClose = true;
    closeModal(mergeModal);
    openDataModal({
      title: 'Import 1',
      message: 'Load backup JSON for slot 1. Apply Import saves this slot for merge.',
      importMode: true
    });
    transferStatusText.textContent = 'Import 1 popup opened.';
  });

  importTwoBtn?.addEventListener('click', () => {
    activeImportSlot = 'two';
    reopenMergeAfterImportClose = true;
    closeModal(mergeModal);
    openDataModal({
      title: 'Import 2',
      message: 'Load backup JSON for slot 2. Apply Import saves this slot for merge.',
      importMode: true
    });
    transferStatusText.textContent = 'Import 2 popup opened.';
  });

  copyDataBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(dataCodeField.value);
      transferStatusText.textContent = 'Backup JSON copied.';
      showToast('Copied.', 'success');
    } catch (error) {
      transferStatusText.textContent = 'Clipboard blocked. Copy manually from the text box.';
      showToast('Copy failed.', 'error');
    }
  });

  downloadDataBtn?.addEventListener('click', () => {
    const blob = new Blob([dataCodeField.value], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bilm-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    transferStatusText.textContent = 'Export downloaded.';
    showToast('Download started.', 'success');
  });

  uploadImportBtn?.addEventListener('click', () => {
    importFileInput.click();
  });

  importFileInput?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    dataCodeField.value = await file.text();
    transferStatusText.textContent = `Loaded ${file.name}. We'll auto-salvage spacing and extra text on import.`;
    showToast('Upload successful.', 'success');
    importFileInput.value = '';
  });

  pasteImportBtn?.addEventListener('click', async () => {
    try {
      const clipboardText = await navigator.clipboard.readText();
      dataCodeField.value = clipboardText;
      transferStatusText.textContent = 'Backup JSON pasted from clipboard.';
      showToast('Pasted from clipboard.', 'success');
    } catch (error) {
      transferStatusText.textContent = 'Clipboard read blocked. Paste manually into the text box.';
      showToast('Clipboard read blocked.', 'error');
    }
  });

  cloudExportBtn?.addEventListener('click', async () => {
    try {
      showToast('Exporting...', 'info', 0);
      const canProceed = await requestCloudLoginPermission();
      if (!canProceed) throw new Error('Cloud export cancelled until you choose to log in.');
      await window.bilmAuth.saveCloudSnapshot(collectBackupData());
      transferStatusText.textContent = 'Cloud export successful. Your latest local data is now saved to your account.';
      refreshLastSyncText();
      showToast('Exported successfully.', 'success');
    } catch (error) {
      transferStatusText.textContent = `Cloud export failed: ${error.message}`;
      showToast('Export failed.', 'error');
    }
  });

  cloudImportBtn?.addEventListener('click', async () => {
    try {
      showToast('Importing from cloud...', 'info', 0);
      const canProceed = await requestCloudLoginPermission();
      if (!canProceed) throw new Error('Cloud import cancelled until you choose to log in.');
      const result = await window.bilmAuth.getCloudSnapshot({
        mode: 'data-api-primary-fallback-firestore',
        includeSource: true
      });
      const snapshot = result?.snapshot || null;
      if (!snapshot) throw new Error('No cloud backup found for this account.');
      dataCodeField.value = formatBackup(snapshot);
      const sourceLabel = result?.source === 'data-api'
        ? 'data-api'
        : (result?.source === 'firestore-fallback' ? 'Firestore fallback' : 'cloud source');
      const transferCount = Number(result?.transferItemCount || 0);
      const firestoreCount = Number(result?.firestoreItemCount || 0);
      const selectionReason = String(result?.selectionReason || '').trim();
      console.info('[cloud-import] source selected', {
        source: result?.source || 'none',
        mode: 'data-api-primary-fallback-firestore',
        selectionReason,
        transferCount,
        firestoreCount
      });
      transferStatusText.textContent = `Cloud backup loaded from ${sourceLabel}. (${transferCount} data-api items, ${firestoreCount} firebase items${selectionReason ? `, rule: ${selectionReason}` : ''}) Review the JSON data, then select Apply Import when ready.`;
      showToast(`Cloud import ready (${sourceLabel}).`, 'success');
    } catch (error) {
      transferStatusText.textContent = `Cloud import failed: ${error.message}`;
      showToast('Cloud import failed.', 'error');
    }
  });

  applyImportBtn?.addEventListener('click', async () => {
    try {
      pendingImportPayload = parseBackup(dataCodeField.value);
      if (activeImportSlot) {
        importSlots[activeImportSlot] = pendingImportPayload;
        transferStatusText.textContent = `Import ${activeImportSlot === 'one' ? '1' : '2'} loaded for merge.`;
        activeImportSlot = null;
        reopenMergeAfterImportClose = false;
        closeModal(dataModal);
        updateMergeUi();
        openModal(mergeModal);
        return;
      }
      if (!confirm('Import this backup now? This will overwrite current local data.')) return;
      await applyBackup(pendingImportPayload, 'account-import');
      transferStatusText.textContent = 'Import complete. Reloading...';
      setTimeout(() => location.reload(), 250);
    } catch (error) {
      const hint = /JSON|invalid|empty|characters/i.test(String(error?.message || ''))
        ? ' Import now auto-cleans spacing and hidden characters, so this backup may be damaged. Try exporting again from source, using Cloud Import, or loading a .json backup file.'
        : '';
      transferStatusText.textContent = `Import failed: ${error.message}.${hint}`;
    }
  });

  loginBtn?.addEventListener('click', async () => {
    try {
      await ensureAuthReady();
      const email = loginEmail.value.trim();
      const password = loginPassword.value;
      if (!isValidEmail(email)) throw new Error('Enter a valid email address.');
      if (!password) throw new Error('Enter your password.');
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
      if (!isValidEmail(email)) throw new Error('Enter a valid email address.');
      if (!password || password.length < 8) throw new Error('Password must be at least 8 characters.');
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
      if (confirm('Do you want to export your data before logging out?')) {
        const payload = collectBackupData();
        openDataModal({
          title: 'Export Backup Data',
          message: 'Copy this backup JSON data before signing out.',
          code: formatBackup(payload),
          importMode: false
        });
        transferStatusText.textContent = 'Export opened. Sign out again after saving your code.';
        return;
      }
      await window.bilmAuth.signOut();
      if (getClearOnLogoutSetting()) {
        localStorage.clear();
        sessionStorage.clear();
      }
      transferStatusText.textContent = 'Signed out successfully.';
      statusText.textContent = getClearOnLogoutSetting() ? 'Signed out and cleared local data.' : 'Signed out without clearing local data.';
      setTimeout(() => location.reload(), 200);
    } catch (error) {
      statusText.textContent = `Sign out failed: ${error.message}`;
    }
  });


  mergeDataBtn?.addEventListener('click', async () => {
    try {
      if (mergeDataBtn.disabled) return;
      const merged = mergeBackupPayloads(importSlots.one, importSlots.two, collectBackupData());
      if (!confirm('Merge Import 1 and Import 2 and apply now? This will overwrite current local data.')) return;
      await applyBackup(merged, 'account-merge-import');
      transferStatusText.textContent = 'Merged data applied. Reloading...';
      setTimeout(() => location.reload(), 250);
    } catch (error) {
      transferStatusText.textContent = `Merge failed: ${error.message}`;
    }
  });

  clearOnLogoutToggle?.addEventListener('change', () => {
    setClearOnLogoutSetting(clearOnLogoutToggle.checked);
    statusText.textContent = clearOnLogoutToggle.checked
      ? 'Sign out will clear local data.'
      : 'Sign out will keep local data.';
  });

  syncToggle?.addEventListener('change', async (event) => {
    const enabled = event.target.checked;
    setSyncEnabled(enabled);
    if (!enabled) {
      statusText.textContent = 'Live sync paused on this device.';
      return;
    }

    statusText.textContent = 'Live sync enabled for this device.';
    try {
      await ensureAuthReady();
      if (window.bilmAuth.getCurrentUser()) {
        await window.bilmAuth.syncFromCloudNow();
        refreshLastSyncText();
      }
    } catch (error) {
      statusText.textContent = `Sync refresh failed: ${error.message}`;
    }
  });

  manualFirebaseBackupBtn?.addEventListener('click', async () => {
    try {
      await ensureAuthReady();
      if (!window.bilmAuth?.runManualFirebaseBackup) {
        throw new Error('Manual Firebase backup is unavailable right now.');
      }
      manualFirebaseBackupBtn.disabled = true;
      statusText.textContent = 'Running manual Firebase backup...';
      await window.bilmAuth.runManualFirebaseBackup({
        reason: 'manual-account-sync',
        source: 'settings-account'
      });
      statusText.textContent = 'Manual Firebase backup completed.';
      refreshFirebaseBackupStatus();
    } catch (error) {
      statusText.textContent = `Manual Firebase backup failed: ${error.message}`;
      refreshFirebaseBackupStatus();
    } finally {
      window.setTimeout(() => {
        refreshFirebaseBackupStatus();
      }, 350);
    }
  });

  confirmCloudLoginBtn?.addEventListener('click', () => {
    closeModal(cloudAuthPromptModal);
    closeModal(dataModal);
    openSharedAuthModal('login');
  });

  cancelCloudLoginBtn?.addEventListener('click', () => {
    closeModal(cloudAuthPromptModal);
  });

  toggleLoginPasswordBtn?.addEventListener('click', () => setPasswordVisibility(loginPassword, toggleLoginPasswordBtn));
  toggleSignUpPasswordBtn?.addEventListener('click', () => setPasswordVisibility(signUpPassword, toggleSignUpPasswordBtn));

  window.addEventListener('storage', (event) => {
    if (event.key !== SYNC_META_KEY) return;
    refreshLastSyncText();
    refreshFirebaseBackupStatus();
  });
  window.addEventListener('bilm:theme-changed', () => {
    refreshFirebaseBackupStatus();
  });

  (async () => {
    try {
      await ensureAuthReady();
      if (clearOnLogoutToggle) clearOnLogoutToggle.checked = getClearOnLogoutSetting();
      setSyncEnabled(isSyncEnabled());
      refreshLastSyncText();
      refreshFirebaseBackupStatus();
      updateMergeUi();
      updateAccountUi(window.bilmAuth.getCurrentUser());
      window.bilmAuth.onAuthStateChanged((user) => {
        updateAccountUi(user);
        refreshLastSyncText();
        refreshFirebaseBackupStatus();
      });
      window.bilmAuth.onListSyncApplied?.(() => {
        refreshLastSyncText();
        refreshFirebaseBackupStatus();
      });
      window.bilmAuth.onCloudSnapshotChanged?.(() => {
        refreshLastSyncText();
        refreshFirebaseBackupStatus();
      });
      window.setInterval(() => {
        refreshFirebaseBackupStatus();
      }, 30000);
    } catch (error) {
      accountStatusText.textContent = 'Account tools unavailable right now. Refresh and try again.';
      statusText.textContent = `Auth setup failed: ${error.message}`;
    }
  })();
});
