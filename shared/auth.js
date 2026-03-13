(() => {
  const FIREBASE_VERSION = '12.9.0';
  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyA9buNkqJFx81VU0sXXVed9SC3cz5H98TE',
    authDomain: 'bilm-7bfe1.firebaseapp.com',
    projectId: 'bilm-7bfe1',
    storageBucket: 'bilm-7bfe1.firebasestorage.app',
    messagingSenderId: '82694612591',
    appId: '1:82694612591:web:da15d342bea07878244f9a',
    measurementId: 'G-3481XXPLFV'
  };


  const DATA_API_BASE = 'https://data-api.watchbilm.org';
  const LIST_SYNC_PUSH_PATH = '/sync/lists/push';
  const LIST_SYNC_PULL_PATH = '/sync/lists/pull';
  const SECTOR_SYNC_PUSH_PATH = '/sync/sectors/push';
  const SECTOR_SYNC_PULL_PATH = '/sync/sectors/pull';
  const SECTOR_SYNC_BOOTSTRAP_PATH = '/sync/sectors/bootstrap';
  const TRANSFER_API_DISABLE_KEY = 'bilm-transfer-api-disabled';

  let transferApiDisabled = false;
  try {
    localStorage.removeItem(TRANSFER_API_DISABLE_KEY);
  } catch {}

  function getTransferUserId(user) {
    const uid = String(user?.uid || '').trim();
    if (!uid) throw new Error('Missing account identifier for cloud transfer.');
    // The transfer API already namespaces user IDs with "user-" internally.
    return uid.replace(/^user-/i, '');
  }

  function disableTransferApi(reason) {
    transferApiDisabled = false;
    console.warn(`Data API transient issue (${reason}). Retrying with backoff.`);
  }

  function shouldDisableTransferApi(error) {
    const message = String(error?.message || '').toLowerCase();
    return error instanceof TypeError || message.includes('failed to fetch') || message.includes('networkerror');
  }

  async function getTransferAuthHeader(user) {
    if (!user || typeof user.getIdToken !== 'function') {
      throw new Error('Cloud transfer requires a signed-in Firebase session.');
    }
    const idToken = await user.getIdToken();
    if (!idToken) throw new Error('Missing Firebase auth token for cloud transfer.');
    return `Bearer ${idToken}`;
  }

  function extractSnapshotFromApiPayload(payload) {
    if (!payload) return null;
    if (payload.schema === 'bilm-backup-v1') return payload;
    const candidates = [payload.export, payload.snapshot, payload.value, payload.data, payload.backup, payload.cloudBackup?.snapshot];
    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'object' && candidate.schema === 'bilm-backup-v1') {
        return candidate;
      }
      if (typeof candidate === 'string') {
        const parsed = safeParse(candidate, null);
        if (parsed?.schema === 'bilm-backup-v1') return parsed;
      }
    }
    return null;
  }

  async function saveSnapshotToTransferApi(user, userId, snapshot) {
    if (transferApiDisabled) return false;
    const url = `${DATA_API_BASE}/?userId=${encodeURIComponent(userId)}`;
    const authorization = await getTransferAuthHeader(user);
    const normalizedSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : null;
    if (!normalizedSnapshot) {
      throw new Error('Cannot save cloud snapshot: invalid payload format.');
    }
    const body = JSON.stringify({
      userId,
      data: normalizedSnapshot
    });
    const headers = {
      'content-type': 'application/json',
      authorization
    };

    let response;
    try {
      response = await fetch(url, { method: 'POST', headers, body });
    } catch (error) {
      if (shouldDisableTransferApi(error)) disableTransferApi('network/CORS failure on save');
      throw error;
    }

    if (!response.ok) {
      const parsedError = await parseTransferError(response);
      logTransferFailure('snapshot-save', parsedError, { userId, endpoint: '/' });
      throw parsedError;
    }
    return true;
  }

  async function loadSnapshotFromTransferApi(user, userId) {
    if (transferApiDisabled) return null;
    const url = `${DATA_API_BASE}/?userId=${encodeURIComponent(userId)}`;
    const authorization = await getTransferAuthHeader(user);
    let response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
          authorization
        }
      });
    } catch (error) {
      if (shouldDisableTransferApi(error)) disableTransferApi('network/CORS failure on load');
      throw error;
    }

    if (response.status === 404) return null;
    if (!response.ok) {
      const parsedError = await parseTransferError(response);
      logTransferFailure('snapshot-load', parsedError, { userId, endpoint: '/' });
      throw parsedError;
    }

    const text = await response.text();
    const parsed = safeParse(text, null);
    if (!parsed && !text.trim()) return null;
    const snapshot = extractSnapshotFromApiPayload(parsed || text);
    if (!snapshot && text) {
      const second = safeParse(String(text), null);
      return second?.schema === 'bilm-backup-v1' ? second : null;
    }
    return snapshot;
  }

  async function pushListOperationsToTransferApi(user, userId, operations) {
    if (transferApiDisabled) return null;
    if (!Array.isArray(operations) || operations.length === 0) {
      return { ok: true, processed: 0, cursorMs: 0 };
    }

    const sectorOperations = operations
      .map((operation) => toSectorOperation(operation))
      .filter(Boolean);
    if (!sectorOperations.length) {
      return { ok: true, processed: 0, cursorMs: 0 };
    }

    const url = `${DATA_API_BASE}${SECTOR_SYNC_PUSH_PATH}`;
    const authorization = await getTransferAuthHeader(user);
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization
        },
        body: JSON.stringify({
          userId,
          deviceId: getOrCreateDeviceId(),
          operations: sectorOperations
        })
      });
    } catch (error) {
      if (shouldDisableTransferApi(error)) disableTransferApi('network/CORS failure on sector push');
      throw error;
    }

    if (response.status === 404) {
      // Fallback for older backend deployments during rollout.
      const legacyOperations = operations
        .map((operation) => {
          if (operation?.listKey && MERGEABLE_LIST_KEYS.has(String(operation.listKey || '').trim())) {
            return operation;
          }
          const maybeList = toListOperation(operation);
          return maybeList && MERGEABLE_LIST_KEYS.has(String(maybeList.listKey || '').trim()) ? maybeList : null;
        })
        .filter(Boolean);
      if (!legacyOperations.length) {
        return { ok: true, processed: 0, cursorMs: 0, legacy: true };
      }
      const legacyResponse = await fetch(`${DATA_API_BASE}${LIST_SYNC_PUSH_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization
        },
        body: JSON.stringify({
          userId,
          deviceId: getOrCreateDeviceId(),
          operations: legacyOperations
        })
      });
      if (!legacyResponse.ok) {
        const parsedError = await parseTransferError(legacyResponse);
        logTransferFailure('push-legacy', parsedError, { userId, endpoint: LIST_SYNC_PUSH_PATH });
        throw parsedError;
      }
      return await legacyResponse.json();
    }

    if (!response.ok) {
      const parsedError = await parseTransferError(response);
      logTransferFailure('push', parsedError, { userId, endpoint: SECTOR_SYNC_PUSH_PATH });
      throw parsedError;
    }
    return await response.json();
  }

  async function pullSectorOperationsFromTransferApi(user, userId, {
    sinceMs = 0,
    limit = 250,
    sectors = ALL_PULL_SECTOR_KEYS,
    allowLegacyListFallback = false
  } = {}) {
    if (transferApiDisabled) return null;
    const pullUrl = new URL(`${DATA_API_BASE}${SECTOR_SYNC_PULL_PATH}`);
    pullUrl.searchParams.set('userId', userId);
    pullUrl.searchParams.set('since', String(Math.max(0, Number(sinceMs || 0) || 0)));
    pullUrl.searchParams.set('limit', String(Math.max(1, Math.min(500, Number(limit || 250) || 250))));
    const requestedSectors = Array.isArray(sectors)
      ? [...new Set(sectors.map((sector) => String(sector || '').trim().toLowerCase()).filter(Boolean))]
      : [];
    if (requestedSectors.length) {
      pullUrl.searchParams.set('sectors', requestedSectors.join(','));
    }
    const authorization = await getTransferAuthHeader(user);

    let response;
    try {
      response = await fetch(pullUrl.toString(), {
        method: 'GET',
        headers: {
          accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
          authorization
        }
      });
    } catch (error) {
      if (shouldDisableTransferApi(error)) disableTransferApi('network/CORS failure on sector pull');
      throw error;
    }

    if (response.status === 404 && allowLegacyListFallback) {
      const legacyPullUrl = new URL(`${DATA_API_BASE}${LIST_SYNC_PULL_PATH}`);
      legacyPullUrl.searchParams.set('userId', userId);
      legacyPullUrl.searchParams.set('since', String(Math.max(0, Number(sinceMs || 0) || 0)));
      legacyPullUrl.searchParams.set('limit', String(Math.max(1, Math.min(500, Number(limit || 250) || 250))));
      const legacyResponse = await fetch(legacyPullUrl.toString(), {
        method: 'GET',
        headers: {
          accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
          authorization
        }
      });
      if (legacyResponse.status === 404) return { ok: true, operations: [], cursorMs: sinceMs, state: null };
      if (!legacyResponse.ok) {
        const parsedError = await parseTransferError(legacyResponse);
        logTransferFailure('pull-legacy', parsedError, { userId, endpoint: LIST_SYNC_PULL_PATH });
        throw parsedError;
      }
      return await legacyResponse.json();
    }
    if (!response.ok) {
      const parsedError = await parseTransferError(response);
      logTransferFailure('pull', parsedError, { userId, endpoint: SECTOR_SYNC_PULL_PATH });
      throw parsedError;
    }
    return await response.json();
  }

  async function pullListOperationsFromTransferApi(user, userId, sinceMs = 0, limit = 250) {
    const payload = await pullSectorOperationsFromTransferApi(user, userId, {
      sinceMs,
      limit,
      sectors: ALL_PULL_SECTOR_KEYS,
      allowLegacyListFallback: true
    });
    if (!payload) return null;
    const rawSectorOperations = Array.isArray(payload?.operations) ? payload.operations : [];
    const converted = rawSectorOperations
      .map((operation) => toListOperation(operation))
      .filter(Boolean);
    const storageOperations = rawSectorOperations
      .map((operation) => toStorageSectorOperation(operation))
      .filter(Boolean);
    return {
      ...payload,
      operations: converted,
      sectorOperations: storageOperations
    };
  }

  async function bootstrapSectorOperationsToTransferApi(user, userId, operations, migrationSource = 'local_fallback') {
    if (transferApiDisabled) return null;
    const sectorOperations = Array.isArray(operations)
      ? operations.map((operation) => toSectorOperation(operation)).filter(Boolean)
      : [];
    const url = `${DATA_API_BASE}${SECTOR_SYNC_BOOTSTRAP_PATH}`;
    const authorization = await getTransferAuthHeader(user);
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization
        },
        body: JSON.stringify({
          userId,
          deviceId: getOrCreateDeviceId(),
          migrationSource,
          operations: sectorOperations
        })
      });
    } catch (error) {
      if (shouldDisableTransferApi(error)) disableTransferApi('network/CORS failure on sector bootstrap');
      throw error;
    }

    if (response.status === 404) {
      return { ok: false, skipped: true, legacy: true };
    }
    if (!response.ok) {
      const parsedError = await parseTransferError(response);
      logTransferFailure('bootstrap', parsedError, { userId, endpoint: SECTOR_SYNC_BOOTSTRAP_PATH });
      throw parsedError;
    }
    return await response.json();
  }

  const subscribers = new Set();
  let initPromise;
  let modules;
  let app;
  let auth;
  let firestore;
  let analytics;
  let currentUser = null;
  let cloudSnapshotUnsubscribe = null;
  let lastCloudSnapshotEvent = null;
  const cloudSubscribers = new Set();
  let autosyncInterval = null;
  let autosyncFlushBound = false;
  let pendingAutosync = false;
  let pendingListSync = false;
  let mutationObserverInstalled = false;
  let autosyncDebounceTimer = null;
  let listSyncDebounceTimer = null;
  let suppressMutationHook = false;
  let externalMutationSuppressionDepth = 0;
  let lastUploadedCloudSignature = '';
  let lastLocalSnapshotSignature = '';
  let lastSaveAttemptAt = 0;
  let snapshotListenerReady = false;
  let firebaseAutoBackupTimer = null;
  let snapshotRecoveryCheckedThisSession = false;
  let sectorBootstrapCheckedThisSession = false;

  const MIN_SAVE_INTERVAL_MS = 15000;
  const AUTOSYNC_HEARTBEAT_MS = 15000;
  const FIREBASE_MIRROR_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const FIREBASE_MANUAL_BACKUP_COOLDOWN_MS = 60 * 60 * 1000;
  const FIREBASE_AUTO_BACKUP_REASON = 'auto-midnight';
  const LIST_SYNC_DEBOUNCE_MS = 500;
  const LIST_DELETE_SYNC_DEBOUNCE_MS = 15000;
  const SYNC_IDLE_PAUSE_MS = 5 * 60 * 1000;
  const SYNC_HIDDEN_PAUSE_MS = 60 * 1000;
  const SYNC_PAUSE_RECHECK_MS = 30000;
  const CLOUD_DRIFT_REPAIR_COOLDOWN_MS = 10 * 60 * 1000;
  const LIST_SYNC_CURSOR_META_KEY = 'lastListSyncCursorMs';
  const CHAT_SYNC_CURSOR_META_KEY = 'lastChatSyncCursorMs';
  const LIST_SYNC_MIGRATED_META_KEY = 'sectorMigrationCompletedAtMs';
  const LIST_SYNC_ONE_TIME_RECOVERY_META_KEY = 'oneTimeRecoveryPullCompletedAtMs';
  const ONE_TIME_RECOVERY_MAX_PAGES = 8;
  const SYNC_USER_STATE_META_KEY = 'userSyncState';
  const SYNC_QUARANTINE_DIAGNOSTICS_META_KEY = 'syncQuarantineDiagnostics';
  const SYNC_TIMESTAMP_CLAMP_WARNING_META_KEY = 'timestampClampWarningAtMs';
  const SYNC_TIMESTAMP_SKEW_DETECTED_META_KEY = 'timestampSkewDetectedAtMs';
  const SYNC_FUTURE_TIME_WINDOW_MS = 10 * 60 * 1000;
  const SYNC_PENDING_DIAGNOSTIC_LIMIT = 20;
  const SYNC_MAX_ITEM_KEY_LENGTH = 255;
  const SYNC_CHAT_MAX_TEXT_LENGTH = 2000;

  const SYNC_ENABLED_KEY = 'bilm-sync-enabled';
  const SYNC_META_KEY = 'bilm-sync-meta';
  const SYNC_DEVICE_ID_KEY = 'bilm-sync-device-id';
  const THEME_SETTINGS_KEY = 'bilm-theme-settings';
  const INCOGNITO_BACKUP_KEY = 'bilm-incognito-backup';
  const INCOGNITO_SEARCH_MAP_KEY = 'bilm-incognito-search-map';
  const DEBUG_ISSUE_LOCAL_KEY = 'debug-local-issue';
  const MERGEABLE_LIST_KEYS = new Set([
    'bilm-favorites',
    'bilm-watch-later',
    'bilm-continue-watching',
    'bilm-watch-history',
    'bilm-search-history',
    'bilm-shared-chat',
    'bilm-history-movies',
    'bilm-history-tv'
  ]);
  const BACKUP_LOCAL_ALLOWLIST = [
    /^bilm-/,
    /^theme-/
  ];
  const BACKUP_SESSION_ALLOWLIST = [
    /^bilm-/
  ];
  const BACKUP_EXCLUDED_STORAGE_KEY_PATTERNS = [
    /^tmdb-/i,
    /^debug-/i
  ];
  const FIRESTORE_MIRROR_MAX_BYTES = 900000;
  const FIRESTORE_FORBIDDEN_KEY_PATTERN = /[~*/\[\]]/;
  const LOCAL_ONLY_LOCAL_STORAGE_KEYS = new Set([
    'bilm-global-message-dismissed-migrating-data'
  ]);
  const LOCAL_ONLY_SYNC_EXCLUDED_KEYS = new Set([
    INCOGNITO_BACKUP_KEY,
    INCOGNITO_SEARCH_MAP_KEY,
    DEBUG_ISSUE_LOCAL_KEY
  ]);
  const LIST_KEY_TO_SECTOR_KEY = Object.freeze({
    'bilm-favorites': 'favorites',
    'bilm-watch-later': 'watch_later',
    'bilm-continue-watching': 'continue_watching',
    'bilm-watch-history': 'watch_history',
    'bilm-search-history': 'search_history',
    'bilm-shared-chat': 'chat_messages',
    'bilm-history-movies': 'watch_history',
    'bilm-history-tv': 'watch_history'
  });
  const SECTOR_KEY_TO_LIST_KEY = Object.freeze({
    favorites: 'bilm-favorites',
    watch_later: 'bilm-watch-later',
    continue_watching: 'bilm-continue-watching',
    watch_history: 'bilm-watch-history',
    search_history: 'bilm-search-history',
    chat_messages: 'bilm-shared-chat'
  });
  const LIST_MAX_ITEMS_BY_KEY = Object.freeze({
    'bilm-shared-chat': 20
  });
  const DEFAULT_LIST_MAX_ITEMS = 120;
  const EXTRA_SYNC_SECTOR_KEYS = Object.freeze({
    settings_profile: 'settings_profile',
    playback_notes: 'playback_notes',
    tv_progress: 'tv_progress',
    ui_prefs: 'ui_prefs'
  });
  const SECTOR_PAYLOAD_LIMITS = Object.freeze({
    default: 12000,
    [EXTRA_SYNC_SECTOR_KEYS.settings_profile]: 16000,
    [EXTRA_SYNC_SECTOR_KEYS.playback_notes]: 24000,
    [EXTRA_SYNC_SECTOR_KEYS.tv_progress]: 8000,
    [EXTRA_SYNC_SECTOR_KEYS.ui_prefs]: 6000
  });
  const STORAGE_KEY_TO_SECTOR_CONFIG = Object.freeze({
    'bilm-theme-settings': { sectorKey: EXTRA_SYNC_SECTOR_KEYS.settings_profile, itemKey: 'theme_settings' },
    'bilm-playback-note': { sectorKey: EXTRA_SYNC_SECTOR_KEYS.playback_notes, itemKey: 'playback_note' },
    'bilm-history-page-prefs': { sectorKey: EXTRA_SYNC_SECTOR_KEYS.ui_prefs, itemKey: 'history_page_prefs' },
    bilmDisableLoading: { sectorKey: EXTRA_SYNC_SECTOR_KEYS.ui_prefs, itemKey: 'disable_loading' }
  });
  const STORAGE_KEY_PREFIX_TO_SECTOR_CONFIG = Object.freeze([
    { prefix: 'bilm-tv-progress-', sectorKey: EXTRA_SYNC_SECTOR_KEYS.tv_progress, itemKeyFromKey: (key) => key },
    { prefix: 'theme-', sectorKey: EXTRA_SYNC_SECTOR_KEYS.settings_profile, itemKeyFromKey: (key) => key }
  ]);
  const DEVICE_LOCAL_STORAGE_KEYS = new Set([
    SYNC_ENABLED_KEY,
    TRANSFER_API_DISABLE_KEY,
    'bilm-clear-local-on-logout'
  ]);
  const ALL_PULL_SECTOR_KEYS = Object.freeze([
    ...new Set([
      ...Object.values(LIST_KEY_TO_SECTOR_KEY),
      ...Object.values(EXTRA_SYNC_SECTOR_KEYS)
    ])
  ]);
  let lastAppliedCloudSignature = '';
  const pendingListOperations = new Map();
  const pendingSectorOperations = new Map();
  let lastChatSyncError = null;
  let lastChatSyncPullAt = 0;
  const syncIssueSubscribers = new Set();
  const listSyncAppliedSubscribers = new Set();
  let listSyncRetryTimer = null;
  let listSyncRetryDelayMs = 0;
  let syncActivityBindingsInstalled = false;
  let syncPauseRecheckTimer = null;
  let oneTimeRecoveryPromise = null;
  let lastUserActivityAt = Date.now();
  let hiddenSinceAt = document.visibilityState === 'hidden' ? Date.now() : 0;
  const handledTimestampClampScopes = new Set();

  function readJsonArray(raw) {
    try {
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function recordSyncActivity() {
    lastUserActivityAt = Date.now();
    if (document.visibilityState !== 'hidden') {
      hiddenSinceAt = 0;
    }
  }

  function withMutationSuppressed(task) {
    externalMutationSuppressionDepth += 1;
    let result;
    try {
      result = typeof task === 'function' ? task() : undefined;
    } catch (error) {
      externalMutationSuppressionDepth = Math.max(0, externalMutationSuppressionDepth - 1);
      throw error;
    }

    if (result && typeof result.finally === 'function') {
      return result.finally(() => {
        externalMutationSuppressionDepth = Math.max(0, externalMutationSuppressionDepth - 1);
      });
    }

    externalMutationSuppressionDepth = Math.max(0, externalMutationSuppressionDepth - 1);
    return result;
  }

  function isMutationHookSuppressed() {
    return suppressMutationHook || externalMutationSuppressionDepth > 0;
  }

  function readThemeSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(THEME_SETTINGS_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function isIncognitoSyncPaused() {
    return readThemeSettings()?.incognito === true;
  }

  function buildIncognitoPausedError(action = 'cloud sync') {
    const error = new Error(`Cannot ${action} while incognito is enabled on this device.`);
    error.code = 'incognito_sync_paused';
    error.retryable = true;
    return error;
  }

  function assertIncognitoSyncAllowed(action = 'cloud sync') {
    if (isIncognitoSyncPaused()) {
      throw buildIncognitoPausedError(action);
    }
  }

  function isSyncTemporarilyPaused() {
    if (isIncognitoSyncPaused()) return true;
    const now = Date.now();
    const isIdle = now - lastUserActivityAt >= SYNC_IDLE_PAUSE_MS;
    const hiddenTooLong = document.visibilityState === 'hidden'
      && hiddenSinceAt > 0
      && (now - hiddenSinceAt) >= SYNC_HIDDEN_PAUSE_MS;
    return isIdle || hiddenTooLong;
  }

  function clearSyncPauseRecheckTimer() {
    if (!syncPauseRecheckTimer) return;
    window.clearTimeout(syncPauseRecheckTimer);
    syncPauseRecheckTimer = null;
  }

  function scheduleSyncPauseRecheck() {
    if (syncPauseRecheckTimer) return;
    syncPauseRecheckTimer = window.setTimeout(() => {
      syncPauseRecheckTimer = null;
      if (!isSyncEnabled() || !auth?.currentUser) return;
      if (isSyncTemporarilyPaused()) {
        scheduleSyncPauseRecheck();
        return;
      }
      syncListsFromCloudNow().catch((error) => {
        console.warn('Paused sync resume pull failed:', error);
      });
      flushPendingListOperationsToCloud('activity-resume').catch((error) => {
        console.warn('Paused sync resume flush failed:', error);
      });
    }, SYNC_PAUSE_RECHECK_MS);
  }

  function ensureSyncActivityBindings() {
    if (syncActivityBindingsInstalled) return;
    syncActivityBindingsInstalled = true;
    const onActivity = () => {
      const wasPaused = isSyncTemporarilyPaused();
      recordSyncActivity();
      if (!wasPaused || isSyncTemporarilyPaused()) return;
      clearSyncPauseRecheckTimer();
      if (!isSyncEnabled() || !auth?.currentUser) return;
      syncListsFromCloudNow().catch((error) => {
        console.warn('Activity resume pull failed:', error);
      });
      flushPendingListOperationsToCloud('activity-resume').catch((error) => {
        console.warn('Activity resume flush failed:', error);
      });
    };

    ['pointermove', 'pointerdown', 'keydown', 'touchstart', 'scroll'].forEach((eventName) => {
      window.addEventListener(eventName, onActivity, { passive: true });
    });
    window.addEventListener('focus', onActivity);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        hiddenSinceAt = Date.now();
        scheduleSyncPauseRecheck();
        return;
      }
      onActivity();
    });
  }

  function getListItemKey(item) {
    if (!item || typeof item !== 'object') return '';
    const explicitKey = String(item.key || '').trim();
    if (explicitKey) return explicitKey;

    const chatId = String(item.id || '').trim();
    if (chatId) return `chat:${chatId}`;

    const chatText = String(item.text || '').trim().toLowerCase();
    if (chatText) {
      const chatCreatedAt = Number(item.createdAtMs || item.updatedAt || item.timestamp || 0) || 0;
      return `chat:${chatCreatedAt}:${chatText}`;
    }

    const normalizedQuery = String(item.query || '').trim().toLowerCase();
    if (normalizedQuery) return `search:${normalizedQuery}`;

    const mediaType = String(item.type || 'media').trim().toLowerCase();
    const mediaId = String(item.tmdbId || item.id || '').trim();
    if (mediaId) return `${mediaType}:${mediaId}`;

    const titleFallback = String(item.title || '').trim().toLowerCase();
    if (titleFallback) return `${mediaType}:${titleFallback}`;

    return '';
  }

  function getItemUpdatedAt(item) {
    return Number(item?.updatedAt || item?.createdAtMs || item?.timestamp || item?.savedAt || 0) || 0;
  }

  function parseSyncTimestampMs(value, fallback = 0) {
    const parsed = Number(value || 0);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
  }

  function getFutureTimestampUpperBound(nowMs = Date.now()) {
    return nowMs + SYNC_FUTURE_TIME_WINDOW_MS;
  }

  function getSyncWarningScope(user = auth?.currentUser || currentUser) {
    const userId = getSyncScopeUserId(user);
    if (userId) return `user:${userId}`;
    return `device:${getOrCreateDeviceId()}`;
  }

  function hasTimestampClampWarning(user = auth?.currentUser || currentUser) {
    const warningAtMs = parseSyncTimestampMs(getScopedSyncMetaValue(SYNC_TIMESTAMP_CLAMP_WARNING_META_KEY, 0, user), 0);
    return warningAtMs > 0;
  }

  function markTimestampClampWarning(user = auth?.currentUser || currentUser, atMs = Date.now()) {
    const warningAtMs = parseSyncTimestampMs(atMs, Date.now());
    setScopedSyncMetaValue(SYNC_TIMESTAMP_CLAMP_WARNING_META_KEY, warningAtMs, user);
    return warningAtMs;
  }

  function markTimestampSkewDetected(user = auth?.currentUser || currentUser, atMs = Date.now()) {
    const detectedAtMs = parseSyncTimestampMs(atMs, Date.now());
    const userId = getSyncScopeUserId(user);
    if (userId) {
      writeScopedSyncState({
        [LIST_SYNC_ONE_TIME_RECOVERY_META_KEY]: 0,
        [SYNC_TIMESTAMP_SKEW_DETECTED_META_KEY]: detectedAtMs
      }, user);
      return detectedAtMs;
    }
    writeSyncMeta({
      [LIST_SYNC_ONE_TIME_RECOVERY_META_KEY]: 0,
      [SYNC_TIMESTAMP_SKEW_DETECTED_META_KEY]: detectedAtMs
    });
    return detectedAtMs;
  }

  function handleTimestampClamp({
    context = 'sync-timestamp',
    originalMs = 0,
    clampedMs = 0
  } = {}) {
    const user = auth?.currentUser || currentUser || null;
    const scopeKey = getSyncWarningScope(user);
    if (!handledTimestampClampScopes.has(scopeKey)) {
      handledTimestampClampScopes.add(scopeKey);
      markTimestampSkewDetected(user, Date.now());
    }

    if (!hasTimestampClampWarning(user)) {
      markTimestampClampWarning(user, Date.now());
      emitSyncIssue({
        scope: 'sync',
        code: 'timestamp_clamped',
        message: 'Detected device clock skew. Sync timestamps were adjusted and a recovery pull will run.',
        retryable: true
      });
    }

    console.warn('[sync] clamped future timestamp', {
      context,
      originalMs,
      clampedMs
    });
  }

  function normalizeOperationUpdatedAt(value, fallback = Date.now(), options = {}) {
    const parsed = Number(value || 0);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    const normalized = Math.floor(parsed);
    const maxFutureAtMs = getFutureTimestampUpperBound(Date.now());
    if (normalized > maxFutureAtMs) {
      const clamped = maxFutureAtMs;
      if (options?.onClamp !== false) {
        handleTimestampClamp({
          context: String(options?.context || 'sync-timestamp').trim() || 'sync-timestamp',
          originalMs: normalized,
          clampedMs: clamped
        });
      }
      return clamped;
    }
    return normalized;
  }

  function normalizeListOperationPayload(payload, updatedAtMs) {
    if (!payload || typeof payload !== 'object') return null;
    const normalized = { ...payload };
    if (!getItemUpdatedAt(normalized)) {
      normalized.updatedAt = updatedAtMs;
    }
    return normalized;
  }

  function listKeyToSectorKey(listKey) {
    const normalized = String(listKey || '').trim().toLowerCase();
    return LIST_KEY_TO_SECTOR_KEY[normalized] || '';
  }

  function sectorKeyToListKey(sectorKey) {
    const normalized = String(sectorKey || '').trim().toLowerCase();
    return SECTOR_KEY_TO_LIST_KEY[normalized] || '';
  }

  function resolveStorageSectorConfig(storageKey) {
    const key = String(storageKey || '').trim();
    if (!key) return null;
    if (DEVICE_LOCAL_STORAGE_KEYS.has(key)) return null;
    if (key === SYNC_META_KEY || key === SYNC_DEVICE_ID_KEY) return null;
    const exact = STORAGE_KEY_TO_SECTOR_CONFIG[key];
    if (exact) return { ...exact };
    for (const rule of STORAGE_KEY_PREFIX_TO_SECTOR_CONFIG) {
      if (key.startsWith(rule.prefix)) {
        const itemKey = typeof rule.itemKeyFromKey === 'function' ? rule.itemKeyFromKey(key) : key;
        return {
          sectorKey: rule.sectorKey,
          itemKey: String(itemKey || '').trim()
        };
      }
    }
    return null;
  }

  function createOperationId(prefix = 'op') {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function toSectorOperation(operation) {
    const directSectorKey = String(operation?.sectorKey || '').trim().toLowerCase();
    const listKey = String(operation?.listKey || '').trim();
    const sectorKey = directSectorKey || listKeyToSectorKey(listKey);
    if (!sectorKey) return null;
    const itemKey = String(operation?.itemKey || '').trim();
    if (!itemKey) return null;
    const normalized = {
      sectorKey,
      itemKey,
      deleted: operation?.deleted === true,
      updatedAtMs: normalizeOperationUpdatedAt(operation?.updatedAtMs, Date.now(), { context: 'sync-op:to-sector' }),
      opId: String(operation?.opId || '').trim() || createOperationId('sec')
    };
    if (!normalized.deleted) {
      const payload = sectorKeyToListKey(sectorKey)
        ? normalizeListOperationPayload(operation?.payload, normalized.updatedAtMs)
        : (operation?.payload && typeof operation.payload === 'object' && !Array.isArray(operation.payload)
          ? operation.payload
          : null);
      if (!payload) return null;
      normalized.payload = payload;
    }
    return normalized;
  }

  function toListOperation(operation) {
    const sectorKey = String(operation?.sectorKey || '').trim();
    const listKey = sectorKeyToListKey(sectorKey);
    if (!listKey) return null;
    const itemKey = String(operation?.itemKey || '').trim();
    if (!itemKey) return null;
    const normalized = {
      listKey,
      itemKey,
      deleted: operation?.deleted === true,
      updatedAtMs: normalizeOperationUpdatedAt(operation?.updatedAtMs, 0, { context: 'sync-op:to-list' })
    };
    if (!normalized.deleted) {
      const payload = normalizeListOperationPayload(operation?.payload, normalized.updatedAtMs);
      if (!payload) return null;
      normalized.payload = payload;
    }
    return normalized;
  }

  function toStorageSectorOperation(operation) {
    const sectorKey = String(operation?.sectorKey || '').trim().toLowerCase();
    if (!Object.values(EXTRA_SYNC_SECTOR_KEYS).includes(sectorKey)) return null;
    const itemKey = String(operation?.itemKey || '').trim();
    if (!itemKey) return null;
    const storageKey = String(operation?.payload?.storageKey || '').trim();
    const value = operation?.payload?.value;
    const deleted = operation?.deleted === true;
    if (!deleted && !storageKey) return null;
    return {
      sectorKey,
      itemKey,
      deleted,
      updatedAtMs: normalizeOperationUpdatedAt(operation?.updatedAtMs, 0, { context: 'sync-op:to-storage' }),
      storageKey: deleted ? itemKey : storageKey,
      value: deleted ? null : (typeof value === 'string' ? value : JSON.stringify(value ?? ''))
    };
  }

  async function parseTransferError(response) {
    const status = Number(response?.status || 0) || 0;
    const fallback = await response.text().catch(() => '');
    const parsed = safeParse(fallback, null);
    const error = String(parsed?.error || '').trim() || `request_failed_${status || 'unknown'}`;
    const code = String(parsed?.code || parsed?.error || '').trim() || error;
    const message = String(parsed?.message || fallback || `Data API request failed (${status || 'unknown'})`).trim();
    const retryable = parsed?.retryable === true || status === 429 || status >= 500;
    const requestId = String(parsed?.requestId || response.headers?.get?.('x-request-id') || '').trim() || null;
    const wrapped = new Error(message);
    wrapped.status = status;
    wrapped.error = error;
    wrapped.code = code;
    wrapped.retryable = retryable;
    wrapped.requestId = requestId;
    return wrapped;
  }

  function logTransferFailure(scope, error, context = {}) {
    const status = Number(error?.status || 0) || null;
    const code = String(error?.code || error?.error || 'sync_error').trim();
    const requestId = String(error?.requestId || '').trim() || null;
    console.error(`[sync:${scope}] ${code}${status ? ` (${status})` : ''}: ${error?.message || 'request failed'}`, {
      requestId,
      retryable: error?.retryable !== false,
      ...context
    });
  }

  function emitSyncIssue(issue = {}) {
    const normalized = {
      scope: String(issue?.scope || 'sync').trim() || 'sync',
      listKey: String(issue?.listKey || '').trim() || null,
      sectorKey: String(issue?.sectorKey || '').trim() || null,
      code: String(issue?.code || '').trim() || 'sync_error',
      message: String(issue?.message || '').trim() || 'Sync request failed.',
      retryable: issue?.retryable !== false,
      status: Number(issue?.status || 0) || null,
      requestId: String(issue?.requestId || '').trim() || null,
      atMs: Date.now()
    };
    syncIssueSubscribers.forEach((callback) => {
      try {
        callback(normalized);
      } catch (error) {
        console.warn('Sync issue subscriber failed:', error);
      }
    });
  }

  function emitListSyncApplied(payload = {}) {
    listSyncAppliedSubscribers.forEach((callback) => {
      try {
        callback(payload);
      } catch (error) {
        console.warn('List sync apply subscriber failed:', error);
      }
    });
  }

  function emitSyncAppliedEvent(detail = {}) {
    try {
      const listKeys = Array.isArray(detail?.listKeys)
        ? [...new Set(detail.listKeys.map((key) => String(key || '').trim()).filter(Boolean))]
        : [];
      const storageKeys = Array.isArray(detail?.storageKeys)
        ? [...new Set(detail.storageKeys.map((key) => String(key || '').trim()).filter(Boolean))]
        : [];
      const source = String(detail?.source || 'sync').trim() || 'sync';
      const atMs = normalizeOperationUpdatedAt(detail?.atMs, Date.now());
      const reason = String(detail?.reason || '').trim() || null;
      window.dispatchEvent(new CustomEvent('bilm:sync-applied', {
        detail: {
          source,
          atMs,
          reason,
          listKeys,
          storageKeys
        }
      }));
    } catch (error) {
      console.warn('Sync applied event dispatch failed:', error);
    }
  }

  function buildListMapFromRaw(raw) {
    const list = readJsonArray(raw);
    const map = new Map();
    list.forEach((entry) => {
      const itemKey = getListItemKey(entry);
      if (!itemKey) return;
      map.set(itemKey, entry);
    });
    return map;
  }

  function buildListOperationsFromRaw(storageKey, beforeRaw, afterRaw, nowMs = Date.now()) {
    if (!MERGEABLE_LIST_KEYS.has(storageKey)) return [];
    const beforeMap = buildListMapFromRaw(beforeRaw);
    const afterMap = buildListMapFromRaw(afterRaw);
    const operations = [];

    afterMap.forEach((entry, itemKey) => {
      const beforeEntry = beforeMap.get(itemKey);
      const updatedAtMs = normalizeOperationUpdatedAt(getItemUpdatedAt(entry), nowMs);
      const beforeUpdatedAtMs = normalizeOperationUpdatedAt(getItemUpdatedAt(beforeEntry), 0);
      if (!beforeEntry || beforeUpdatedAtMs !== updatedAtMs || JSON.stringify(beforeEntry) !== JSON.stringify(entry)) {
        const payload = normalizeListOperationPayload(entry, updatedAtMs);
        if (!payload) return;
        operations.push({
          listKey: storageKey,
          itemKey,
          deleted: false,
          updatedAtMs,
          payload
        });
      }
    });

    beforeMap.forEach((entry, itemKey) => {
      if (afterMap.has(itemKey)) return;
      const deletedAtMs = normalizeOperationUpdatedAt(Math.max(nowMs, getItemUpdatedAt(entry)), nowMs);
      operations.push({
        listKey: storageKey,
        itemKey,
        deleted: true,
        updatedAtMs: deletedAtMs
      });
    });

    return operations;
  }

  function buildStorageSectorOperationsFromRaw(storageKey, beforeRaw, afterRaw, nowMs = Date.now()) {
    const config = resolveStorageSectorConfig(storageKey);
    if (!config) return [];
    const beforeValue = typeof beforeRaw === 'string' ? beforeRaw : null;
    const afterValue = typeof afterRaw === 'string' ? afterRaw : null;
    if (beforeValue === afterValue) return [];
    return [{
      sectorKey: config.sectorKey,
      itemKey: config.itemKey,
      deleted: afterValue === null,
      updatedAtMs: normalizeOperationUpdatedAt(nowMs),
      payload: afterValue === null
        ? undefined
        : {
          storageKey,
          value: afterValue
        }
    }];
  }

  function enqueueListOperations(operations = []) {
    operations.forEach((operation) => {
      if (!operation || !MERGEABLE_LIST_KEYS.has(operation.listKey)) return;
      const itemKey = String(operation.itemKey || '').trim();
      if (!itemKey) return;
      const normalized = {
        listKey: operation.listKey,
        itemKey,
        deleted: operation.deleted === true,
        updatedAtMs: normalizeOperationUpdatedAt(operation.updatedAtMs),
        opId: String(operation?.opId || '').trim() || createOperationId('lst'),
        payload: operation.deleted === true ? undefined : normalizeListOperationPayload(operation.payload, operation.updatedAtMs)
      };
      if (!normalized.deleted && !normalized.payload) return;

      const queueKey = `${normalized.listKey}|${normalized.itemKey}`;
      const current = pendingListOperations.get(queueKey);
      if (!current || normalized.updatedAtMs >= normalizeOperationUpdatedAt(current.updatedAtMs, 0)) {
        pendingListOperations.set(queueKey, normalized);
      }
    });
  }

  function enqueueSectorOperations(operations = []) {
    operations.forEach((operation) => {
      const normalized = toSectorOperation(operation);
      if (!normalized) return;
      if (!Object.values(EXTRA_SYNC_SECTOR_KEYS).includes(normalized.sectorKey)) return;
      const queueKey = `${normalized.sectorKey}|${normalized.itemKey}`;
      const current = pendingSectorOperations.get(queueKey);
      if (!current || normalized.updatedAtMs >= normalizeOperationUpdatedAt(current.updatedAtMs, 0)) {
        pendingSectorOperations.set(queueKey, normalized);
      }
    });
  }

  function getListSyncCursorMs() {
    return getScopedSyncMetaNumber(LIST_SYNC_CURSOR_META_KEY, 0);
  }

  function setListSyncCursorMs(nextCursorMs) {
    return setScopedSyncMetaNumber(LIST_SYNC_CURSOR_META_KEY, nextCursorMs);
  }

  function getChatSyncCursorMs() {
    return getScopedSyncMetaNumber(CHAT_SYNC_CURSOR_META_KEY, 0);
  }

  function setChatSyncCursorMs(nextCursorMs) {
    return setScopedSyncMetaNumber(CHAT_SYNC_CURSOR_META_KEY, nextCursorMs);
  }

  function getSectorMigrationCompletedAtMs() {
    return getScopedSyncMetaNumber(LIST_SYNC_MIGRATED_META_KEY, 0);
  }

  function setSectorMigrationCompletedAtMs(nextValue) {
    return setScopedSyncMetaNumber(LIST_SYNC_MIGRATED_META_KEY, nextValue);
  }

  function getListSyncOneTimeRecoveryCompletedAtMs() {
    return getScopedSyncMetaNumber(LIST_SYNC_ONE_TIME_RECOVERY_META_KEY, 0);
  }

  function setListSyncOneTimeRecoveryCompletedAtMs(nextValue = Date.now()) {
    return setScopedSyncMetaNumber(LIST_SYNC_ONE_TIME_RECOVERY_META_KEY, nextValue);
  }

  function hasSectorMigrationCompleted() {
    return getSectorMigrationCompletedAtMs() > 0;
  }

  function listOperationsFromSnapshot(snapshot, nowMs = Date.now()) {
    if (!snapshot || snapshot.schema !== 'bilm-backup-v1') return [];
    const operations = [];
    MERGEABLE_LIST_KEYS.forEach((listKey) => {
      const sourceRaw = snapshot?.localStorage?.[listKey];
      const snapshotList = readJsonArray(sourceRaw);
      if (!snapshotList.length) return;
      const built = buildListOperationsFromRaw(listKey, '[]', JSON.stringify(snapshotList), nowMs);
      operations.push(...built);
    });
    return operations;
  }

  function storageSectorOperationsFromSnapshot(snapshot, nowMs = Date.now()) {
    if (!snapshot || snapshot.schema !== 'bilm-backup-v1') return [];
    const operations = [];
    const localEntries = Object.entries(snapshot?.localStorage || {});
    localEntries.forEach(([storageKey, rawValue]) => {
      operations.push(...buildStorageSectorOperationsFromRaw(storageKey, null, rawValue, nowMs));
    });
    return operations;
  }

  function sectorBootstrapOperationsFromSnapshot(snapshot, nowMs = Date.now()) {
    return [
      ...listOperationsFromSnapshot(snapshot, nowMs),
      ...storageSectorOperationsFromSnapshot(snapshot, nowMs)
    ];
  }

  async function readFirebaseBackupSnapshot(user) {
    if (!modules?.getDoc || !modules?.doc || !firestore || !user?.uid) return null;
    try {
      const docSnap = await modules.getDoc(modules.doc(firestore, 'users', user.uid));
      const data = docSnap.data() || {};
      const snapshot = data.cloudBackup?.snapshot || null;
      return snapshot && snapshot.schema === 'bilm-backup-v1' ? snapshot : null;
    } catch (error) {
      console.warn('Firebase backup snapshot read failed:', error);
      return null;
    }
  }

  async function ensureSectorBootstrapForUser(user, options = {}) {
    const forceCheck = options?.forceCheck === true;
    if (!user || transferApiDisabled || !isSyncEnabled()) return false;
    const localMigrated = hasSectorMigrationCompleted();
    if (localMigrated && sectorBootstrapCheckedThisSession && !forceCheck) return false;
    if (sectorBootstrapCheckedThisSession && !forceCheck) return false;
    sectorBootstrapCheckedThisSession = true;

    const userId = getTransferUserId(user);
    let existingState = null;
    try {
      const seedPull = await pullListOperationsFromTransferApi(user, userId, 0, 1);
      existingState = seedPull?.state || null;
      if (Number(existingState?.migratedAtMs || 0) > 0 || (seedPull?.operations?.length || 0) > 0) {
        setSectorMigrationCompletedAtMs(Number(existingState?.migratedAtMs || Date.now()) || Date.now());
        return false;
      }
    } catch (error) {
      console.warn('Sector bootstrap preflight failed:', error);
      return false;
    }

    const nowMs = Date.now();
    let migrationSource = 'local_fallback';
    let operations = [];
    try {
      const transferSnapshot = await loadSnapshotFromTransferApi(user, userId);
      const firebaseSnapshot = await readFirebaseBackupSnapshot(user);
      const selected = choosePreferredCloudSnapshot(transferSnapshot, firebaseSnapshot);
      if (selected.snapshot) {
        operations = sectorBootstrapOperationsFromSnapshot(selected.snapshot, nowMs);
        migrationSource = selected.source === 'data-api' ? 'd1_snapshot' : 'firebase_snapshot';
      }
    } catch (error) {
      console.warn('Cloud snapshot bootstrap source unavailable, using local fallback:', error);
    }

    if (!operations.length) {
      operations = sectorBootstrapOperationsFromSnapshot(collectBackupData(), nowMs);
      migrationSource = 'local_fallback';
    }

    try {
      const response = await bootstrapSectorOperationsToTransferApi(user, userId, operations, migrationSource);
      if (response?.ok) {
        setSectorMigrationCompletedAtMs(Number(response?.state?.migratedAtMs || Date.now()) || Date.now());
        if (Number(response?.cursorMs || 0) > 0) setListSyncCursorMs(response.cursorMs);
        return true;
      }
    } catch (error) {
      emitSyncIssue({
        scope: 'bootstrap',
        code: error?.code || error?.error || 'sector_bootstrap_failed',
        message: error?.message || 'Sector bootstrap failed.',
        status: error?.status || null,
        retryable: error?.retryable !== false,
        requestId: error?.requestId || null
      });
      console.warn('Sector bootstrap failed:', error);
    }
    return false;
  }

  function mergeTombstoneMaps(...maps) {
    const result = {};
    maps.forEach((map) => {
      if (!map || typeof map !== 'object') return;
      Object.entries(map).forEach(([storageKey, value]) => {
        if (!value || typeof value !== 'object') return;
        if (!result[storageKey]) result[storageKey] = {};
        Object.entries(value).forEach(([itemKey, timestamp]) => {
          const nextTs = Number(timestamp || 0) || 0;
          const prevTs = Number(result[storageKey][itemKey] || 0) || 0;
          if (nextTs > prevTs) {
            result[storageKey][itemKey] = nextTs;
          }
        });
      });
    });
    return result;
  }

  function mergeSnapshots(baseSnapshot, incomingSnapshot) {
    const base = baseSnapshot && typeof baseSnapshot === 'object' ? baseSnapshot : null;
    const incoming = incomingSnapshot && typeof incomingSnapshot === 'object' ? incomingSnapshot : null;
    if (!base) return incoming;
    if (!incoming) return base;

    const baseUpdatedAt = Number(base?.meta?.updatedAtMs || 0) || 0;
    const incomingUpdatedAt = Number(incoming?.meta?.updatedAtMs || 0) || 0;
    const newest = incomingUpdatedAt >= baseUpdatedAt ? incoming : base;
    const oldest = newest === incoming ? base : incoming;

    const merged = {
      ...oldest,
      ...newest,
      localStorage: {
        ...(oldest.localStorage || {}),
        ...(newest.localStorage || {})
      },
      sessionStorage: {
        ...(oldest.sessionStorage || {}),
        ...(newest.sessionStorage || {})
      },
      meta: {
        ...(oldest.meta || {}),
        ...(newest.meta || {})
      }
    };

    const tombstones = mergeTombstoneMaps(base?.meta?.listTombstones, incoming?.meta?.listTombstones);

    MERGEABLE_LIST_KEYS.forEach((storageKey) => {
      const baseList = readJsonArray(base?.localStorage?.[storageKey]);
      const incomingList = readJsonArray(incoming?.localStorage?.[storageKey]);
      const byKey = new Map();

      [...baseList, ...incomingList].forEach((item) => {
        const itemKey = getListItemKey(item);
        if (!itemKey) return;
        const existing = byKey.get(itemKey);
        if (!existing || getItemUpdatedAt(item) >= getItemUpdatedAt(existing)) {
          byKey.set(itemKey, item);
        }
      });

      const keyedTombstones = tombstones[storageKey] || {};
      const maxItems = Number(LIST_MAX_ITEMS_BY_KEY[storageKey] || DEFAULT_LIST_MAX_ITEMS) || DEFAULT_LIST_MAX_ITEMS;
      const filtered = [...byKey.entries()]
        .filter(([itemKey, item]) => (Number(keyedTombstones[itemKey] || 0) || 0) < getItemUpdatedAt(item))
        .sort((a, b) => getItemUpdatedAt(b[1]) - getItemUpdatedAt(a[1]))
        .map(([, item]) => item)
        .slice(0, maxItems);

      merged.localStorage[storageKey] = JSON.stringify(filtered);
    });

    merged.meta = {
      ...(merged.meta || {}),
      listTombstones: tombstones
    };

    return merged;
  }

  function safeParse(raw, fallback = null) {
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function getOrCreateDeviceId() {
    const existing = String(localStorage.getItem(SYNC_DEVICE_ID_KEY) || '').trim();
    if (existing) return existing;
    const next = `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    suppressMutationHook = true;
    try {
      localStorage.setItem(SYNC_DEVICE_ID_KEY, next);
    } finally {
      suppressMutationHook = false;
    }
    return next;
  }

  function readSyncMeta() {
    return safeParse(localStorage.getItem(SYNC_META_KEY), {}) || {};
  }

  function writeSyncMeta(partial = {}) {
    const previous = readSyncMeta();
    const next = {
      deviceId: previous.deviceId || getOrCreateDeviceId(),
      ...previous,
      ...partial
    };
    suppressMutationHook = true;
    try {
      localStorage.setItem(SYNC_META_KEY, JSON.stringify(next));
    } finally {
      suppressMutationHook = false;
    }
    return next;
  }

  function normalizeSyncScopeUserId(value) {
    return String(value || '').trim().replace(/^user-/i, '');
  }

  function getSyncScopeUserId(user = auth?.currentUser || currentUser) {
    const normalized = normalizeSyncScopeUserId(user?.uid);
    return normalized || '';
  }

  function readScopedSyncState(user = auth?.currentUser || currentUser) {
    const userId = getSyncScopeUserId(user);
    if (!userId) return { userId: '', state: null };
    const scoped = readSyncMeta()?.[SYNC_USER_STATE_META_KEY];
    if (!scoped || typeof scoped !== 'object' || Array.isArray(scoped)) {
      return { userId, state: null };
    }
    const state = scoped[userId];
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      return { userId, state: null };
    }
    return { userId, state };
  }

  function writeScopedSyncState(partial = {}, user = auth?.currentUser || currentUser) {
    const userId = getSyncScopeUserId(user);
    if (!userId) return null;
    const meta = readSyncMeta();
    const scoped = meta?.[SYNC_USER_STATE_META_KEY];
    const nextScoped = scoped && typeof scoped === 'object' && !Array.isArray(scoped)
      ? { ...scoped }
      : {};
    const previousState = nextScoped[userId] && typeof nextScoped[userId] === 'object' && !Array.isArray(nextScoped[userId])
      ? nextScoped[userId]
      : {};
    const nextState = {
      ...previousState,
      ...partial
    };
    nextScoped[userId] = nextState;
    writeSyncMeta({ [SYNC_USER_STATE_META_KEY]: nextScoped });
    return nextState;
  }

  function getScopedSyncMetaNumber(metaKey, fallback = 0, user = auth?.currentUser || currentUser) {
    const { userId, state } = readScopedSyncState(user);
    if (userId) {
      return normalizeOperationUpdatedAt(state?.[metaKey], fallback, { context: `sync-meta:${metaKey}` });
    }
    const meta = readSyncMeta();
    return normalizeOperationUpdatedAt(meta?.[metaKey], fallback, { context: `sync-meta:${metaKey}` });
  }

  function setScopedSyncMetaNumber(metaKey, nextValue, user = auth?.currentUser || currentUser) {
    const normalizedNext = normalizeOperationUpdatedAt(nextValue, 0, { context: `sync-meta:${metaKey}` });
    if (normalizedNext <= 0) return 0;
    const userId = getSyncScopeUserId(user);
    if (!userId) {
      const current = normalizeOperationUpdatedAt(readSyncMeta()?.[metaKey], 0);
      const next = Math.max(current, normalizedNext);
      writeSyncMeta({ [metaKey]: next });
      return next;
    }
    const current = getScopedSyncMetaNumber(metaKey, 0, user);
    const next = Math.max(current, normalizedNext);
    writeScopedSyncState({ [metaKey]: next }, user);
    return next;
  }

  function getScopedSyncMetaValue(metaKey, fallback = null, user = auth?.currentUser || currentUser) {
    const { userId, state } = readScopedSyncState(user);
    if (userId) {
      return typeof state?.[metaKey] === 'undefined' ? fallback : state[metaKey];
    }
    const meta = readSyncMeta();
    return typeof meta?.[metaKey] === 'undefined' ? fallback : meta[metaKey];
  }

  function setScopedSyncMetaValue(metaKey, value, user = auth?.currentUser || currentUser) {
    const userId = getSyncScopeUserId(user);
    if (!userId) {
      writeSyncMeta({ [metaKey]: value });
      return value;
    }
    writeScopedSyncState({ [metaKey]: value }, user);
    return value;
  }

  function appendSyncQuarantineDiagnostic(record, user = auth?.currentUser || currentUser) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return [];
    const existing = getScopedSyncMetaValue(SYNC_QUARANTINE_DIAGNOSTICS_META_KEY, [], user);
    const history = Array.isArray(existing)
      ? existing.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
      : [];
    const next = [...history, record].slice(-SYNC_PENDING_DIAGNOSTIC_LIMIT);
    setScopedSyncMetaValue(SYNC_QUARANTINE_DIAGNOSTICS_META_KEY, next, user);
    return next;
  }

  function shouldIncludeStorageKey(key, allowlist) {
    return allowlist.some((pattern) => pattern.test(String(key || '')));
  }

  function isBackupStorageKeyExcluded(key) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) return true;
    if (normalizedKey.includes('/') || normalizedKey.includes('\\')) return true;
    if (BACKUP_EXCLUDED_STORAGE_KEY_PATTERNS.some((pattern) => pattern.test(normalizedKey))) return true;
    return false;
  }

  function isSnapshotExcludedStorageKey(key) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) return true;
    if (LOCAL_ONLY_SYNC_EXCLUDED_KEYS.has(normalizedKey)) return true;
    if (normalizedKey.startsWith('debug-')) return true;
    if (normalizedKey.startsWith('bilm-incognito-')) return true;
    return false;
  }

  function isLocalOnlyStorageKey(key) {
    return LOCAL_ONLY_LOCAL_STORAGE_KEYS.has(String(key || ''));
  }

  function captureLocalOnlyStorageState() {
    const captured = {};
    LOCAL_ONLY_LOCAL_STORAGE_KEYS.forEach((key) => {
      const value = localStorage.getItem(key);
      if (value !== null) {
        captured[key] = value;
      }
    });
    return captured;
  }

  function restoreLocalOnlyStorageState(capturedState = {}) {
    Object.entries(capturedState).forEach(([key, value]) => {
      if (typeof value === 'undefined' || value === null) return;
      localStorage.setItem(key, value);
    });
  }

  function readStorage(storage, allowlist = []) {
    return Object.entries(storage).reduce((all, [key, value]) => {
      if (allowlist.length && !shouldIncludeStorageKey(key, allowlist)) {
        return all;
      }
      if (isBackupStorageKeyExcluded(key)) {
        return all;
      }
      if (isSnapshotExcludedStorageKey(key)) {
        return all;
      }
      all[key] = value;
      return all;
    }, {});
  }

  function estimateJsonSizeBytes(value) {
    try {
      const json = JSON.stringify(value ?? null);
      return new TextEncoder().encode(json).byteLength;
    } catch {
      return Number.MAX_SAFE_INTEGER;
    }
  }

  function isFirestoreMapKeySafe(key) {
    const normalized = String(key || '').trim();
    if (!normalized) return false;
    if (normalized.startsWith('__') && normalized.endsWith('__')) return false;
    if (FIRESTORE_FORBIDDEN_KEY_PATTERN.test(normalized)) return false;
    return true;
  }

  function pickEssentialLocalStorageKeysForFirebase(localState = {}) {
    const essential = {};
    MERGEABLE_LIST_KEYS.forEach((storageKey) => {
      if (Object.prototype.hasOwnProperty.call(localState, storageKey)) {
        essential[storageKey] = localState[storageKey];
      }
    });
    Object.keys(STORAGE_KEY_TO_SECTOR_CONFIG).forEach((storageKey) => {
      if (Object.prototype.hasOwnProperty.call(localState, storageKey)) {
        essential[storageKey] = localState[storageKey];
      }
    });
    Object.entries(localState).forEach(([storageKey, value]) => {
      if (Object.prototype.hasOwnProperty.call(essential, storageKey)) return;
      if (storageKey.startsWith('bilm-tv-progress-') || storageKey.startsWith('theme-')) {
        essential[storageKey] = value;
      }
    });
    return essential;
  }

  function buildFirebaseMirrorSnapshot(snapshot) {
    if (!snapshot || snapshot.schema !== 'bilm-backup-v1') return null;

    const sanitizeStorageState = (state = {}) => Object.entries(state || {}).reduce((all, [key, value]) => {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey) return all;
      if (isBackupStorageKeyExcluded(normalizedKey)) return all;
      if (!isFirestoreMapKeySafe(normalizedKey)) return all;
      if (typeof value === 'undefined' || value === null) return all;
      all[normalizedKey] = String(value);
      return all;
    }, {});

    const base = {
      ...snapshot,
      localStorage: sanitizeStorageState(snapshot.localStorage || {}),
      sessionStorage: sanitizeStorageState(snapshot.sessionStorage || {}),
      meta: {
        ...(snapshot?.meta || {}),
        updatedAtMs: normalizeOperationUpdatedAt(snapshot?.meta?.updatedAtMs, Date.now()),
        deviceId: String(snapshot?.meta?.deviceId || getOrCreateDeviceId()).trim() || getOrCreateDeviceId(),
        version: Number(snapshot?.meta?.version || 1) || 1
      }
    };

    if (estimateJsonSizeBytes(base) <= FIRESTORE_MIRROR_MAX_BYTES) {
      return base;
    }

    const trimmed = {
      ...base,
      localStorage: pickEssentialLocalStorageKeysForFirebase(base.localStorage || {}),
      sessionStorage: {}
    };
    if (estimateJsonSizeBytes(trimmed) <= FIRESTORE_MIRROR_MAX_BYTES) {
      return trimmed;
    }
    return null;
  }

  function collectBackupData() {
    const meta = readSyncMeta();
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
    LOCAL_ONLY_LOCAL_STORAGE_KEYS.forEach((key) => {
      delete localState[key];
    });
    return {
      schema: 'bilm-backup-v1',
      exportedAt: new Date().toISOString(),
      origin: location.origin,
      pathname: location.pathname,
      localStorage: localState,
      sessionStorage: sessionState,
      meta: {
        updatedAtMs: Date.now(),
        deviceId: getOrCreateDeviceId(),
        version: 1,
        listTombstones: meta?.listTombstones || {}
      }
    };
  }

  function isSyncEnabled() {
    return localStorage.getItem(SYNC_ENABLED_KEY) !== '0';
  }

  function getLastFirebaseMirrorAtMs(meta = readSyncMeta()) {
    const raw = Number(meta?.lastFirebaseMirrorAtMs || 0);
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  }

  function getLastFirebaseManualBackupAtMs(meta = readSyncMeta()) {
    const raw = Number(meta?.lastFirebaseManualBackupAtMs || 0);
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  }

  function getLastFirebaseAutoBackupAtMs(meta = readSyncMeta()) {
    const raw = Number(meta?.lastFirebaseAutoBackupAtMs || 0);
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  }

  function isFirebaseMirrorDue(nowMs = Date.now(), meta = readSyncMeta()) {
    const lastMirrorAtMs = getLastFirebaseMirrorAtMs(meta);
    if (!lastMirrorAtMs) return true;
    return nowMs - lastMirrorAtMs >= FIREBASE_MIRROR_INTERVAL_MS;
  }

  function getNextManualFirebaseBackupAtMs(meta = readSyncMeta()) {
    const lastManualAtMs = getLastFirebaseManualBackupAtMs(meta);
    if (!lastManualAtMs) return 0;
    return lastManualAtMs + FIREBASE_MANUAL_BACKUP_COOLDOWN_MS;
  }

  function getFirebaseBackupStatus(meta = readSyncMeta()) {
    const nowMs = Date.now();
    const nextManualAtMs = getNextManualFirebaseBackupAtMs(meta);
    return {
      lastMirrorAtMs: getLastFirebaseMirrorAtMs(meta),
      lastMirrorReason: String(meta?.lastFirebaseMirrorReason || '').trim() || null,
      lastMirrorSource: String(meta?.lastFirebaseMirrorSource || '').trim() || null,
      lastMirrorSnapshotSource: String(meta?.lastFirebaseMirrorSnapshotSource || '').trim() || null,
      lastAutoBackupAtMs: getLastFirebaseAutoBackupAtMs(meta),
      lastAutoBackupReason: String(meta?.lastFirebaseAutoBackupReason || '').trim() || null,
      lastAutoBackupSource: String(meta?.lastFirebaseAutoBackupSource || '').trim() || null,
      lastManualBackupAtMs: getLastFirebaseManualBackupAtMs(meta),
      lastManualBackupReason: String(meta?.lastFirebaseManualBackupReason || '').trim() || null,
      lastManualBackupSource: String(meta?.lastFirebaseManualBackupSource || '').trim() || null,
      manualCooldownMs: FIREBASE_MANUAL_BACKUP_COOLDOWN_MS,
      manualBackupAvailable: nextManualAtMs <= 0 || nowMs >= nextManualAtMs,
      nextManualBackupAtMs: nextManualAtMs > nowMs ? nextManualAtMs : 0,
      cadenceText: 'Automatic backup runs daily at 12:00 AM (local time), once every 24 hours.'
    };
  }

  async function writeFirebaseBackupSnapshot({
    reason = 'manual',
    source = 'unknown',
    mode = 'auto',
    respectManualCooldown = false
  } = {}) {
    const user = auth?.currentUser;
    if (!user || !isSyncEnabled()) return { ok: false, skipped: true, reason: 'no-user-or-sync-disabled' };
    if (isIncognitoSyncPaused()) {
      throw buildIncognitoPausedError('run Firebase backup');
    }
    if (!modules?.setDoc || !modules?.doc || !modules?.serverTimestamp || !firestore) {
      return { ok: false, skipped: true, reason: 'firebase-modules-unavailable' };
    }

    const nowMs = Date.now();
    const meta = readSyncMeta();
    const isManualBackup = mode === 'manual';
    if (isManualBackup && respectManualCooldown) {
      const nextAvailableAtMs = getNextManualFirebaseBackupAtMs(meta);
      if (nextAvailableAtMs && nextAvailableAtMs > nowMs) {
        const error = new Error(`Manual Firebase backup is cooling down. Next available at ${new Date(nextAvailableAtMs).toLocaleString()}.`);
        error.code = 'firebase_manual_backup_cooldown';
        error.nextAvailableAtMs = nextAvailableAtMs;
        error.retryable = true;
        throw error;
      }
    }

    const localSnapshot = collectBackupData();
    let transferSnapshot = null;
    try {
      const userId = getTransferUserId(user);
      transferSnapshot = await loadSnapshotFromTransferApi(user, userId);
    } catch (error) {
      console.warn('Using local fallback for Firebase backup snapshot:', error);
    }
    const selectedSnapshot = chooseSnapshotForFirebaseMirror(transferSnapshot, localSnapshot, meta);
    const snapshot = selectedSnapshot?.snapshot || localSnapshot;
    const snapshotSource = String(selectedSnapshot?.source || 'local-fallback').trim() || 'local-fallback';
    const payload = {
      ...(snapshot || {}),
      meta: {
        ...(snapshot?.meta || {}),
        updatedAtMs: nowMs,
        deviceId: getOrCreateDeviceId(),
        version: 1,
        backupSnapshotSource: snapshotSource
      }
    };
    const firebaseSnapshot = buildFirebaseMirrorSnapshot(payload);
    if (!firebaseSnapshot) {
      console.warn('Skipping Firebase mirror write: snapshot exceeded safe limits after trimming.');
      return { ok: false, skipped: true, reason: 'firebase_snapshot_too_large' };
    }

    await modules.setDoc(modules.doc(firestore, 'users', user.uid), {
      cloudBackup: {
        schema: 'bilm-cloud-sync-v1',
        updatedAt: modules.serverTimestamp(),
        snapshot: firebaseSnapshot,
        transferApiMirrored: true
      }
    }, { merge: true });

    const sanitizedReason = String(reason || (isManualBackup ? 'manual' : FIREBASE_AUTO_BACKUP_REASON)).trim()
      || (isManualBackup ? 'manual' : FIREBASE_AUTO_BACKUP_REASON);
    const sanitizedSource = String(source || 'unknown').trim() || 'unknown';
    const nextMeta = {
      lastFirebaseMirrorAtMs: nowMs,
      lastFirebaseMirrorReason: sanitizedReason,
      lastFirebaseMirrorSource: sanitizedSource,
      lastFirebaseMirrorSnapshotSource: snapshotSource
    };
    if (isManualBackup) {
      nextMeta.lastFirebaseManualBackupAtMs = nowMs;
      nextMeta.lastFirebaseManualBackupReason = sanitizedReason;
      nextMeta.lastFirebaseManualBackupSource = sanitizedSource;
    } else {
      nextMeta.lastFirebaseAutoBackupAtMs = nowMs;
      nextMeta.lastFirebaseAutoBackupReason = sanitizedReason;
      nextMeta.lastFirebaseAutoBackupSource = sanitizedSource;
    }
    writeSyncMeta(nextMeta);
    return {
      ok: true,
      atMs: nowMs,
      mode: isManualBackup ? 'manual' : 'auto',
      reason: sanitizedReason,
      source: sanitizedSource
    };
  }

  function getNextLocalMidnightDelayMs(nowMs = Date.now()) {
    const next = new Date(nowMs);
    next.setHours(24, 0, 0, 0);
    return Math.max(500, next.getTime() - nowMs);
  }

  function clearFirebaseAutoBackupTimer() {
    if (!firebaseAutoBackupTimer) return;
    window.clearTimeout(firebaseAutoBackupTimer);
    firebaseAutoBackupTimer = null;
  }

  async function runAutomaticFirebaseBackupIfDue(triggerSource = 'startup-catchup') {
    const user = auth?.currentUser;
    if (!user || !isSyncEnabled() || isIncognitoSyncPaused()) return false;
    const nowMs = Date.now();
    const meta = readSyncMeta();
    const todayStart = new Date(nowMs);
    todayStart.setHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();
    const lastAutoAtMs = getLastFirebaseAutoBackupAtMs(meta);

    if (lastAutoAtMs >= todayStartMs) return false;
    if (lastAutoAtMs > 0 && (nowMs - lastAutoAtMs) < FIREBASE_MIRROR_INTERVAL_MS) return false;

    try {
      await writeFirebaseBackupSnapshot({
        reason: FIREBASE_AUTO_BACKUP_REASON,
        source: String(triggerSource || 'startup-catchup'),
        mode: 'auto',
        respectManualCooldown: false
      });
      return true;
    } catch (error) {
      console.warn('Automatic Firebase backup failed:', error);
      return false;
    }
  }

  function scheduleNextAutomaticFirebaseBackup() {
    clearFirebaseAutoBackupTimer();
    firebaseAutoBackupTimer = window.setTimeout(async () => {
      try {
        await runAutomaticFirebaseBackupIfDue('midnight-timer');
      } finally {
        scheduleNextAutomaticFirebaseBackup();
      }
    }, getNextLocalMidnightDelayMs());
  }

  function mirrorSnapshotToFirebaseIfDue(reason = FIREBASE_AUTO_BACKUP_REASON) {
    if (String(reason || '').startsWith('list-sync:') || String(reason || '').startsWith('sector-sync:')) {
      return Promise.resolve(false);
    }
    return runAutomaticFirebaseBackupIfDue(String(reason || 'auto').trim() || 'auto');
  }

  function snapshotSignature(snapshot) {
    try {
      const normalized = snapshot
        ? {
          ...snapshot,
          exportedAt: undefined,
          meta: snapshot.meta
            ? {
              ...snapshot.meta,
              updatedAtMs: undefined
            }
            : undefined
        }
        : null;
      return JSON.stringify(normalized);
    } catch {
      return '';
    }
  }

  function sanitizeImportedThemeSettings(rawValue) {
    const parsed = safeParse(rawValue, null);
    if (!parsed || typeof parsed !== 'object') return rawValue;
    const nextSettings = {
      ...parsed,
      incognito: false
    };
    try {
      return JSON.stringify(nextSettings);
    } catch {
      return rawValue;
    }
  }

  function sanitizeImportedSnapshot(snapshot, nowMs = Date.now()) {
    if (!snapshot || snapshot.schema !== 'bilm-backup-v1') return null;
    const localState = {
      ...(snapshot.localStorage || {})
    };
    const sessionState = {
      ...(snapshot.sessionStorage || {})
    };

    delete localState[INCOGNITO_BACKUP_KEY];
    delete sessionState[INCOGNITO_BACKUP_KEY];
    delete localState[INCOGNITO_SEARCH_MAP_KEY];
    delete sessionState[INCOGNITO_SEARCH_MAP_KEY];
    delete localState[DEBUG_ISSUE_LOCAL_KEY];

    if (typeof localState[THEME_SETTINGS_KEY] === 'string') {
      localState[THEME_SETTINGS_KEY] = sanitizeImportedThemeSettings(localState[THEME_SETTINGS_KEY]);
    }

    return {
      ...snapshot,
      localStorage: localState,
      sessionStorage: sessionState,
      meta: {
        ...(snapshot?.meta || {}),
        updatedAtMs: nowMs,
        deviceId: getOrCreateDeviceId(),
        version: 1
      }
    };
  }

  function applySnapshotTransaction(snapshot, {
    reason = 'import',
    preserveSyncPreference = true,
    preserveSyncMeta = true
  } = {}) {
    if (!snapshot || snapshot.schema !== 'bilm-backup-v1') return false;
    const nowMs = Date.now();
    const sanitizedSnapshot = sanitizeImportedSnapshot(snapshot, nowMs);
    if (!sanitizedSnapshot) return false;

    return withMutationSuppressed(() => {
      const syncPreference = preserveSyncPreference ? localStorage.getItem(SYNC_ENABLED_KEY) : null;
      const syncMetaRaw = preserveSyncMeta ? localStorage.getItem(SYNC_META_KEY) : null;
      const deviceIdRaw = localStorage.getItem(SYNC_DEVICE_ID_KEY) || getOrCreateDeviceId();
      const localOnlyState = captureLocalOnlyStorageState();

      localStorage.clear();
      sessionStorage.clear();

      Object.entries(sanitizedSnapshot.localStorage || {}).forEach(([key, value]) => {
        if (typeof value === 'undefined' || value === null) return;
        localStorage.setItem(key, String(value));
      });
      Object.entries(sanitizedSnapshot.sessionStorage || {}).forEach(([key, value]) => {
        if (typeof value === 'undefined' || value === null) return;
        sessionStorage.setItem(key, String(value));
      });

      if (syncPreference === '0') {
        localStorage.setItem(SYNC_ENABLED_KEY, '0');
      }
      if (syncMetaRaw) localStorage.setItem(SYNC_META_KEY, syncMetaRaw);
      if (deviceIdRaw) localStorage.setItem(SYNC_DEVICE_ID_KEY, deviceIdRaw);

      localStorage.removeItem(INCOGNITO_BACKUP_KEY);
      sessionStorage.removeItem(INCOGNITO_BACKUP_KEY);
      localStorage.removeItem(INCOGNITO_SEARCH_MAP_KEY);
      sessionStorage.removeItem(INCOGNITO_SEARCH_MAP_KEY);

      restoreLocalOnlyStorageState(localOnlyState);

      pendingListOperations.clear();
      pendingSectorOperations.clear();

      writeSyncMeta({
        lastLocalChangeAt: nowMs,
        lastMutationType: 'import-apply',
        lastImportAt: nowMs,
        lastImportReason: String(reason || 'import').trim() || 'import',
        listTombstones: {}
      });

      const signature = snapshotSignature(sanitizedSnapshot);
      lastAppliedCloudSignature = signature;
      lastUploadedCloudSignature = signature;
      lastLocalSnapshotSignature = signature;
      return true;
    });
  }

  function getSnapshotSyncListKeys(snapshot) {
    if (!snapshot || snapshot.schema !== 'bilm-backup-v1') return [];
    // Snapshot apply clears and repopulates storage, so any mergeable list can be affected.
    return [...MERGEABLE_LIST_KEYS];
  }

  function applyRemoteSnapshot(snapshot, options = {}) {
    if (!snapshot || snapshot.schema !== 'bilm-backup-v1') return false;
    try {
      const force = options?.force === true;
      if (!shouldApplyRemoteSnapshot(snapshot, { force })) return false;
      const applyReason = String(options?.reason || 'remote-cloud-apply').trim() || 'remote-cloud-apply';
      const source = String(options?.source || 'remote-snapshot').trim() || 'remote-snapshot';
      const applied = applySnapshotTransaction(snapshot, {
        reason: applyReason,
        preserveSyncPreference: true,
        preserveSyncMeta: true
      });
      if (!applied) return false;
      const appliedAtMs = Date.now();
      writeSyncMeta({
        lastCloudPullAt: appliedAtMs,
        lastCloudSnapshotAt: Number(snapshot?.meta?.updatedAtMs || 0) || appliedAtMs,
        lastAppliedFromDeviceId: snapshot?.meta?.deviceId || null
      });
      emitSyncAppliedEvent({
        source,
        atMs: appliedAtMs,
        reason: applyReason,
        listKeys: getSnapshotSyncListKeys(snapshot)
      });
      return true;
    } catch (error) {
      console.warn('Applying cloud snapshot failed:', error);
      return false;
    }
  }

  function hasMeaningfulLocalData() {
    const localKeys = Object.keys(localStorage).filter((key) => (
      ![SYNC_ENABLED_KEY, SYNC_META_KEY, SYNC_DEVICE_ID_KEY].includes(key)
      && !isLocalOnlyStorageKey(key)
    ));
    if (localKeys.length > 0) return true;
    if (sessionStorage.length > 0) return true;
    return String(document.cookie || '').trim().length > 0;
  }

  function hasLocalMergeableData() {
    for (const storageKey of MERGEABLE_LIST_KEYS) {
      if (localStorage.getItem(storageKey) === null) continue;
      const list = readJsonArray(localStorage.getItem(storageKey));
      if (list.length > 0) return true;
    }
    return false;
  }

  function shouldApplyRemoteSnapshot(snapshot, options = {}) {
    if (!snapshot || snapshot.schema !== 'bilm-backup-v1') return false;
    if (options?.force === true) return true;
    if (!hasMeaningfulLocalData()) return true;
    if (hasLocalMergeableData()) return false;

    const cloudUpdatedAtMs = Number(snapshot?.meta?.updatedAtMs || 0);
    if (!cloudUpdatedAtMs) return false;

    const meta = readSyncMeta();
    const localChangedAt = Number(meta?.lastLocalChangeAt || 0);
    const localCloudPullAt = Number(meta?.lastCloudPullAt || 0);
    const freshnessFloor = Math.max(localChangedAt, localCloudPullAt);
    return cloudUpdatedAtMs > freshnessFloor;
  }

  function getSnapshotUpdatedAtMs(snapshot) {
    if (!snapshot || snapshot.schema !== 'bilm-backup-v1') return 0;
    return Number(snapshot?.meta?.updatedAtMs || 0) || 0;
  }

  function getSnapshotMergeableItemCount(snapshot) {
    if (!snapshot || snapshot.schema !== 'bilm-backup-v1') return 0;
    let total = 0;
    MERGEABLE_LIST_KEYS.forEach((storageKey) => {
      const list = readJsonArray(snapshot?.localStorage?.[storageKey]);
      total += Array.isArray(list) ? list.length : 0;
    });
    return total;
  }

  function choosePreferredCloudSnapshot(transferSnapshot, firestoreSnapshot) {
    const transferValid = transferSnapshot && transferSnapshot.schema === 'bilm-backup-v1';
    const firestoreValid = firestoreSnapshot && firestoreSnapshot.schema === 'bilm-backup-v1';
    const transferItemCount = transferValid ? getSnapshotMergeableItemCount(transferSnapshot) : 0;
    const firestoreItemCount = firestoreValid ? getSnapshotMergeableItemCount(firestoreSnapshot) : 0;
    const transferUpdatedAtMs = transferValid ? getSnapshotUpdatedAtMs(transferSnapshot) : 0;
    const firestoreUpdatedAtMs = firestoreValid ? getSnapshotUpdatedAtMs(firestoreSnapshot) : 0;

    if (transferValid && !firestoreValid) {
      return {
        snapshot: transferSnapshot,
        source: 'data-api',
        reason: 'data_api_only',
        transferItemCount,
        firestoreItemCount
      };
    }
    if (!transferValid && firestoreValid) {
      return {
        snapshot: firestoreSnapshot,
        source: 'firestore-fallback',
        reason: 'firestore_backup_fallback',
        transferItemCount,
        firestoreItemCount
      };
    }
    if (transferValid && firestoreValid) {
      if (transferUpdatedAtMs > firestoreUpdatedAtMs) {
        return {
          snapshot: transferSnapshot,
          source: 'data-api',
          reason: 'data_api_newer',
          transferItemCount,
          firestoreItemCount
        };
      }
      if (firestoreUpdatedAtMs > transferUpdatedAtMs) {
        return {
          snapshot: firestoreSnapshot,
          source: 'firestore-fallback',
          reason: 'firestore_newer',
          transferItemCount,
          firestoreItemCount
        };
      }
      if (transferItemCount > firestoreItemCount) {
        return {
          snapshot: transferSnapshot,
          source: 'data-api',
          reason: 'timestamps_tied_data_api_richer',
          transferItemCount,
          firestoreItemCount
        };
      }
      if (firestoreItemCount > transferItemCount) {
        return {
          snapshot: firestoreSnapshot,
          source: 'firestore-fallback',
          reason: 'timestamps_tied_firestore_richer',
          transferItemCount,
          firestoreItemCount
        };
      }
      return {
        snapshot: transferSnapshot,
        source: 'data-api',
        reason: 'timestamps_and_counts_tied_data_api_primary',
        transferItemCount,
        firestoreItemCount
      };
    }
    return {
      snapshot: null,
      source: 'none',
      reason: 'no_snapshot',
      transferItemCount,
      firestoreItemCount
    };
  }

  function chooseSnapshotForFirebaseMirror(transferSnapshot, localSnapshot, syncMeta = readSyncMeta()) {
    const transferValid = transferSnapshot && transferSnapshot.schema === 'bilm-backup-v1';
    const localValid = localSnapshot && localSnapshot.schema === 'bilm-backup-v1';
    const transferItemCount = transferValid ? getSnapshotMergeableItemCount(transferSnapshot) : 0;
    const localItemCount = localValid ? getSnapshotMergeableItemCount(localSnapshot) : 0;
    const transferUpdatedAtMs = transferValid ? getSnapshotUpdatedAtMs(transferSnapshot) : 0;
    const localFreshnessMs = Math.max(
      Number(syncMeta?.lastLocalChangeAt || 0) || 0,
      Number(syncMeta?.lastCloudPullAt || 0) || 0,
      Number(syncMeta?.lastCloudPushAt || 0) || 0
    );

    if (!transferValid && localValid) {
      return {
        snapshot: localSnapshot,
        source: 'local-fallback',
        reason: 'local_only'
      };
    }
    if (transferValid && !localValid) {
      return {
        snapshot: transferSnapshot,
        source: 'data-api',
        reason: 'data_api_only'
      };
    }
    if (!transferValid && !localValid) {
      return {
        snapshot: null,
        source: 'none',
        reason: 'no_snapshot'
      };
    }
    if (localFreshnessMs > transferUpdatedAtMs) {
      return {
        snapshot: localSnapshot,
        source: 'local-fallback',
        reason: 'local_fresher_than_data_api'
      };
    }
    if (transferUpdatedAtMs > localFreshnessMs) {
      return {
        snapshot: transferSnapshot,
        source: 'data-api',
        reason: 'data_api_fresher_than_local'
      };
    }
    if (transferItemCount > localItemCount) {
      return {
        snapshot: transferSnapshot,
        source: 'data-api',
        reason: 'freshness_tied_data_api_richer'
      };
    }
    if (localItemCount > transferItemCount) {
      return {
        snapshot: localSnapshot,
        source: 'local-fallback',
        reason: 'freshness_tied_local_richer'
      };
    }
    return {
      snapshot: localSnapshot,
      source: 'local-fallback',
      reason: 'freshness_and_counts_tied_local_preferred'
    };
  }

  async function saveLocalSnapshotToCloud(reason = 'auto') {
    await init();
    const user = auth?.currentUser;
    const forceReasons = new Set(['manual', 'pagehide', 'visibility-hidden']);
    if (!user || !isSyncEnabled() || pendingAutosync) return false;
    if (isIncognitoSyncPaused()) return false;
    if (!snapshotListenerReady && !forceReasons.has(reason)) return false;

    const now = Date.now();
    if (!forceReasons.has(reason) && now - lastSaveAttemptAt < MIN_SAVE_INTERVAL_MS) return false;

    const snapshot = collectBackupData();
    const signature = snapshotSignature(snapshot);
    if (!signature) return false;
    if (signature === lastUploadedCloudSignature || signature === lastAppliedCloudSignature) {
      lastLocalSnapshotSignature = signature;
      return false;
    }

    pendingAutosync = true;
    lastSaveAttemptAt = now;
    try {
      await api.saveCloudSnapshot(snapshot);
      writeSyncMeta({
        lastCloudPushAt: Date.now(),
        lastLocalChangeAt: Date.now(),
        lastPushReason: reason
      });
      lastUploadedCloudSignature = signature;
      lastLocalSnapshotSignature = signature;
      return true;
    } finally {
      pendingAutosync = false;
    }
  }

  function evaluateCloudSnapshotDrift(transferSnapshot, firestoreSnapshot, source = 'none') {
    const transferSignature = snapshotSignature(transferSnapshot);
    const firestoreSignature = snapshotSignature(firestoreSnapshot);
    const hasComparableSnapshots = Boolean(transferSignature && firestoreSignature);
    const detected = hasComparableSnapshots && transferSignature !== firestoreSignature;
    const nowMs = Date.now();
    const previousMeta = readSyncMeta();
    const sourceValue = String(source || 'none').trim() || 'none';

    if (!detected) {
      writeSyncMeta({
        cloudDriftRepairPending: false,
        lastCloudDriftDetectedAt: Number(previousMeta?.lastCloudDriftDetectedAt || 0) || 0,
        lastCloudDriftSourceChosen: sourceValue
      });
      return {
        detected: false,
        detectedAtMs: Number(previousMeta?.lastCloudDriftDetectedAt || 0) || 0
      };
    }

    const previousTransfer = String(previousMeta?.lastCloudDriftTransferHash || '').trim();
    const previousFirestore = String(previousMeta?.lastCloudDriftFirestoreHash || '').trim();
    const signaturesChanged = previousTransfer !== transferSignature || previousFirestore !== firestoreSignature;
    const detectedAtMs = signaturesChanged
      ? nowMs
      : (Number(previousMeta?.lastCloudDriftDetectedAt || 0) || nowMs);

    writeSyncMeta({
      cloudDriftRepairPending: true,
      lastCloudDriftDetectedAt: detectedAtMs,
      lastCloudDriftTransferHash: transferSignature,
      lastCloudDriftFirestoreHash: firestoreSignature,
      lastCloudDriftSourceChosen: sourceValue
    });

    return {
      detected: true,
      detectedAtMs,
      transferSignature,
      firestoreSignature
    };
  }

  async function runOneShotDriftRepairPullIfNeeded(driftState, reason = 'cloud-drift') {
    if (!driftState?.detected) return false;
    const meta = readSyncMeta();
    const detectedAtMs = Number(driftState.detectedAtMs || 0) || 0;
    const lastRepairAtMs = Number(meta?.lastCloudDriftAutoRepairAt || 0) || 0;

    if (lastRepairAtMs >= detectedAtMs && (Date.now() - lastRepairAtMs) < CLOUD_DRIFT_REPAIR_COOLDOWN_MS) {
      return false;
    }

    writeSyncMeta({
      lastCloudDriftAutoRepairAt: Date.now(),
      lastCloudDriftAutoRepairReason: String(reason || 'cloud-drift').trim() || 'cloud-drift'
    });

    try {
      await syncListsFromCloudNow();
      writeSyncMeta({
        cloudDriftRepairPending: false,
        lastCloudDriftAutoRepairResult: 'ok',
        lastCloudDriftAutoRepairResultAt: Date.now()
      });
      return true;
    } catch (error) {
      writeSyncMeta({
        cloudDriftRepairPending: true,
        lastCloudDriftAutoRepairResult: String(error?.code || error?.message || 'failed').trim() || 'failed',
        lastCloudDriftAutoRepairResultAt: Date.now()
      });
      return false;
    }
  }

  function applyListOperationsToLocalStorage(operations = []) {
    if (!Array.isArray(operations) || operations.length === 0) return false;
    const grouped = new Map();
    operations.forEach((operation) => {
      const listKey = String(operation?.listKey || '').trim();
      if (!MERGEABLE_LIST_KEYS.has(listKey)) return;
      if (!grouped.has(listKey)) grouped.set(listKey, []);
      grouped.get(listKey).push(operation);
    });
    if (!grouped.size) return false;

    suppressMutationHook = true;
    try {
      grouped.forEach((ops, listKey) => {
        const byKey = new Map();
        readJsonArray(localStorage.getItem(listKey)).forEach((entry) => {
          const itemKey = getListItemKey(entry);
          if (!itemKey) return;
          byKey.set(itemKey, entry);
        });

        ops.forEach((operation) => {
          const itemKey = String(operation?.itemKey || '').trim();
          if (!itemKey) return;
          const updatedAtMs = normalizeOperationUpdatedAt(operation?.updatedAtMs, 0);
          const existing = byKey.get(itemKey);
          const existingUpdatedAtMs = normalizeOperationUpdatedAt(getItemUpdatedAt(existing), 0);
          if (operation?.deleted === true) {
            if (!existing || existingUpdatedAtMs <= updatedAtMs) {
              byKey.delete(itemKey);
            }
            return;
          }

          const payload = normalizeListOperationPayload(operation?.payload, updatedAtMs);
          if (!payload) return;
          if (!existing || existingUpdatedAtMs <= updatedAtMs) {
            byKey.set(itemKey, payload);
          }
        });

        const maxItems = Number(LIST_MAX_ITEMS_BY_KEY[listKey] || DEFAULT_LIST_MAX_ITEMS) || DEFAULT_LIST_MAX_ITEMS;
        const nextList = [...byKey.values()]
          .sort((left, right) => getItemUpdatedAt(right) - getItemUpdatedAt(left))
          .slice(0, maxItems);
        localStorage.setItem(listKey, JSON.stringify(nextList));
      });
    } finally {
      suppressMutationHook = false;
    }

    const appliedAtMs = Date.now();
    const appliedListKeys = [...grouped.keys()];
    writeSyncMeta({ lastCloudPullAt: appliedAtMs });
    emitListSyncApplied({
      listKeys: appliedListKeys,
      atMs: appliedAtMs
    });
    emitSyncAppliedEvent({
      source: 'list-sync',
      atMs: appliedAtMs,
      listKeys: appliedListKeys
    });
    return true;
  }

  function applyStorageSectorOperationsToLocalStorage(operations = []) {
    if (!Array.isArray(operations) || operations.length === 0) return false;
    const latestByStorageKey = new Map();
    operations.forEach((operation) => {
      const normalized = toStorageSectorOperation(operation);
      if (!normalized) return;
      const storageKey = String(normalized.storageKey || '').trim();
      if (!storageKey) return;
      const queueKey = `${normalized.sectorKey}|${normalized.itemKey}`;
      const current = latestByStorageKey.get(queueKey);
      if (!current || normalized.updatedAtMs >= normalizeOperationUpdatedAt(current.updatedAtMs, 0)) {
        latestByStorageKey.set(queueKey, normalized);
      }
    });
    if (!latestByStorageKey.size) return false;

    suppressMutationHook = true;
    try {
      latestByStorageKey.forEach((operation) => {
        if (operation.deleted) {
          localStorage.removeItem(operation.storageKey);
          return;
        }
        const nextValue = typeof operation.value === 'string'
          ? operation.value
          : JSON.stringify(operation.value ?? '');
        localStorage.setItem(operation.storageKey, nextValue);
      });
    } finally {
      suppressMutationHook = false;
    }

    const appliedAtMs = Date.now();
    const appliedStorageKeys = [...new Set(
      [...latestByStorageKey.values()]
        .map((operation) => String(operation?.storageKey || '').trim())
        .filter(Boolean)
    )];
    writeSyncMeta({ lastCloudPullAt: appliedAtMs });
    emitSyncAppliedEvent({
      source: 'sector-sync',
      atMs: appliedAtMs,
      storageKeys: appliedStorageKeys
    });
    return true;
  }

  function clearListSyncRetryTimer() {
    if (listSyncRetryTimer) {
      window.clearTimeout(listSyncRetryTimer);
      listSyncRetryTimer = null;
    }
  }

  function clearPendingSyncStateForAuthChange(reason = 'auth-state-change') {
    pendingListOperations.clear();
    pendingSectorOperations.clear();
    clearListSyncRetryTimer();
    listSyncRetryDelayMs = 0;
    if (listSyncDebounceTimer) {
      clearTimeout(listSyncDebounceTimer);
      listSyncDebounceTimer = null;
    }
    if (autosyncDebounceTimer) {
      clearTimeout(autosyncDebounceTimer);
      autosyncDebounceTimer = null;
    }
    pendingListSync = false;
    pendingAutosync = false;
    lastAppliedCloudSignature = '';
    lastUploadedCloudSignature = '';
    lastLocalSnapshotSignature = '';
  }

  function isRetryableSyncFailure(error) {
    if (error?.retryable === true) return true;
    if (error?.retryable === false) return false;
    const status = Number(error?.status || 0) || 0;
    if (!status) return true;
    if (status === 429 || status >= 500) return true;
    if (status >= 400 && status < 500) return false;
    return true;
  }

  function getSectorPayloadLimit(sectorKey) {
    const normalizedSectorKey = String(sectorKey || '').trim().toLowerCase();
    return Number(SECTOR_PAYLOAD_LIMITS[normalizedSectorKey] || SECTOR_PAYLOAD_LIMITS.default) || SECTOR_PAYLOAD_LIMITS.default;
  }

  function getOperationSyncScope(operation = {}) {
    const sectorKey = String(operation?.sectorKey || '').trim().toLowerCase();
    const listKey = String(operation?.listKey || sectorKeyToListKey(sectorKey) || '').trim();
    if (listKey === 'bilm-shared-chat' || sectorKey === 'chat_messages') return 'chat';
    return 'sync';
  }

  function getOperationIdentity(operation = {}) {
    const sectorKey = String(operation?.sectorKey || '').trim().toLowerCase();
    const listKey = String(operation?.listKey || sectorKeyToListKey(sectorKey) || '').trim() || null;
    const normalizedSectorKey = sectorKey || listKeyToSectorKey(listKey) || null;
    const itemKey = String(operation?.itemKey || '').trim() || null;
    const updatedAtMs = normalizeOperationUpdatedAt(operation?.updatedAtMs, 0, { context: 'sync-op:identity' });
    const payload = operation?.payload;
    const payloadBytes = (() => {
      if (payload === null || typeof payload === 'undefined') return 0;
      try {
        return JSON.stringify(payload).length;
      } catch {
        return 0;
      }
    })();
    return {
      listKey,
      sectorKey: normalizedSectorKey,
      itemKey,
      deleted: operation?.deleted === true,
      updatedAtMs,
      opId: String(operation?.opId || '').trim() || null,
      payloadBytes
    };
  }

  function validateOutgoingSectorOperation(operation = {}) {
    const sectorKey = String(operation?.sectorKey || '').trim().toLowerCase();
    const itemKey = String(operation?.itemKey || '').trim();
    if (!sectorKey || !ALL_PULL_SECTOR_KEYS.includes(sectorKey)) {
      return {
        code: 'invalid_sector_key',
        message: 'Operation has an invalid sector key.',
        status: 400,
        retryable: false
      };
    }
    if (!itemKey || itemKey.length > SYNC_MAX_ITEM_KEY_LENGTH) {
      return {
        code: 'invalid_item_key',
        message: 'Operation item key is missing or too long.',
        status: 400,
        retryable: false
      };
    }
    if (operation?.deleted === true) {
      return null;
    }
    const payload = operation?.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {
        code: sectorKey === 'chat_messages' ? 'chat_payload_invalid' : 'invalid_payload',
        message: 'Operation payload must be an object.',
        status: 400,
        retryable: false
      };
    }
    if (sectorKey === 'chat_messages') {
      const text = String(payload?.text || '').trim();
      if (!text) {
        return {
          code: 'chat_payload_invalid',
          message: 'Chat payload text is required.',
          status: 400,
          retryable: false
        };
      }
      if (text.length > SYNC_CHAT_MAX_TEXT_LENGTH) {
        return {
          code: 'chat_message_too_large',
          message: `Chat payload text exceeds ${SYNC_CHAT_MAX_TEXT_LENGTH} characters.`,
          status: 413,
          retryable: false
        };
      }
      return null;
    }

    let serialized = '';
    try {
      serialized = JSON.stringify(payload);
    } catch {
      return {
        code: 'invalid_payload',
        message: 'Operation payload could not be serialized.',
        status: 400,
        retryable: false
      };
    }
    if (serialized.length > getSectorPayloadLimit(sectorKey)) {
      return {
        code: 'sector_payload_too_large',
        message: 'Operation payload exceeds sector size limit.',
        status: 413,
        retryable: false
      };
    }
    return null;
  }

  function isPendingEntryCurrent(entry) {
    if (!entry || !entry.key) return false;
    const map = entry.queueType === 'sector' ? pendingSectorOperations : pendingListOperations;
    return map.get(entry.key) === entry.queuedOperation;
  }

  function removePendingEntryIfCurrent(entry) {
    if (!entry || !entry.key) return false;
    const map = entry.queueType === 'sector' ? pendingSectorOperations : pendingListOperations;
    if (map.get(entry.key) !== entry.queuedOperation) return false;
    map.delete(entry.key);
    return true;
  }

  function quarantinePendingSyncEntry(entry, issue = {}, user = auth?.currentUser || currentUser) {
    const operation = entry?.operation || entry?.queuedOperation || {};
    const identity = getOperationIdentity(operation);
    const removed = removePendingEntryIfCurrent(entry);
    const status = Number(issue?.status || 0) || null;
    const code = String(issue?.code || 'sync_operation_quarantined').trim() || 'sync_operation_quarantined';
    const message = String(issue?.message || 'Skipped a malformed sync operation to keep sync running.').trim()
      || 'Skipped a malformed sync operation to keep sync running.';
    const retryable = issue?.retryable === true;
    const requestId = String(issue?.requestId || '').trim() || null;
    const nowMs = Date.now();

    appendSyncQuarantineDiagnostic({
      atMs: nowMs,
      reason: code,
      status,
      retryable,
      requestId,
      queueType: entry?.queueType || null,
      removed,
      ...identity
    }, user);

    emitSyncIssue({
      scope: getOperationSyncScope(operation),
      listKey: identity.listKey,
      sectorKey: identity.sectorKey,
      code,
      message,
      status,
      retryable,
      requestId
    });
    return removed;
  }

  function preparePendingOperationsForPush(listBatchEntries = [], sectorBatchEntries = [], user = auth?.currentUser || currentUser) {
    const candidates = [
      ...listBatchEntries.map(([key, queuedOperation]) => ({
        queueType: 'list',
        key,
        queuedOperation
      })),
      ...sectorBatchEntries.map(([key, queuedOperation]) => ({
        queueType: 'sector',
        key,
        queuedOperation
      }))
    ];
    const readyEntries = [];
    let quarantinedCount = 0;

    candidates.forEach((candidate) => {
      if (!isPendingEntryCurrent(candidate)) return;
      const normalized = toSectorOperation(candidate.queuedOperation);
      if (!normalized) {
        quarantinedCount += quarantinePendingSyncEntry(candidate, {
          code: 'invalid_operation',
          message: 'Skipped invalid sync operation before upload.',
          status: 400,
          retryable: false
        }, user) ? 1 : 0;
        return;
      }
      const validationIssue = validateOutgoingSectorOperation(normalized);
      if (validationIssue) {
        quarantinedCount += quarantinePendingSyncEntry({
          ...candidate,
          operation: normalized
        }, validationIssue, user) ? 1 : 0;
        return;
      }
      readyEntries.push({
        ...candidate,
        operation: normalized
      });
    });

    return {
      readyEntries,
      operations: readyEntries.map((entry) => entry.operation),
      quarantinedCount
    };
  }

  function applyPushSuccessMeta(reason, operations = [], cursorMs = 0) {
    const maxUpdatedAt = operations.reduce(
      (max, operation) => Math.max(max, normalizeOperationUpdatedAt(operation?.updatedAtMs, 0, { context: 'sync-op:push-success' })),
      0
    );
    const nextCursorMs = Math.max(
      normalizeOperationUpdatedAt(cursorMs, 0, { context: 'sync-cursor:push-success' }),
      maxUpdatedAt
    );
    if (nextCursorMs > 0) {
      setListSyncCursorMs(nextCursorMs);
    }
    writeSyncMeta({
      lastListSyncPushAt: Date.now(),
      lastListSyncPushReason: reason
    });
    void mirrorSnapshotToFirebaseIfDue(`list-sync:${reason}`);
    return nextCursorMs;
  }

  async function retryPendingOperationsIndividually({
    user,
    userId,
    reason = 'list-mutation',
    entries = []
  } = {}) {
    const pushedOperations = [];
    let quarantinedCount = 0;
    const retryableOperations = [];
    let retryableError = null;
    let maxCursorMs = 0;

    for (const entry of entries) {
      if (!isPendingEntryCurrent(entry)) continue;
      try {
        const response = await pushListOperationsToTransferApi(user, userId, [entry.operation]);
        removePendingEntryIfCurrent(entry);
        pushedOperations.push(entry.operation);
        maxCursorMs = Math.max(
          maxCursorMs,
          normalizeOperationUpdatedAt(response?.cursorMs, 0, { context: 'sync-cursor:single-op' })
        );
      } catch (error) {
        if (isRetryableSyncFailure(error)) {
          retryableOperations.push(entry.operation);
          retryableError = error;
          continue;
        }
        quarantinedCount += quarantinePendingSyncEntry(entry, {
          code: error?.code || error?.error || 'sync_operation_rejected',
          message: error?.message || 'Skipped a sync operation rejected by the cloud service.',
          status: error?.status || null,
          retryable: false,
          requestId: error?.requestId || null
        }, user) ? 1 : 0;
      }
    }

    if (pushedOperations.length) {
      applyPushSuccessMeta(`${reason}:isolate`, pushedOperations, maxCursorMs);
    }

    return {
      pushedOperations,
      quarantinedCount,
      retryableOperations,
      retryableError
    };
  }

  function scheduleListSyncRetry(error, operations = []) {
    clearListSyncRetryTimer();
    listSyncRetryDelayMs = listSyncRetryDelayMs > 0
      ? Math.min(60000, listSyncRetryDelayMs * 2)
      : 1200;
    const jitterMs = Math.floor(Math.random() * 450);
    const nextDelay = listSyncRetryDelayMs + jitterMs;
    const hasChatOperations = operations.some((operation) => (
      String(operation?.listKey || '').trim() === 'bilm-shared-chat'
      || String(operation?.sectorKey || '').trim() === 'chat_messages'
    ));
    if (hasChatOperations) {
      emitSyncIssue({
        scope: 'chat',
        listKey: 'bilm-shared-chat',
        sectorKey: listKeyToSectorKey('bilm-shared-chat'),
        code: error?.code || error?.error || 'chat_sync_failed',
        message: error?.message || 'Chat sync failed. We will retry automatically.',
        status: error?.status || null,
        retryable: error?.retryable !== false,
        requestId: error?.requestId || null
      });
    }
    listSyncRetryTimer = window.setTimeout(() => {
      flushPendingListOperationsToCloud('retry-backoff').catch((retryError) => {
        console.warn('List sync retry failed:', retryError);
      });
    }, nextDelay);
  }

  function collectPendingSyncOperations() {
    return [
      ...pendingListOperations.values(),
      ...pendingSectorOperations.values()
    ];
  }

  function scheduleListSyncFlush(reason = 'list-mutation') {
    if (!isSyncEnabled()) return;
    const syncPaused = isSyncTemporarilyPaused();
    const pendingOperations = collectPendingSyncOperations();
    const hasNonDeleteOperation = pendingOperations.some((operation) => operation?.deleted !== true);
    const flushDelayMs = syncPaused
      ? SYNC_PAUSE_RECHECK_MS
      : (
        pendingOperations.length > 0 && !hasNonDeleteOperation
          ? LIST_DELETE_SYNC_DEBOUNCE_MS
          : LIST_SYNC_DEBOUNCE_MS
      );
    console.debug('[sync] schedule list flush', {
      reason,
      delayMs: flushDelayMs,
      pendingCount: pendingOperations.length,
      deleteOnly: pendingOperations.length > 0 && !hasNonDeleteOperation,
      paused: syncPaused
    });
    clearListSyncRetryTimer();
    clearTimeout(listSyncDebounceTimer);
    listSyncDebounceTimer = window.setTimeout(() => {
      if (isSyncTemporarilyPaused()) {
        scheduleSyncPauseRecheck();
        scheduleListSyncFlush('activity-paused');
        return;
      }
      flushPendingListOperationsToCloud(reason).catch((error) => {
        console.warn('List sync push failed:', error);
      });
    }, flushDelayMs);
  }

  async function flushPendingListOperationsToCloud(reason = 'list-mutation') {
    await init();
    const user = auth?.currentUser;
    if (!user || !isSyncEnabled() || pendingListSync || transferApiDisabled) return false;
    if (isIncognitoSyncPaused()) return false;
    if (isSyncTemporarilyPaused()) {
      scheduleSyncPauseRecheck();
      return false;
    }
    if (pendingListOperations.size === 0 && pendingSectorOperations.size === 0) return false;

    const listBatchEntries = [...pendingListOperations.entries()];
    const sectorBatchEntries = [...pendingSectorOperations.entries()];
    const prepared = preparePendingOperationsForPush(listBatchEntries, sectorBatchEntries, user);
    const operations = prepared.operations;
    const readyEntries = prepared.readyEntries;
    if (!operations.length) {
      if (prepared.quarantinedCount > 0) {
        listSyncRetryDelayMs = 0;
        clearListSyncRetryTimer();
        return true;
      }
      return false;
    }
    const hasNonDeleteOperation = operations.some((operation) => operation?.deleted !== true);
    const userId = getTransferUserId(user);

    pendingListSync = true;
    try {
      console.debug('[sync] flushing pending operations', {
        reason,
        count: operations.length,
        deleteOnly: !hasNonDeleteOperation
      });
      const response = await pushListOperationsToTransferApi(user, userId, operations);
      readyEntries.forEach((entry) => {
        removePendingEntryIfCurrent(entry);
      });
      applyPushSuccessMeta(reason, operations, response?.cursorMs);
      console.debug('[sync] flush success', {
        reason,
        count: operations.length
      });
      listSyncRetryDelayMs = 0;
      clearListSyncRetryTimer();
      return true;
    } catch (error) {
      if (!isRetryableSyncFailure(error)) {
        if (readyEntries.length === 1) {
          quarantinePendingSyncEntry(readyEntries[0], {
            code: error?.code || error?.error || 'sync_operation_rejected',
            message: error?.message || 'Skipped a sync operation rejected by the cloud service.',
            status: error?.status || null,
            retryable: false,
            requestId: error?.requestId || null
          }, user);
          listSyncRetryDelayMs = 0;
          clearListSyncRetryTimer();
          return true;
        }

        const isolated = await retryPendingOperationsIndividually({
          user,
          userId,
          reason,
          entries: readyEntries
        });
        const madeProgress = (
          isolated.pushedOperations.length > 0
          || isolated.quarantinedCount > 0
          || prepared.quarantinedCount > 0
        );
        if (isolated.retryableOperations.length > 0 && isolated.retryableError) {
          scheduleListSyncRetry(isolated.retryableError, isolated.retryableOperations);
          if (!madeProgress) {
            throw isolated.retryableError;
          }
        } else {
          listSyncRetryDelayMs = 0;
          clearListSyncRetryTimer();
        }
        if (madeProgress) return true;
      }
      scheduleListSyncRetry(error, operations);
      throw error;
    } finally {
      pendingListSync = false;
    }
  }

  async function syncListsFromCloudNow() {
    await init();
    const user = auth?.currentUser;
    if (!user || !isSyncEnabled() || transferApiDisabled) return false;
    if (isIncognitoSyncPaused()) return false;
    if (isSyncTemporarilyPaused()) return false;

    const userId = getTransferUserId(user);
    let sinceMs = getListSyncCursorMs();
    const skewDetectedAtMs = parseSyncTimestampMs(
      getScopedSyncMetaValue(SYNC_TIMESTAMP_SKEW_DETECTED_META_KEY, 0, user),
      0
    );
    const recoveryCompletedAtMs = getListSyncOneTimeRecoveryCompletedAtMs();
    if (skewDetectedAtMs > recoveryCompletedAtMs) {
      sinceMs = 0;
    }
    let pages = 0;
    let applied = false;
    let attemptedBootstrapRecovery = false;

    const runOneTimeRecovery = async () => {
      if (getListSyncOneTimeRecoveryCompletedAtMs() > 0) {
        return {
          applied: false,
          cursorMs: sinceMs
        };
      }
      if (oneTimeRecoveryPromise) {
        return oneTimeRecoveryPromise;
      }
      oneTimeRecoveryPromise = (async () => {
        let recoverySinceMs = 0;
        let recoveryPages = 0;
        let recoveryApplied = false;
        let recoveryCursorMs = 0;
        let sawValidResponse = false;

        while (recoveryPages < ONE_TIME_RECOVERY_MAX_PAGES) {
          recoveryPages += 1;
          const response = await pullListOperationsFromTransferApi(user, userId, recoverySinceMs, 250);
          if (!response || !Array.isArray(response.operations)) break;
          sawValidResponse = true;
          const operations = response.operations;
          const sectorOperations = Array.isArray(response.sectorOperations) ? response.sectorOperations : [];
          const migratedAtMs = normalizeOperationUpdatedAt(response?.state?.migratedAtMs, 0);
          if (migratedAtMs > 0) {
            setSectorMigrationCompletedAtMs(migratedAtMs);
          }
          if (operations.length > 0) {
            const didApply = applyListOperationsToLocalStorage(operations);
            recoveryApplied = recoveryApplied || didApply;
          }
          if (sectorOperations.length > 0) {
            const didApplyStorage = applyStorageSectorOperationsToLocalStorage(sectorOperations);
            recoveryApplied = recoveryApplied || didApplyStorage;
          }

          const operationCursorMs = operations.reduce(
            (max, operation) => Math.max(max, normalizeOperationUpdatedAt(operation?.updatedAtMs, 0)),
            0
          );
          const sectorCursorMs = sectorOperations.reduce(
            (max, operation) => Math.max(max, normalizeOperationUpdatedAt(operation?.updatedAtMs, 0)),
            0
          );
          const responseCursorMs = Math.max(
            normalizeOperationUpdatedAt(response?.cursorMs, recoverySinceMs),
            operationCursorMs,
            sectorCursorMs
          );
          recoveryCursorMs = Math.max(recoveryCursorMs, responseCursorMs);
          const batchCount = operations.length + sectorOperations.length;
          if (batchCount < 250 || responseCursorMs <= recoverySinceMs) break;
          recoverySinceMs = responseCursorMs;
        }

        if (!sawValidResponse) {
          return {
            applied: false,
            cursorMs: sinceMs
          };
        }

        const nextCursorMs = Math.max(sinceMs, recoveryCursorMs);
        if (nextCursorMs > 0) {
          setListSyncCursorMs(nextCursorMs);
        }
        setListSyncOneTimeRecoveryCompletedAtMs(Date.now());
        return {
          applied: recoveryApplied,
          cursorMs: nextCursorMs
        };
      })();

      try {
        return await oneTimeRecoveryPromise;
      } finally {
        oneTimeRecoveryPromise = null;
      }
    };

    try {
      const recovery = await runOneTimeRecovery();
      applied = applied || Boolean(recovery?.applied);
      sinceMs = Math.max(sinceMs, normalizeOperationUpdatedAt(recovery?.cursorMs, sinceMs));
    } catch (error) {
      console.warn('One-time full recovery pull failed:', error);
    }

    while (pages < 4) {
      pages += 1;
      const response = await pullListOperationsFromTransferApi(user, userId, sinceMs, 250);
      if (!response || !Array.isArray(response.operations)) break;
      const operations = response.operations;
      const sectorOperations = Array.isArray(response.sectorOperations) ? response.sectorOperations : [];
      const cursorMs = normalizeOperationUpdatedAt(response.cursorMs, sinceMs);
      const migratedAtMs = normalizeOperationUpdatedAt(response?.state?.migratedAtMs, 0);
      if (migratedAtMs > 0) {
        setSectorMigrationCompletedAtMs(migratedAtMs);
      }
      if (operations.length > 0) {
        const didApply = applyListOperationsToLocalStorage(operations);
        applied = applied || didApply;
      }
      if (sectorOperations.length > 0) {
        const didApplyStorage = applyStorageSectorOperationsToLocalStorage(sectorOperations);
        applied = applied || didApplyStorage;
      }
      if (
        !attemptedBootstrapRecovery
        && sinceMs <= 0
        && operations.length === 0
        && sectorOperations.length === 0
        && migratedAtMs <= 0
      ) {
        attemptedBootstrapRecovery = true;
        try {
          const bootstrapped = await ensureSectorBootstrapForUser(user, { forceCheck: true });
          if (bootstrapped) {
            continue;
          }
        } catch (error) {
          console.warn('Bootstrap recovery attempt failed:', error);
        }
      }
      sinceMs = Math.max(sinceMs, cursorMs);
      setListSyncCursorMs(sinceMs);
      if (operations.length < 250) break;
    }

    return applied;
  }

  function ensureAutosyncFlushBindings() {
    if (autosyncFlushBound) return;
    autosyncFlushBound = true;

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') return;
      console.debug('[sync] immediate flush trigger', { reason: 'visibility-hidden' });
      flushPendingListOperationsToCloud('visibility-hidden').catch((error) => {
        console.warn('Visibility list sync push failed:', error);
      });
    });

    window.addEventListener('pagehide', () => {
      console.debug('[sync] immediate flush trigger', { reason: 'pagehide' });
      flushPendingListOperationsToCloud('pagehide').catch(() => {
        // best effort
      });
    });
  }

  function scheduleAutosyncFromMutation(reason = 'mutation') {
    if (!isSyncEnabled()) return;
    const pendingOperations = collectPendingSyncOperations();
    if (!pendingOperations.length) return;
    const hasNonDeleteOperation = pendingOperations.some((operation) => operation?.deleted !== true);
    const debounceMs = hasNonDeleteOperation ? 800 : LIST_DELETE_SYNC_DEBOUNCE_MS;
    console.debug('[sync] schedule mutation flush', {
      reason,
      delayMs: debounceMs,
      pendingCount: pendingOperations.length,
      deleteOnly: !hasNonDeleteOperation
    });
    clearTimeout(autosyncDebounceTimer);
    autosyncDebounceTimer = window.setTimeout(() => {
      if (isSyncTemporarilyPaused()) {
        scheduleSyncPauseRecheck();
        return;
      }
      flushPendingListOperationsToCloud(reason).catch((error) => {
        console.warn('Mutation list sync push failed:', error);
      });
    }, debounceMs);
  }

  function installMutationObservers() {
    if (mutationObserverInstalled) return;
    mutationObserverInstalled = true;

    const localProto = window.Storage?.prototype;
    if (localProto && !localProto.__bilmSyncWrapped) {
      const originalSetItem = localProto.setItem;
      const originalRemoveItem = localProto.removeItem;
      const originalClear = localProto.clear;

      localProto.setItem = function wrappedSetItem(...args) {
        const key = String(args?.[0] || '');
        const beforeRaw = key ? this.getItem(key) : null;
        const result = originalSetItem.apply(this, args);
        if (isMutationHookSuppressed()) return result;
        if (key === SYNC_META_KEY || key === SYNC_DEVICE_ID_KEY) return result;
        let listMutation = false;
        if (MERGEABLE_LIST_KEYS.has(key)) {
          const afterRaw = this.getItem(key);
          const beforeList = readJsonArray(beforeRaw);
          const afterList = readJsonArray(afterRaw);
          const beforeKeys = new Set(beforeList.map(getListItemKey).filter(Boolean));
          const afterKeys = new Set(afterList.map(getListItemKey).filter(Boolean));
          const now = Date.now();
          const meta = readSyncMeta();
          const tombstones = mergeTombstoneMaps(meta?.listTombstones, {});
          if (!tombstones[key]) tombstones[key] = {};
          beforeKeys.forEach((itemKey) => {
            if (!afterKeys.has(itemKey)) {
              tombstones[key][itemKey] = now;
            }
          });
          afterList.forEach((item) => {
            const itemKey = getListItemKey(item);
            if (itemKey && tombstones[key]?.[itemKey]) {
              delete tombstones[key][itemKey];
            }
          });
          writeSyncMeta({ listTombstones: tombstones });
          enqueueListOperations(buildListOperationsFromRaw(key, beforeRaw, afterRaw, now));
          scheduleListSyncFlush('storage-set-list');
          listMutation = true;
        } else {
          const afterRaw = this.getItem(key);
          const storageOps = buildStorageSectorOperationsFromRaw(key, beforeRaw, afterRaw, Date.now());
          if (storageOps.length) {
            enqueueSectorOperations(storageOps);
            scheduleListSyncFlush('storage-set-sector');
          }
        }
        writeSyncMeta({ lastLocalChangeAt: Date.now(), lastMutationType: 'storage-set' });
        scheduleAutosyncFromMutation(listMutation ? 'list-storage-set' : 'storage-set');
        return result;
      };
      localProto.removeItem = function wrappedRemoveItem(...args) {
        const key = String(args?.[0] || '');
        const beforeRaw = key ? this.getItem(key) : null;
        const result = originalRemoveItem.apply(this, args);
        if (isMutationHookSuppressed()) return result;
        if (key === SYNC_META_KEY || key === SYNC_DEVICE_ID_KEY) return result;
        let listMutation = false;
        if (MERGEABLE_LIST_KEYS.has(key) && beforeRaw !== null) {
          enqueueListOperations(buildListOperationsFromRaw(key, beforeRaw, '[]', Date.now()));
          scheduleListSyncFlush('storage-remove-list');
          listMutation = true;
        } else if (beforeRaw !== null) {
          const storageOps = buildStorageSectorOperationsFromRaw(key, beforeRaw, null, Date.now());
          if (storageOps.length) {
            enqueueSectorOperations(storageOps);
            scheduleListSyncFlush('storage-remove-sector');
          }
        }
        writeSyncMeta({ lastLocalChangeAt: Date.now(), lastMutationType: 'storage-remove' });
        scheduleAutosyncFromMutation(listMutation ? 'list-storage-remove' : 'storage-remove');
        return result;
      };
      localProto.clear = function wrappedClear(...args) {
        const result = originalClear.apply(this, args);
        if (isMutationHookSuppressed()) return result;
        pendingListOperations.clear();
        pendingSectorOperations.clear();
        writeSyncMeta({ lastLocalChangeAt: Date.now(), lastMutationType: 'storage-clear' });
        scheduleAutosyncFromMutation('storage-clear');
        return result;
      };

      Object.defineProperty(localProto, '__bilmSyncWrapped', {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false
      });
    }
  }

  function startAutosyncLoop() {
    stopAutosyncLoop();
    ensureSyncActivityBindings();
    recordSyncActivity();
    ensureAutosyncFlushBindings();
    autosyncInterval = window.setInterval(() => {
      if (!isSyncEnabled() || !auth?.currentUser) return;
      if (isSyncTemporarilyPaused()) {
        scheduleSyncPauseRecheck();
        return;
      }
      syncListsFromCloudNow().catch((error) => {
        console.warn('Autosync list pull failed:', error);
      });
    }, AUTOSYNC_HEARTBEAT_MS);
  }

  function stopAutosyncLoop() {
    if (autosyncInterval) {
      window.clearInterval(autosyncInterval);
      autosyncInterval = null;
    }
    clearSyncPauseRecheckTimer();
  }

  async function syncFromCloudNow(options = {}) {
    await init();
    const user = auth?.currentUser;
    if (isIncognitoSyncPaused()) return false;
    if (isSyncTemporarilyPaused()) {
      scheduleSyncPauseRecheck();
      return false;
    }
    if (user && isSyncEnabled()) {
      try {
        await ensureSectorBootstrapForUser(user);
      } catch (error) {
        console.warn('Sector bootstrap check failed:', error);
      }
    }

    let listSyncApplied = false;
    try {
      listSyncApplied = await syncListsFromCloudNow();
    } catch (error) {
      console.warn('Incremental list sync failed:', error);
      emitSyncIssue({
        scope: 'sync',
        code: error?.code || error?.error || 'sector_pull_failed',
        message: error?.message || 'Sector pull failed.',
        status: error?.status || null,
        retryable: error?.retryable !== false,
        requestId: error?.requestId || null
      });
    }
    if (!listSyncApplied && !snapshotRecoveryCheckedThisSession && user && isSyncEnabled() && !hasLocalMergeableData()) {
      snapshotRecoveryCheckedThisSession = true;
      try {
        const userId = getTransferUserId(user);
        const transferSnapshot = await loadSnapshotFromTransferApi(user, userId);
        const firestoreSnapshot = await readFirebaseBackupSnapshot(user);
        const selected = choosePreferredCloudSnapshot(transferSnapshot, firestoreSnapshot);
        if (shouldApplyRemoteSnapshot(selected.snapshot)) {
          applyRemoteSnapshot(selected.snapshot, {
            reason: 'snapshot-recovery',
            source: selected.source
          });
        }
      } catch (error) {
        console.warn('One-shot snapshot recovery check failed:', error);
      }
    }
    const meta = readSyncMeta();
    if (meta?.cloudDriftRepairPending === true) {
      void runOneShotDriftRepairPullIfNeeded({
        detected: true,
        detectedAtMs: Number(meta?.lastCloudDriftDetectedAt || 0) || Date.now()
      }, 'sync-loop');
    }
    return listSyncApplied;
  }

  function emitCloudSnapshotEvent(event) {
    lastCloudSnapshotEvent = event;
    cloudSubscribers.forEach((callback) => {
      try {
        callback(event);
      } catch (error) {
        console.error('Cloud snapshot subscriber failed:', error);
      }
    });
  }

  function stopCloudSnapshotListener() {
    if (typeof cloudSnapshotUnsubscribe === 'function') {
      cloudSnapshotUnsubscribe();
    }
    cloudSnapshotUnsubscribe = null;
  }

  function startCloudSnapshotListener(user) {
    stopCloudSnapshotListener();
    snapshotListenerReady = false;
    if (!user || !modules?.onSnapshot || !firestore) {
      emitCloudSnapshotEvent({ snapshot: null, updatedAtMs: null, user: null });
      return;
    }

    const userDocRef = modules.doc(firestore, 'users', user.uid);
    cloudSnapshotUnsubscribe = modules.onSnapshot(userDocRef, { includeMetadataChanges: false }, (docSnap) => {
      const data = docSnap.data() || {};
      const cloudBackup = data.cloudBackup || {};
      const event = {
        snapshot: cloudBackup.snapshot || null,
        updatedAtMs: cloudBackup.updatedAt?.toMillis?.() || null,
        hasPendingWrites: docSnap.metadata?.hasPendingWrites === true,
        fromCache: docSnap.metadata?.fromCache === true,
        sourceDeviceId: String(cloudBackup?.snapshot?.meta?.deviceId || '').trim() || null,
        user
      };
      snapshotListenerReady = true;
      emitCloudSnapshotEvent(event);
    }, (error) => {
      console.warn('Cloud snapshot listener failed:', error);
    });
  }


  function notifySubscribers(user) {
    subscribers.forEach((callback) => {
      try {
        callback(user);
      } catch (error) {
        console.error('Auth subscriber failed:', error);
      }
    });
  }

  function normalizeUsername(username) {
    return String(username || '').trim().toLowerCase();
  }

  async function resolveEmailFromIdentifier(identifier) {
    const cleaned = String(identifier || '').trim();
    if (!cleaned) throw new Error('Email or username is required.');
    if (cleaned.includes('@')) return cleaned;
    const usernameKey = normalizeUsername(cleaned);
    if (!usernameKey) throw new Error('Email or username is required.');
    const usernameDoc = await modules.getDoc(modules.doc(firestore, 'usernames', usernameKey));
    const mappedUid = String(usernameDoc.data()?.uid || '').trim();
    if (!mappedUid) throw new Error('Email or password is incorrect.');
    const userDoc = await modules.getDoc(modules.doc(firestore, 'users', mappedUid));
    const email = String(userDoc.data()?.profile?.email || '').trim();
    if (!email) throw new Error('Email or password is incorrect.');
    return email;
  }

  async function loadFirebaseModules() {
    if (modules) return modules;
    const [appModule, authModule, firestoreModule] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`)
    ]);

    let analyticsModule = {};
    try {
      analyticsModule = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-analytics.js`);
    } catch (error) {
      console.warn('Firebase Analytics module unavailable:', error);
    }

    modules = {
      ...appModule,
      ...authModule,
      ...firestoreModule,
      ...analyticsModule
    };
    return modules;
  }



  function getFirestoreInstance() {
    return firestore;
  }
  async function init() {
    if (initPromise) return initPromise;

    initPromise = (async () => {
      try {
        const m = await loadFirebaseModules();
        app = m.getApps().length ? m.getApp() : m.initializeApp(FIREBASE_CONFIG);
        auth = m.getAuth(app);
        firestore = m.getFirestore(app);
        installMutationObservers();
        await configurePersistence();

        try {
          analytics = m.getAnalytics(app);
        } catch {
          analytics = null;
        }

        m.onAuthStateChanged(auth, (user) => {
          const previousUserId = getSyncScopeUserId(currentUser);
          const nextUserId = getSyncScopeUserId(user);
          if (previousUserId !== nextUserId) {
            clearPendingSyncStateForAuthChange('auth-state-user-change');
          }
          currentUser = user || null;
          snapshotRecoveryCheckedThisSession = false;
          sectorBootstrapCheckedThisSession = false;
          startCloudSnapshotListener(currentUser);
          scheduleNextAutomaticFirebaseBackup();
          if (currentUser && isSyncEnabled()) {
            syncFromCloudNow({ source: 'auth-state' }).catch((error) => {
              console.warn('Cloud import failed:', error);
            });
            runAutomaticFirebaseBackupIfDue('auth-state').catch((error) => {
              console.warn('Startup Firebase backup check failed:', error);
            });
            startAutosyncLoop();
          } else {
            snapshotListenerReady = false;
            stopAutosyncLoop();
            clearFirebaseAutoBackupTimer();
          }
          notifySubscribers(currentUser);
        });

        return { auth, firestore, analytics };
      } catch (error) {
        initPromise = null;
        throw error;
      }
    })();

    return initPromise;
  }

  async function requireAuth() {
    await init();
    if (!auth.currentUser) {
      throw new Error('You must be logged in for cloud sync.');
    }
    return auth.currentUser;
  }


  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function enhanceAuthError(error) {
    const code = String(error?.code || '').toLowerCase();
    if (code === 'auth/network-request-failed') {
      error.message = 'Network request failed. Check your connection, disable VPN/content blockers, and try again.';
    } else if (code === 'auth/invalid-email') {
      error.message = 'Enter a valid email address.';
    } else if (code === 'auth/operation-not-supported-in-this-environment') {
      error.message = 'This browser blocked secure account storage. Disable private mode or content blockers and refresh.';
    } else if (code === 'auth/too-many-requests') {
      error.message = 'Too many attempts. Wait a minute, then try again.';
    } else if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
      error.message = 'Email or password is incorrect.';
    }
    return error;
  }

  async function configurePersistence() {
    if (!modules?.setPersistence || !auth) return;
    const candidates = [
      modules.indexedDBLocalPersistence,
      modules.browserLocalPersistence,
      modules.browserSessionPersistence,
      modules.inMemoryPersistence
    ].filter(Boolean);

    for (const candidate of candidates) {
      try {
        await modules.setPersistence(auth, candidate);
        return;
      } catch (error) {
        console.warn('Auth persistence unavailable, trying fallback:', error?.code || error?.message || error);
      }
    }
  }


  function withTimeout(taskPromise, timeoutMs, timeoutMessage) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    });
    return Promise.race([taskPromise, timeout]).finally(() => clearTimeout(timer));
  }

  async function withAuthRetry(task) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await withTimeout(
          task(),
          45000,
          'Account request timed out. Check your connection, disable blockers/VPN, and try again.'
        );
      } catch (error) {
        lastError = enhanceAuthError(error);
        const code = String(error?.code || '').toLowerCase();
        const transient = code === 'auth/network-request-failed' || code === 'auth/internal-error';
        if (!transient || attempt === 1) {
          throw lastError;
        }
        await sleep(350 * (attempt + 1));
      }
    }
    throw enhanceAuthError(lastError || new Error('Auth request failed.'));
  }

  const api = {
    init,
    getFirestore() {
      return getFirestoreInstance();
    },
    async signUp(email, password) {
      await init();
      return withAuthRetry(() => modules.createUserWithEmailAndPassword(auth, String(email || '').trim(), password));
    },
    async signUpWithUsername({ email, password, username }) {
      await init();
      const cleanedEmail = String(email || '').trim();
      const cleanedUsername = String(username || '').trim();
      const credential = await withAuthRetry(() => modules.createUserWithEmailAndPassword(auth, cleanedEmail, password));
      if (cleanedUsername) {
        await api.setUsername(cleanedUsername);
      }
      await modules.setDoc(modules.doc(firestore, 'users', credential.user.uid), {
        profile: {
          email: cleanedEmail,
          updatedAt: modules.serverTimestamp()
        }
      }, { merge: true });
      return credential;
    },
    async signIn(email, password) {
      await init();
      return withAuthRetry(() => modules.signInWithEmailAndPassword(auth, String(email || '').trim(), password));
    },
    async signInWithIdentifier(identifier, password) {
      await init();
      const resolvedEmail = await resolveEmailFromIdentifier(identifier);
      return withAuthRetry(() => modules.signInWithEmailAndPassword(auth, resolvedEmail, password));
    },
    async setUsername(username) {
      await init();
      const user = await requireAuth();
      const cleaned = String(username || '').trim();
      if (cleaned.length > 30) throw new Error('Username must be 30 characters or fewer.');

      const normalizedNext = normalizeUsername(cleaned);
      const normalizedPrev = normalizeUsername(user.displayName);
      const nextRef = normalizedNext ? modules.doc(firestore, 'usernames', normalizedNext) : null;
      const prevRef = normalizedPrev ? modules.doc(firestore, 'usernames', normalizedPrev) : null;

      if (nextRef && normalizedNext !== normalizedPrev) {
        const takenDoc = await modules.getDoc(nextRef);
        const existingUid = String(takenDoc.data()?.uid || '').trim();
        if (existingUid && existingUid !== user.uid) {
          throw new Error('That username is already taken. Please choose another.');
        }
      }

      await modules.updateProfile(user, { displayName: cleaned || null });
      await modules.setDoc(modules.doc(firestore, 'users', user.uid), {
        profile: {
          username: cleaned || null,
          email: user.email || null,
          updatedAt: modules.serverTimestamp()
        }
      }, { merge: true });

      if (prevRef && normalizedPrev !== normalizedNext) {
        try {
          const previousDoc = await modules.getDoc(prevRef);
          const previousUid = String(previousDoc.data()?.uid || '').trim();
          if (previousUid === user.uid) {
            await modules.deleteDoc(prevRef);
          }
        } catch (error) {
          console.warn('Previous username cleanup skipped:', error);
        }
      }

      if (nextRef) {
        await modules.setDoc(nextRef, {
          uid: user.uid,
          username: cleaned,
          updatedAt: modules.serverTimestamp()
        }, { merge: true });
      }

      currentUser = { ...user, displayName: cleaned || null };
      notifySubscribers(auth.currentUser || currentUser);
      return cleaned;
    },
    async reauthenticate(password) {
      await init();
      const user = await requireAuth();
      const credential = modules.EmailAuthProvider.credential(user.email, password);
      return modules.reauthenticateWithCredential(user, credential);
    },
    async deleteAccount(password) {
      await init();
      const user = await requireAuth();
      if (!password) throw new Error('Password is required to delete your account.');
      await api.reauthenticate(password);

      const usernameKey = normalizeUsername(user.displayName);
      const usernameRef = usernameKey ? modules.doc(firestore, 'usernames', usernameKey) : null;

      await modules.deleteDoc(modules.doc(firestore, 'users', user.uid));
      if (usernameRef) {
        try {
          const usernameDoc = await modules.getDoc(usernameRef);
          const mappedUid = String(usernameDoc.data()?.uid || '').trim();
          if (mappedUid === user.uid) {
            await modules.deleteDoc(usernameRef);
          }
        } catch (error) {
          console.warn('Username cleanup during delete skipped:', error);
        }
      }
      await modules.deleteUser(user);
    },
    async signOut() {
      await init();
      return modules.signOut(auth);
    },
    getCurrentUser() {
      return auth?.currentUser || currentUser;
    },
    isSyncPausedNow() {
      return isSyncTemporarilyPaused();
    },
    noteUserActivity(_source = 'manual') {
      const wasPaused = isSyncTemporarilyPaused();
      recordSyncActivity();
      if (!wasPaused || isSyncTemporarilyPaused()) return;
      clearSyncPauseRecheckTimer();
      if (!isSyncEnabled() || !auth?.currentUser) return;
      syncListsFromCloudNow().catch((error) => {
        console.warn('Manual activity resume pull failed:', error);
      });
      flushPendingListOperationsToCloud('activity-resume').catch((error) => {
        console.warn('Manual activity resume flush failed:', error);
      });
    },
    onAuthStateChanged(callback) {
      subscribers.add(callback);
      if (currentUser !== null) callback(currentUser);
      return () => subscribers.delete(callback);
    },
    onCloudSnapshotChanged(callback) {
      cloudSubscribers.add(callback);
      if (lastCloudSnapshotEvent) callback(lastCloudSnapshotEvent);
      return () => cloudSubscribers.delete(callback);
    },
    onSyncIssue(callback) {
      if (typeof callback !== 'function') return () => {};
      syncIssueSubscribers.add(callback);
      return () => syncIssueSubscribers.delete(callback);
    },
    onListSyncApplied(callback) {
      if (typeof callback !== 'function') return () => {};
      listSyncAppliedSubscribers.add(callback);
      return () => listSyncAppliedSubscribers.delete(callback);
    },
    async saveCloudSnapshot(snapshot, options = {}) {
      assertIncognitoSyncAllowed('save cloud backup');
      const user = await requireAuth();
      const mirrorToFirebase = options?.mirrorToFirebase === true;
      const mirrorReason = String(options?.mirrorReason || 'manual-save');
      const nowMs = Date.now();
      const baseSnapshot = snapshot && snapshot.schema === 'bilm-backup-v1'
        ? snapshot
        : collectBackupData();
      const payload = {
        ...(baseSnapshot || {}),
        meta: {
          ...(baseSnapshot?.meta || {}),
          updatedAtMs: nowMs,
          deviceId: getOrCreateDeviceId(),
          version: 1
        }
      };
      const signature = snapshotSignature(payload);
      lastAppliedCloudSignature = signature;
      lastUploadedCloudSignature = signature;

      const userId = getTransferUserId(user);
      let savedToTransferApi = false;
      let lastTransferError = null;
      let firebaseMirrored = false;
      const firebaseSnapshot = mirrorToFirebase ? buildFirebaseMirrorSnapshot(payload) : null;
      try {
        await saveSnapshotToTransferApi(user, userId, payload);
        savedToTransferApi = true;
      } catch (error) {
        lastTransferError = error;
        console.warn('Data API save failed:', error);
      }

      if (mirrorToFirebase && modules?.setDoc && modules?.doc && firestore && firebaseSnapshot) {
        try {
          await modules.setDoc(modules.doc(firestore, 'users', user.uid), {
            cloudBackup: {
              schema: 'bilm-cloud-sync-v1',
              updatedAt: modules.serverTimestamp(),
              snapshot: firebaseSnapshot,
              transferApiMirrored: savedToTransferApi
            }
          }, { merge: true });
          firebaseMirrored = true;
        } catch (firebaseError) {
          console.warn('Firebase backup write failed during cloud snapshot save:', firebaseError);
          if (!savedToTransferApi) {
            throw firebaseError;
          }
        }
      } else if (mirrorToFirebase && !firebaseSnapshot) {
        console.warn('Firebase backup mirror skipped: snapshot exceeded safe size limits.');
      }

      if (!savedToTransferApi && !firebaseMirrored) {
        if (lastTransferError) throw lastTransferError;
        const error = new Error('Cloud snapshot save failed.');
        error.code = 'cloud_snapshot_save_failed';
        throw error;
      }

      writeSyncMeta({
        lastCloudPushAt: nowMs,
        lastLocalChangeAt: nowMs,
        ...(firebaseMirrored ? {
          lastFirebaseMirrorAtMs: nowMs,
          lastFirebaseMirrorReason: mirrorReason,
          lastFirebaseMirrorSource: 'save-cloud-snapshot'
        } : {})
      });
    },
    async getCloudSnapshot(options = {}) {
      assertIncognitoSyncAllowed('load cloud backup');
      const user = await requireAuth();
      const userId = getTransferUserId(user);
      const mode = String(options?.mode || 'data-api-primary-fallback-firestore').trim().toLowerCase();
      const includeSource = options?.includeSource === true;
      let transferSnapshot = null;
      let transferError = null;
      try {
        transferSnapshot = await loadSnapshotFromTransferApi(user, userId);
      } catch (error) {
        transferError = error;
        console.warn('Data API load failed (falling back to backup source):', error);
      }
      const firestoreSnapshot = await readFirebaseBackupSnapshot(user);
      const transferItemCount = transferSnapshot && transferSnapshot.schema === 'bilm-backup-v1'
        ? getSnapshotMergeableItemCount(transferSnapshot)
        : 0;
      const firestoreItemCount = firestoreSnapshot && firestoreSnapshot.schema === 'bilm-backup-v1'
        ? getSnapshotMergeableItemCount(firestoreSnapshot)
        : 0;

      let selected;
      if (mode === 'data-api-only' || mode === 'dataapi-only') {
        selected = {
          snapshot: transferSnapshot && transferSnapshot.schema === 'bilm-backup-v1' ? transferSnapshot : null,
          source: transferSnapshot && transferSnapshot.schema === 'bilm-backup-v1' ? 'data-api' : 'none',
          reason: transferSnapshot && transferSnapshot.schema === 'bilm-backup-v1' ? 'data_api_only' : 'no_snapshot',
          transferItemCount,
          firestoreItemCount
        };
      } else if (mode === 'firestore-only' || mode === 'firebase-only') {
        selected = {
          snapshot: firestoreSnapshot && firestoreSnapshot.schema === 'bilm-backup-v1' ? firestoreSnapshot : null,
          source: firestoreSnapshot && firestoreSnapshot.schema === 'bilm-backup-v1' ? 'firestore-fallback' : 'none',
          reason: firestoreSnapshot && firestoreSnapshot.schema === 'bilm-backup-v1' ? 'firestore_only' : 'no_snapshot',
          transferItemCount,
          firestoreItemCount
        };
      } else {
        selected = choosePreferredCloudSnapshot(transferSnapshot, firestoreSnapshot);
      }

      const snapshot = selected.snapshot;
      const source = selected.source;
      const driftState = evaluateCloudSnapshotDrift(transferSnapshot, firestoreSnapshot, source);
      if (driftState.detected) {
        void runOneShotDriftRepairPullIfNeeded(driftState, `snapshot:${source}`);
      }
      return includeSource
        ? {
          snapshot,
          source,
          transferError,
          driftDetected: driftState.detected,
          selectionReason: selected.reason,
          transferItemCount: selected.transferItemCount,
          firestoreItemCount: selected.firestoreItemCount
        }
        : snapshot;
    },
    async syncFromCloudNow(options = {}) {
      await init();
      if (isIncognitoSyncPaused()) return false;
      return syncFromCloudNow(options);
    },
    async pullChatNow(options = {}) {
      await init();
      if (isIncognitoSyncPaused()) {
        throw buildIncognitoPausedError('sync chat');
      }
      const user = await requireAuth();
      const userId = getTransferUserId(user);
      const sinceMs = normalizeOperationUpdatedAt(options?.sinceMs, getChatSyncCursorMs());
      const limit = Math.max(1, Math.min(500, Number(options?.limit || 120) || 120));
      try {
        const payload = await pullSectorOperationsFromTransferApi(user, userId, {
          sinceMs,
          limit,
          sectors: ['chat_messages'],
          allowLegacyListFallback: false
        });
        const rawOps = Array.isArray(payload?.operations) ? payload.operations : [];
        const chatOps = rawOps
          .map((operation) => toListOperation(operation))
          .filter((operation) => String(operation?.listKey || '').trim() === 'bilm-shared-chat');
        const applied = chatOps.length ? applyListOperationsToLocalStorage(chatOps) : false;
        const cursorMs = Math.max(
          normalizeOperationUpdatedAt(payload?.cursorMs, sinceMs),
          chatOps.reduce((max, operation) => Math.max(max, normalizeOperationUpdatedAt(operation?.updatedAtMs, 0)), 0)
        );
        if (cursorMs > 0) setChatSyncCursorMs(cursorMs);
        lastChatSyncPullAt = Date.now();
        lastChatSyncError = null;
        return {
          ok: true,
          applied,
          operations: chatOps,
          cursorMs,
          state: payload?.state || null,
          requestId: payload?.requestId || null
        };
      } catch (error) {
        lastChatSyncError = {
          code: String(error?.code || error?.error || 'chat_pull_failed'),
          message: String(error?.message || 'Chat pull failed.'),
          status: Number(error?.status || 0) || null,
          retryable: error?.retryable !== false,
          requestId: String(error?.requestId || '').trim() || null,
          atMs: Date.now()
        };
        throw error;
      }
    },
    getChatSyncState() {
      return {
        cursorMs: getChatSyncCursorMs(),
        lastPullAt: lastChatSyncPullAt || null,
        lastError: lastChatSyncError
      };
    },
    async flushSyncNow(reason = 'manual') {
      if (isIncognitoSyncPaused()) {
        throw buildIncognitoPausedError('sync now');
      }
      const pushed = await flushPendingListOperationsToCloud(reason);
      const pulled = await syncListsFromCloudNow();
      return pushed || pulled;
    },
    async pushSectorOperationsNow(operations = [], reason = 'manual') {
      await init();
      if (isIncognitoSyncPaused()) {
        throw buildIncognitoPausedError('push cloud updates');
      }
      const user = await requireAuth();
      const userId = getTransferUserId(user);
      const normalizedOperations = (Array.isArray(operations) ? operations : [])
        .map((operation) => toSectorOperation(operation))
        .filter(Boolean);
      if (!normalizedOperations.length) {
        return { ok: true, processed: 0, cursorMs: getListSyncCursorMs() };
      }
      const response = await pushListOperationsToTransferApi(user, userId, normalizedOperations);
      const maxUpdatedAt = normalizedOperations.reduce((max, operation) => Math.max(max, normalizeOperationUpdatedAt(operation?.updatedAtMs, 0)), 0);
      const cursorMs = Math.max(normalizeOperationUpdatedAt(response?.cursorMs, 0), maxUpdatedAt);
      if (cursorMs > 0) setListSyncCursorMs(cursorMs);
      writeSyncMeta({
        lastListSyncPushAt: Date.now(),
        lastListSyncPushReason: reason
      });
      void mirrorSnapshotToFirebaseIfDue(`sector-sync:${reason}`);
      return response;
    },
    async scheduleCloudSave(reason = 'manual') {
      if (isIncognitoSyncPaused()) {
        throw buildIncognitoPausedError('schedule cloud save');
      }
      return flushPendingListOperationsToCloud(reason);
    },
    withMutationSuppressed(task) {
      return withMutationSuppressed(task);
    },
    async applyImportedBackupSnapshot(snapshot, options = {}) {
      if (!snapshot || snapshot.schema !== 'bilm-backup-v1') {
        throw new Error('Invalid backup snapshot schema.');
      }
      const reason = String(options?.reason || options?.source || 'import').trim() || 'import';
      const preserveSyncPreference = options?.preserveSyncPreference !== false;
      const preserveSyncMeta = options?.preserveSyncMeta !== false;
      const applied = applySnapshotTransaction(snapshot, {
        reason,
        preserveSyncPreference,
        preserveSyncMeta
      });
      if (!applied) {
        throw new Error('Failed to apply imported backup snapshot.');
      }
      return {
        ok: true,
        reason,
        appliedAtMs: Date.now()
      };
    },
    getFirebaseBackupStatus() {
      return getFirebaseBackupStatus();
    },
    async runManualFirebaseBackup(options = {}) {
      assertIncognitoSyncAllowed('run manual Firebase backup');
      await init();
      await requireAuth();
      const reason = String(options?.reason || 'manual-backup').trim() || 'manual-backup';
      const source = String(options?.source || 'manual-ui').trim() || 'manual-ui';
      return writeFirebaseBackupSnapshot({
        reason,
        source,
        mode: 'manual',
        respectManualCooldown: true
      });
    }
  };
  Object.defineProperty(window, 'bilmAuthModules', {
    configurable: true,
    enumerable: false,
    get() {
      if (!modules) return null;
      return {
        addDoc: modules.addDoc,
        collection: modules.collection,
        deleteDoc: modules.deleteDoc,
        doc: modules.doc,
        getFirestore: () => firestore,
        limit: modules.limit,
        onSnapshot: modules.onSnapshot,
        orderBy: modules.orderBy,
        query: modules.query
      };
    }
  });

  window.bilmAuth = api;
})();

