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

  const accountLinkPanel = document.getElementById('accountLinkPanel');
  const accountLinkSummaryText = document.getElementById('accountLinkSummaryText');
  const accountLinkActiveCard = document.getElementById('accountLinkActiveCard');
  const accountLinkActiveMeta = document.getElementById('accountLinkActiveMeta');
  const accountLinkMyScopesText = document.getElementById('accountLinkMyScopesText');
  const accountLinkPartnerScopesText = document.getElementById('accountLinkPartnerScopesText');
  const accountLinkPendingCard = document.getElementById('accountLinkPendingCard');
  const accountLinkPendingText = document.getElementById('accountLinkPendingText');
  const accountLinkIncomingCard = document.getElementById('accountLinkIncomingCard');
  const accountLinkIncomingList = document.getElementById('accountLinkIncomingList');
  const openAccountLinkModalBtn = document.getElementById('openAccountLinkModalBtn');
  const refreshAccountLinksBtn = document.getElementById('refreshAccountLinksBtn');
  const editAccountLinkScopesBtn = document.getElementById('editAccountLinkScopesBtn');
  const unlinkAccountBtn = document.getElementById('unlinkAccountBtn');

  const accountLinkModal = document.getElementById('accountLinkModal');
  const accountLinkModalTitle = document.getElementById('accountLinkModalTitle');
  const accountLinkModalDescription = document.getElementById('accountLinkModalDescription');
  const accountLinkEmailInput = document.getElementById('accountLinkEmailInput');
  const accountLinkEmailStatus = document.getElementById('accountLinkEmailStatus');
  const accountLinkSelectAllBtn = document.getElementById('accountLinkSelectAllBtn');
  const accountLinkClearAllBtn = document.getElementById('accountLinkClearAllBtn');
  const accountLinkScopeOptions = document.getElementById('accountLinkScopeOptions');
  const accountLinkScopeHint = document.getElementById('accountLinkScopeHint');
  const submitAccountLinkBtn = document.getElementById('submitAccountLinkBtn');
  const closeAccountLinkModalBtn = document.getElementById('closeAccountLinkModalBtn');

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
  const ACCOUNT_LINK_SCOPE_DEFINITIONS = Object.freeze([
    {
      key: 'continueWatching',
      label: 'Continue Watching',
      description: 'Sync in-progress titles and where you left off.'
    },
    {
      key: 'favorites',
      label: 'Favorites',
      description: 'Share each account\'s favorite movies and shows.'
    },
    {
      key: 'watchHistory',
      label: 'Watch History',
      description: 'Share watched titles and timestamps.'
    },
    {
      key: 'searchHistory',
      label: 'Search History',
      description: 'Share previous searches for faster recommendations.'
    },
    {
      key: 'secretChat',
      label: 'Secret Chat',
      description: 'Share secure chat context (only for chat-active accounts).'
    }
  ]);

  let accountLinkState = {
    links: [],
    incomingRequests: [],
    pendingRequests: [],
    activeLink: null,
    chatReady: false
  };
  let accountLinkModalMode = 'create';
  let accountLinkEditingLinkId = '';
  let accountLinkTargetCapabilities = null;
  let accountLinkCapabilitiesLookupTimer = null;

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
    closeAccountLinkModal();
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

  function createDefaultAccountLinkScopes() {
    return ACCOUNT_LINK_SCOPE_DEFINITIONS.reduce((scopes, definition) => {
      scopes[definition.key] = false;
      return scopes;
    }, {});
  }

  function normalizeAccountLinkShareScopes(rawScopes = {}) {
    const source = rawScopes && typeof rawScopes === 'object' && !Array.isArray(rawScopes)
      ? rawScopes
      : {};
    const normalized = createDefaultAccountLinkScopes();
    ACCOUNT_LINK_SCOPE_DEFINITIONS.forEach((definition) => {
      const camelKey = definition.key;
      const snakeKey = camelKey.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
      normalized[camelKey] = source[camelKey] === true || source[snakeKey] === true;
    });
    return normalized;
  }

  function getEnabledScopeLabels(scopes = {}) {
    const normalized = normalizeAccountLinkShareScopes(scopes);
    return ACCOUNT_LINK_SCOPE_DEFINITIONS
      .filter((definition) => normalized[definition.key] === true)
      .map((definition) => definition.label);
  }

  function formatScopeSummary(scopes = {}) {
    const labels = getEnabledScopeLabels(scopes);
    return labels.length ? labels.join(', ') : 'Nothing selected.';
  }

  function setAccountLinkSummary(text) {
    if (!accountLinkSummaryText) return;
    accountLinkSummaryText.textContent = text;
  }

  function closeAccountLinkModal() {
    closeModal(accountLinkModal);
    accountLinkTargetCapabilities = null;
    accountLinkEditingLinkId = '';
    accountLinkModalMode = 'create';
    if (accountLinkCapabilitiesLookupTimer) {
      window.clearTimeout(accountLinkCapabilitiesLookupTimer);
      accountLinkCapabilitiesLookupTimer = null;
    }
  }

  function getAccountLinkModalSelectedScopes() {
    const selected = createDefaultAccountLinkScopes();
    accountLinkScopeOptions?.querySelectorAll('input[type="checkbox"][data-scope-key]').forEach((checkbox) => {
      const scopeKey = String(checkbox.dataset.scopeKey || '').trim();
      if (!scopeKey || !Object.prototype.hasOwnProperty.call(selected, scopeKey)) return;
      selected[scopeKey] = checkbox.checked;
    });
    return normalizeAccountLinkShareScopes(selected);
  }

  function setAccountLinkModalScopeSelection(nextScopes = {}) {
    const normalized = normalizeAccountLinkShareScopes(nextScopes);
    accountLinkScopeOptions?.querySelectorAll('input[type="checkbox"][data-scope-key]').forEach((checkbox) => {
      const scopeKey = String(checkbox.dataset.scopeKey || '').trim();
      if (!scopeKey || !Object.prototype.hasOwnProperty.call(normalized, scopeKey)) return;
      checkbox.checked = normalized[scopeKey] === true;
    });
  }

  function renderAccountLinkScopeOptions({ selectedScopes = {}, chatEligible = false } = {}) {
    if (!accountLinkScopeOptions) return;
    const normalizedScopes = normalizeAccountLinkShareScopes(selectedScopes);
    accountLinkScopeOptions.innerHTML = '';
    ACCOUNT_LINK_SCOPE_DEFINITIONS.forEach((definition) => {
      if (definition.key === 'secretChat' && chatEligible !== true && normalizedScopes.secretChat !== true) {
        return;
      }
      const row = document.createElement('label');
      row.className = 'scope-option';

      const head = document.createElement('span');
      head.className = 'scope-option-head';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.scopeKey = definition.key;
      input.checked = normalizedScopes[definition.key] === true;
      head.appendChild(input);

      const text = document.createElement('span');
      text.textContent = definition.label;
      head.appendChild(text);

      const help = document.createElement('span');
      help.className = 'scope-option-help';
      help.textContent = definition.description;

      row.appendChild(head);
      row.appendChild(help);
      accountLinkScopeOptions.appendChild(row);
    });
    if (accountLinkScopeHint) {
      accountLinkScopeHint.textContent = chatEligible
        ? 'Secret Chat is available because this partner account already has chat activity.'
        : 'Secret Chat appears only when the partner account already has chat history.';
    }
  }

  function updateAccountLinkActionButtons({ busy = false, submitLabel = '' } = {}) {
    if (submitAccountLinkBtn) {
      if (submitLabel) submitAccountLinkBtn.textContent = submitLabel;
      submitAccountLinkBtn.disabled = busy;
    }
    if (accountLinkSelectAllBtn) accountLinkSelectAllBtn.disabled = busy;
    if (accountLinkClearAllBtn) accountLinkClearAllBtn.disabled = busy;
    if (closeAccountLinkModalBtn) closeAccountLinkModalBtn.disabled = busy;
    if (accountLinkEmailInput) accountLinkEmailInput.disabled = busy || accountLinkEmailInput.dataset.locked === '1';
  }

  async function lookupAccountLinkCapabilities(targetEmail, { quiet = false } = {}) {
    const normalizedEmail = String(targetEmail || '').trim().toLowerCase();
    if (!isValidEmail(normalizedEmail)) {
      accountLinkTargetCapabilities = null;
      if (!quiet && accountLinkEmailStatus) {
        accountLinkEmailStatus.textContent = 'Enter a valid email to check chat eligibility.';
      }
      return null;
    }
    if (accountLinkEmailStatus && !quiet) {
      accountLinkEmailStatus.textContent = 'Checking account availability...';
    }
    try {
      const payload = await window.bilmAuth.getAccountLinkTargetCapabilities(normalizedEmail);
      accountLinkTargetCapabilities = payload || null;
      const enforceBlockingChecks = accountLinkModalMode === 'create';
      if (accountLinkEmailStatus) {
        if (enforceBlockingChecks && payload?.requesterBlocked) {
          accountLinkEmailStatus.textContent = 'You already have a pending or active link. Unlink first.';
        } else if (enforceBlockingChecks && payload?.targetBlocked) {
          accountLinkEmailStatus.textContent = 'That account already has a pending or active link.';
        } else if (payload?.accountFound !== true) {
          accountLinkEmailStatus.textContent = 'No account found yet for this email. They can still approve later once they sign in.';
        } else {
          accountLinkEmailStatus.textContent = payload?.chatEligible
            ? 'Account found. Secret Chat is available.'
            : 'Account found. Secret Chat stays hidden until this account uses chat.';
        }
      }
      const selectedScopes = getAccountLinkModalSelectedScopes();
      if (payload?.chatEligible !== true) {
        selectedScopes.secretChat = false;
      }
      renderAccountLinkScopeOptions({
        selectedScopes,
        chatEligible: payload?.chatEligible === true
      });
      setAccountLinkModalScopeSelection(selectedScopes);
      return payload;
    } catch (error) {
      accountLinkTargetCapabilities = null;
      if (accountLinkEmailStatus) {
        accountLinkEmailStatus.textContent = `Could not verify account: ${error.message || 'request failed.'}`;
      }
      return null;
    }
  }

  function queueAccountLinkCapabilitiesLookup(targetEmail) {
    if (accountLinkCapabilitiesLookupTimer) {
      window.clearTimeout(accountLinkCapabilitiesLookupTimer);
    }
    accountLinkCapabilitiesLookupTimer = window.setTimeout(() => {
      accountLinkCapabilitiesLookupTimer = null;
      void lookupAccountLinkCapabilities(targetEmail);
    }, 260);
  }

  function getOutgoingPendingLink() {
    const pending = Array.isArray(accountLinkState?.pendingRequests) ? accountLinkState.pendingRequests : [];
    return pending.find((link) => link?.myRole === 'requester') || null;
  }

  async function refreshAccountLinkState({ silent = false } = {}) {
    if (!accountLinkPanel || !window.bilmAuth) return;
    const user = window.bilmAuth.getCurrentUser?.();
    if (!user) {
      accountLinkState = {
        links: [],
        incomingRequests: [],
        pendingRequests: [],
        activeLink: null,
        chatReady: false
      };
      setAccountLinkSummary('Sign in to request, approve, or manage account links.');
      if (accountLinkActiveCard) accountLinkActiveCard.hidden = true;
      if (accountLinkPendingCard) accountLinkPendingCard.hidden = true;
      if (accountLinkIncomingCard) accountLinkIncomingCard.hidden = true;
      if (openAccountLinkModalBtn) openAccountLinkModalBtn.disabled = true;
      if (refreshAccountLinksBtn) refreshAccountLinksBtn.disabled = true;
      return;
    }

    if (!window.bilmAuth.getAccountLinkState) {
      setAccountLinkSummary('Account linking is unavailable until auth sync finishes loading.');
      if (openAccountLinkModalBtn) openAccountLinkModalBtn.disabled = true;
      if (refreshAccountLinksBtn) refreshAccountLinksBtn.disabled = true;
      return;
    }

    if (!silent) setAccountLinkSummary('Loading account link status...');
    if (refreshAccountLinksBtn) refreshAccountLinksBtn.disabled = true;
    try {
      const payload = await window.bilmAuth.getAccountLinkState();
      accountLinkState = {
        links: Array.isArray(payload?.links) ? payload.links : [],
        incomingRequests: Array.isArray(payload?.incomingRequests) ? payload.incomingRequests : [],
        pendingRequests: Array.isArray(payload?.pendingRequests) ? payload.pendingRequests : [],
        activeLink: payload?.activeLink && typeof payload.activeLink === 'object' ? payload.activeLink : null,
        chatReady: payload?.chatReady === true
      };
    } catch (error) {
      setAccountLinkSummary(`Could not load account links: ${error.message || 'request failed.'}`);
      if (refreshAccountLinksBtn) refreshAccountLinksBtn.disabled = false;
      if (openAccountLinkModalBtn) openAccountLinkModalBtn.disabled = false;
      return;
    } finally {
      if (refreshAccountLinksBtn) refreshAccountLinksBtn.disabled = false;
    }

    const activeLink = accountLinkState.activeLink;
    const incoming = Array.isArray(accountLinkState.incomingRequests) ? accountLinkState.incomingRequests : [];
    const outgoingPending = getOutgoingPendingLink();
    const hasBlockingLink = Boolean(activeLink || outgoingPending || incoming.length);

    if (openAccountLinkModalBtn) openAccountLinkModalBtn.disabled = hasBlockingLink;
    if (editAccountLinkScopesBtn) editAccountLinkScopesBtn.disabled = !activeLink;
    if (unlinkAccountBtn) unlinkAccountBtn.disabled = !activeLink;

    if (activeLink) {
      if (accountLinkActiveCard) accountLinkActiveCard.hidden = false;
      if (accountLinkActiveMeta) {
        const linkedAt = Number(activeLink?.activatedAtMs || activeLink?.updatedAtMs || 0);
        const linkedText = linkedAt > 0 ? `Linked since ${formatSyncAt(linkedAt)}.` : 'Link is active.';
        accountLinkActiveMeta.textContent = `${activeLink?.partner?.email || 'Partner'} is linked. ${linkedText}`;
      }
      if (accountLinkMyScopesText) accountLinkMyScopesText.textContent = formatScopeSummary(activeLink?.me?.shareScopes);
      if (accountLinkPartnerScopesText) accountLinkPartnerScopesText.textContent = formatScopeSummary(activeLink?.partner?.shareScopes);
      setAccountLinkSummary('Account link is active. You can adjust sharing scopes or unlink anytime.');
    } else if (accountLinkActiveCard) {
      accountLinkActiveCard.hidden = true;
    }

    if (outgoingPending) {
      if (accountLinkPendingCard) accountLinkPendingCard.hidden = false;
      if (accountLinkPendingText) {
        const targetEmail = outgoingPending?.partner?.email || outgoingPending?.target?.email || 'the other account';
        accountLinkPendingText.textContent = `Waiting for ${targetEmail} to approve your request.`;
      }
      if (!activeLink) {
        setAccountLinkSummary('You have a pending request. Sharing starts after the other account approves.');
      }
    } else if (accountLinkPendingCard) {
      accountLinkPendingCard.hidden = true;
    }

    if (accountLinkIncomingCard) {
      accountLinkIncomingCard.hidden = incoming.length < 1;
    }
    if (accountLinkIncomingList) {
      accountLinkIncomingList.innerHTML = '';
      incoming.forEach((link) => {
        const card = document.createElement('article');
        card.className = 'incoming-request-card';

        const title = document.createElement('h4');
        title.textContent = link?.partner?.email || 'Incoming request';
        card.appendChild(title);

        const detail = document.createElement('p');
        detail.className = 'muted';
        detail.textContent = `They want to share: ${formatScopeSummary(link?.partner?.shareScopes)}`;
        card.appendChild(detail);

        const actions = document.createElement('div');
        actions.className = 'actions';

        const approveBtn = document.createElement('button');
        approveBtn.type = 'button';
        approveBtn.className = 'btn';
        approveBtn.textContent = 'Approve';
        approveBtn.addEventListener('click', () => {
          void openAccountLinkModalForMode('approve', {
            linkId: link?.id || '',
            partnerEmail: link?.partner?.email || '',
            shareScopes: link?.me?.shareScopes || {}
          });
        });
        actions.appendChild(approveBtn);

        const declineBtn = document.createElement('button');
        declineBtn.type = 'button';
        declineBtn.className = 'btn btn-outline';
        declineBtn.textContent = 'Decline';
        declineBtn.addEventListener('click', async () => {
          if (!confirm('Decline this account-link request?')) return;
          try {
            await window.bilmAuth.respondToAccountLinkRequest({
              linkId: String(link?.id || '').trim(),
              action: 'decline'
            });
            showToast('Request declined.', 'success');
            await refreshAccountLinkState({ silent: true });
          } catch (error) {
            statusText.textContent = `Decline failed: ${error.message}`;
          }
        });
        actions.appendChild(declineBtn);

        card.appendChild(actions);
        accountLinkIncomingList.appendChild(card);
      });
    }

    if (!activeLink && !outgoingPending && incoming.length < 1) {
      setAccountLinkSummary('No linked account yet. Send one secure request to get started.');
    } else if (!activeLink && incoming.length > 0) {
      setAccountLinkSummary('You have incoming account-link requests waiting for approval.');
    }
  }

  async function openAccountLinkModalForMode(mode = 'create', options = {}) {
    await ensureAuthReady();
    const user = window.bilmAuth.getCurrentUser?.();
    if (!user) {
      statusText.textContent = 'Log in first to manage account linking.';
      return;
    }
    accountLinkModalMode = mode;
    accountLinkEditingLinkId = String(options?.linkId || '').trim();
    accountLinkTargetCapabilities = null;

    const initialScopes = normalizeAccountLinkShareScopes(
      options?.shareScopes
      || window.bilmAuth.getAccountLinkScopeTemplate?.()
      || createDefaultAccountLinkScopes()
    );
    const partnerEmail = String(options?.partnerEmail || '').trim().toLowerCase();

    if (accountLinkEmailInput) {
      accountLinkEmailInput.value = partnerEmail;
      accountLinkEmailInput.dataset.locked = mode === 'create' ? '0' : '1';
      accountLinkEmailInput.disabled = mode !== 'create';
    }

    if (mode === 'create') {
      accountLinkModalTitle.textContent = 'Link Account';
      accountLinkModalDescription.textContent = 'Send a secure account-link request. The partner account must approve before sharing starts.';
      submitAccountLinkBtn.textContent = 'Send Request';
      accountLinkEmailStatus.textContent = 'Enter an email to check availability.';
    } else if (mode === 'approve') {
      accountLinkModalTitle.textContent = 'Approve Account Link';
      accountLinkModalDescription.textContent = 'Choose what you want to share, then approve the request.';
      submitAccountLinkBtn.textContent = 'Approve Request';
      accountLinkEmailStatus.textContent = 'Checking partner capabilities...';
    } else {
      accountLinkModalTitle.textContent = 'Edit Sharing Scope';
      accountLinkModalDescription.textContent = 'Adjust what this linked account can receive from you.';
      submitAccountLinkBtn.textContent = 'Save Sharing';
      accountLinkEmailStatus.textContent = 'Checking partner capabilities...';
    }

    renderAccountLinkScopeOptions({
      selectedScopes: initialScopes,
      chatEligible: false
    });
    setAccountLinkModalScopeSelection(initialScopes);
    openModal(accountLinkModal);

    if (mode === 'create') {
      accountLinkEmailInput?.focus();
    } else if (partnerEmail) {
      await lookupAccountLinkCapabilities(partnerEmail);
    }
  }

  async function submitAccountLinkModal() {
    await ensureAuthReady();
    if (!window.bilmAuth?.createAccountLinkRequest) {
      throw new Error('Account linking is unavailable right now.');
    }
    const selectedScopes = getAccountLinkModalSelectedScopes();
    const hasSelection = Object.values(selectedScopes).some((value) => value === true);
    if (!hasSelection) {
      throw new Error('Select at least one category to share.');
    }

    const targetEmail = String(accountLinkEmailInput?.value || '').trim().toLowerCase();
    if (!isValidEmail(targetEmail)) {
      throw new Error('Enter a valid partner email.');
    }
    if (String(accountLinkTargetCapabilities?.targetEmail || '').trim().toLowerCase() !== targetEmail) {
      await lookupAccountLinkCapabilities(targetEmail, { quiet: true });
    }
    if (accountLinkModalMode === 'create') {
      if (accountLinkTargetCapabilities?.requesterBlocked) {
        throw new Error('You already have a pending or active account link.');
      }
      if (accountLinkTargetCapabilities?.targetBlocked) {
        throw new Error('That account already has a pending or active account link.');
      }
    }
    if (selectedScopes.secretChat && accountLinkTargetCapabilities?.chatEligible !== true) {
      throw new Error('Secret Chat is unavailable until the partner account has chat activity.');
    }

    updateAccountLinkActionButtons({ busy: true, submitLabel: 'Sending...' });
    try {
      if (accountLinkModalMode === 'approve') {
        await window.bilmAuth.respondToAccountLinkRequest({
          linkId: accountLinkEditingLinkId,
          action: 'approve',
          shareScopes: selectedScopes
        });
        showToast('Account link approved.', 'success');
      } else if (accountLinkModalMode === 'edit') {
        await window.bilmAuth.updateAccountLinkScopes({
          linkId: accountLinkEditingLinkId,
          shareScopes: selectedScopes
        });
        showToast('Sharing scopes updated.', 'success');
      } else {
        await window.bilmAuth.createAccountLinkRequest({
          targetEmail,
          shareScopes: selectedScopes
        });
        showToast('Link request sent.', 'success');
      }
      closeAccountLinkModal();
      await refreshAccountLinkState({ silent: true });
    } finally {
      const idleLabel = accountLinkModalMode === 'approve'
        ? 'Approve Request'
        : (accountLinkModalMode === 'edit' ? 'Save Sharing' : 'Send Request');
      updateAccountLinkActionButtons({
        busy: false,
        submitLabel: idleLabel
      });
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
    if (refreshAccountLinksBtn) {
      refreshAccountLinksBtn.disabled = !loggedIn;
    }
    if (openAccountLinkModalBtn) {
      openAccountLinkModalBtn.disabled = !loggedIn;
    }
    usernameInput.value = user?.displayName || '';
    if (!loggedIn) {
      setAccountLinkSummary('Sign in to request, approve, or manage account links.');
      if (accountLinkActiveCard) accountLinkActiveCard.hidden = true;
      if (accountLinkPendingCard) accountLinkPendingCard.hidden = true;
      if (accountLinkIncomingCard) accountLinkIncomingCard.hidden = true;
    }
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
  closeAccountLinkModalBtn?.addEventListener('click', () => closeAccountLinkModal());

  openCreateAccountBtn?.addEventListener('click', () => {
    openSharedAuthModal('signup');
  });

  backToLoginBtn?.addEventListener('click', () => {
    openSharedAuthModal('login');
  });

  [loginModal, signUpModal, dataModal, mergeModal, cloudAuthPromptModal, accountLinkModal].forEach((modal) => {
    modal?.addEventListener('click', (event) => {
      if (event.target === modal) {
        if (modal === dataModal) {
          closeDataImportModal();
          return;
        }
        if (modal === accountLinkModal) {
          closeAccountLinkModal();
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

  openAccountLinkModalBtn?.addEventListener('click', () => {
    void openAccountLinkModalForMode('create');
  });

  refreshAccountLinksBtn?.addEventListener('click', async () => {
    try {
      await ensureAuthReady();
      await refreshAccountLinkState();
    } catch (error) {
      statusText.textContent = `Link refresh failed: ${error.message}`;
    }
  });

  editAccountLinkScopesBtn?.addEventListener('click', () => {
    const activeLink = accountLinkState?.activeLink;
    if (!activeLink?.id) return;
    void openAccountLinkModalForMode('edit', {
      linkId: activeLink.id,
      partnerEmail: activeLink?.partner?.email || '',
      shareScopes: activeLink?.me?.shareScopes || {}
    });
  });

  unlinkAccountBtn?.addEventListener('click', async () => {
    try {
      await ensureAuthReady();
      const activeLink = accountLinkState?.activeLink;
      if (!activeLink?.id) return;
      if (!confirm(`Unlink account ${activeLink?.partner?.email || ''}?`)) return;
      unlinkAccountBtn.disabled = true;
      await window.bilmAuth.unlinkAccountLink(activeLink.id);
      showToast('Account unlinked.', 'success');
      await refreshAccountLinkState({ silent: true });
    } catch (error) {
      statusText.textContent = `Unlink failed: ${error.message}`;
    } finally {
      unlinkAccountBtn.disabled = false;
    }
  });

  accountLinkEmailInput?.addEventListener('input', () => {
    if (accountLinkEmailInput.dataset.locked === '1') return;
    const selected = getAccountLinkModalSelectedScopes();
    if (!isValidEmail(accountLinkEmailInput.value)) {
      accountLinkTargetCapabilities = null;
      selected.secretChat = false;
      renderAccountLinkScopeOptions({
        selectedScopes: selected,
        chatEligible: false
      });
      setAccountLinkModalScopeSelection(selected);
      if (accountLinkEmailStatus) {
        accountLinkEmailStatus.textContent = 'Enter a valid email to check account availability.';
      }
      return;
    }
    queueAccountLinkCapabilitiesLookup(accountLinkEmailInput.value);
  });

  accountLinkSelectAllBtn?.addEventListener('click', () => {
    const selected = getAccountLinkModalSelectedScopes();
    ACCOUNT_LINK_SCOPE_DEFINITIONS.forEach((definition) => {
      if (definition.key === 'secretChat' && accountLinkTargetCapabilities?.chatEligible !== true) {
        selected[definition.key] = false;
        return;
      }
      selected[definition.key] = true;
    });
    setAccountLinkModalScopeSelection(selected);
  });

  accountLinkClearAllBtn?.addEventListener('click', () => {
    setAccountLinkModalScopeSelection(createDefaultAccountLinkScopes());
  });

  submitAccountLinkBtn?.addEventListener('click', async () => {
    try {
      await submitAccountLinkModal();
    } catch (error) {
      statusText.textContent = `Account link update failed: ${error.message || 'request failed.'}`;
      if (accountLinkEmailStatus) {
        accountLinkEmailStatus.textContent = error.message || 'Account link request failed.';
      }
    }
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
      await refreshAccountLinkState({ silent: true });
      window.bilmAuth.onAuthStateChanged((user) => {
        updateAccountUi(user);
        refreshLastSyncText();
        refreshFirebaseBackupStatus();
        void refreshAccountLinkState({ silent: true });
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
