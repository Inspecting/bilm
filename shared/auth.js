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

  let transferApiDisabled = localStorage.getItem(TRANSFER_API_DISABLE_KEY) === '1';

  function getTransferUserId(user) {
    const uid = String(user?.uid || '').trim();
    if (!uid) throw new Error('Missing account identifier for cloud transfer.');
    // The transfer API already namespaces user IDs with "user-" internally.
    return uid.replace(/^user-/i, '');
  }

  function disableTransferApi(reason) {
    if (transferApiDisabled) return;
    transferApiDisabled = true;
    try {
      localStorage.setItem(TRANSFER_API_DISABLE_KEY, '1');
    } catch {}
    console.warn(`Data API disabled for this browser session (${reason}). Using Firestore fallback.`);
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
      data: normalizedSnapshot,
      value: JSON.stringify(normalizedSnapshot)
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
      const detail = await response.text().catch(() => '');
      throw new Error(`Data API save failed (${response.status})${detail ? `: ${detail.slice(0, 160)}` : ''}`);
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
      const detail = await response.text().catch(() => '');
      throw new Error(`Data API load failed (${response.status})${detail ? `: ${detail.slice(0, 160)}` : ''}`);
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
      const legacyResponse = await fetch(`${DATA_API_BASE}${LIST_SYNC_PUSH_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization
        },
        body: JSON.stringify({
          userId,
          deviceId: getOrCreateDeviceId(),
          operations
        })
      });
      if (!legacyResponse.ok) {
        throw await parseTransferError(legacyResponse);
      }
      return await legacyResponse.json();
    }

    if (!response.ok) {
      throw await parseTransferError(response);
    }
    return await response.json();
  }

  async function pullListOperationsFromTransferApi(user, userId, sinceMs = 0, limit = 250) {
    if (transferApiDisabled) return null;
    const pullUrl = new URL(`${DATA_API_BASE}${SECTOR_SYNC_PULL_PATH}`);
    pullUrl.searchParams.set('userId', userId);
    pullUrl.searchParams.set('since', String(Math.max(0, Number(sinceMs || 0) || 0)));
    pullUrl.searchParams.set('limit', String(Math.max(1, Math.min(500, Number(limit || 250) || 250))));
    pullUrl.searchParams.set('sectors', Object.values(LIST_KEY_TO_SECTOR_KEY).filter((sector, index, all) => all.indexOf(sector) === index).join(','));
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

    if (response.status === 404) {
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
        throw await parseTransferError(legacyResponse);
      }
      return await legacyResponse.json();
    }
    if (!response.ok) {
      throw await parseTransferError(response);
    }
    const payload = await response.json();
    const converted = Array.isArray(payload?.operations)
      ? payload.operations.map((operation) => toListOperation(operation)).filter(Boolean)
      : [];
    return {
      ...payload,
      operations: converted
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
      throw await parseTransferError(response);
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
  let lastUploadedCloudSignature = '';
  let lastLocalSnapshotSignature = '';
  let lastSaveAttemptAt = 0;
  let snapshotListenerReady = false;

  const MIN_SAVE_INTERVAL_MS = 15000;
  const AUTOSYNC_HEARTBEAT_MS = 15000;
  const LIST_SYNC_DEBOUNCE_MS = 500;
  const LIST_SYNC_CURSOR_META_KEY = 'lastListSyncCursorMs';
  const LIST_SYNC_MIGRATED_META_KEY = 'sectorMigrationCompletedAtMs';

  const SYNC_ENABLED_KEY = 'bilm-sync-enabled';
  const SYNC_META_KEY = 'bilm-sync-meta';
  const SYNC_DEVICE_ID_KEY = 'bilm-sync-device-id';
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
    /^tmdb-/,
    /^theme-/
  ];
  const LOCAL_ONLY_LOCAL_STORAGE_KEYS = new Set([
    'bilm-global-message-dismissed-migrating-data'
  ]);
  const BACKUP_SESSION_ALLOWLIST = [
    /^bilm-/,
    /^tmdb-/
  ];
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
  let lastAppliedCloudSignature = '';
  const pendingListOperations = new Map();
  const syncIssueSubscribers = new Set();
  const listSyncAppliedSubscribers = new Set();
  let listSyncRetryTimer = null;
  let listSyncRetryDelayMs = 0;

  function readJsonArray(raw) {
    try {
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
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

  function normalizeOperationUpdatedAt(value, fallback = Date.now()) {
    const parsed = Number(value || 0);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
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

  function createOperationId(prefix = 'op') {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function toSectorOperation(operation) {
    const listKey = String(operation?.listKey || '').trim();
    const sectorKey = listKeyToSectorKey(listKey);
    if (!sectorKey) return null;
    const itemKey = String(operation?.itemKey || '').trim();
    if (!itemKey) return null;
    const normalized = {
      sectorKey,
      itemKey,
      deleted: operation?.deleted === true,
      updatedAtMs: normalizeOperationUpdatedAt(operation?.updatedAtMs),
      opId: String(operation?.opId || '').trim() || createOperationId('sec')
    };
    if (!normalized.deleted) {
      const payload = normalizeListOperationPayload(operation?.payload, normalized.updatedAtMs);
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
      updatedAtMs: normalizeOperationUpdatedAt(operation?.updatedAtMs, 0)
    };
    if (!normalized.deleted) {
      const payload = normalizeListOperationPayload(operation?.payload, normalized.updatedAtMs);
      if (!payload) return null;
      normalized.payload = payload;
    }
    return normalized;
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

  function getListSyncCursorMs() {
    const meta = readSyncMeta();
    return normalizeOperationUpdatedAt(meta?.[LIST_SYNC_CURSOR_META_KEY], 0);
  }

  function setListSyncCursorMs(nextCursorMs) {
    const current = getListSyncCursorMs();
    const next = Math.max(current, normalizeOperationUpdatedAt(nextCursorMs, 0));
    writeSyncMeta({ [LIST_SYNC_CURSOR_META_KEY]: next });
    return next;
  }

  function hasSectorMigrationCompleted() {
    const meta = readSyncMeta();
    return normalizeOperationUpdatedAt(meta?.[LIST_SYNC_MIGRATED_META_KEY], 0) > 0;
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

  async function ensureSectorBootstrapForUser(user) {
    if (!user || transferApiDisabled || !isSyncEnabled()) return false;
    if (hasSectorMigrationCompleted()) return false;

    const userId = getTransferUserId(user);
    let existingState = null;
    try {
      const seedPull = await pullListOperationsFromTransferApi(user, userId, 0, 1);
      existingState = seedPull?.state || null;
      if (Number(existingState?.migratedAtMs || 0) > 0 || (seedPull?.operations?.length || 0) > 0) {
        writeSyncMeta({
          [LIST_SYNC_MIGRATED_META_KEY]: Number(existingState?.migratedAtMs || Date.now()) || Date.now()
        });
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
      if (transferSnapshot) {
        operations = listOperationsFromSnapshot(transferSnapshot, nowMs);
        migrationSource = 'd1_snapshot';
      } else {
        const firebaseSnapshot = await readFirebaseBackupSnapshot(user);
        if (firebaseSnapshot) {
          operations = listOperationsFromSnapshot(firebaseSnapshot, nowMs);
          migrationSource = 'firebase_snapshot';
        }
      }
    } catch (error) {
      console.warn('Cloud snapshot bootstrap source unavailable, using local fallback:', error);
    }

    if (!operations.length) {
      operations = listOperationsFromSnapshot(collectBackupData(), nowMs);
      migrationSource = 'local_fallback';
    }

    try {
      const response = await bootstrapSectorOperationsToTransferApi(user, userId, operations, migrationSource);
      if (response?.ok) {
        writeSyncMeta({
          [LIST_SYNC_MIGRATED_META_KEY]: Number(response?.state?.migratedAtMs || Date.now()) || Date.now()
        });
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
      const filtered = [...byKey.entries()]
        .filter(([itemKey, item]) => (Number(keyedTombstones[itemKey] || 0) || 0) < getItemUpdatedAt(item))
        .sort((a, b) => getItemUpdatedAt(b[1]) - getItemUpdatedAt(a[1]))
        .map(([, item]) => item)
        .slice(0, 120);

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

  function shouldIncludeStorageKey(key, allowlist) {
    return allowlist.some((pattern) => pattern.test(String(key || '')));
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
      all[key] = value;
      return all;
    }, {});
  }

  function collectBackupData() {
    const meta = readSyncMeta();
    const localState = readStorage(localStorage, BACKUP_LOCAL_ALLOWLIST);
    delete localState[SYNC_ENABLED_KEY];
    delete localState[SYNC_META_KEY];
    delete localState[SYNC_DEVICE_ID_KEY];
    LOCAL_ONLY_LOCAL_STORAGE_KEYS.forEach((key) => {
      delete localState[key];
    });
    return {
      schema: 'bilm-backup-v1',
      exportedAt: new Date().toISOString(),
      origin: location.origin,
      pathname: location.pathname,
      localStorage: localState,
      sessionStorage: readStorage(sessionStorage, BACKUP_SESSION_ALLOWLIST),
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

  function applyRemoteSnapshot(snapshot) {
    if (!snapshot || snapshot.schema !== 'bilm-backup-v1') return;
    try {
      suppressMutationHook = true;
      const syncPreference = localStorage.getItem(SYNC_ENABLED_KEY);
      const syncMetaRaw = localStorage.getItem(SYNC_META_KEY);
      const deviceIdRaw = localStorage.getItem(SYNC_DEVICE_ID_KEY);
      const localOnlyState = captureLocalOnlyStorageState();
      localStorage.clear();
      sessionStorage.clear();

      Object.entries(snapshot.localStorage || {}).forEach(([key, value]) => {
        localStorage.setItem(key, value);
      });
      Object.entries(snapshot.sessionStorage || {}).forEach(([key, value]) => {
        sessionStorage.setItem(key, value);
      });

      if (syncPreference === '0') {
        localStorage.setItem(SYNC_ENABLED_KEY, '0');
      }

      if (syncMetaRaw) localStorage.setItem(SYNC_META_KEY, syncMetaRaw);
      if (deviceIdRaw) localStorage.setItem(SYNC_DEVICE_ID_KEY, deviceIdRaw);
      restoreLocalOnlyStorageState(localOnlyState);

      writeSyncMeta({
        lastCloudPullAt: Date.now(),
        lastCloudSnapshotAt: Number(snapshot?.meta?.updatedAtMs || 0) || Date.now(),
        lastAppliedFromDeviceId: snapshot?.meta?.deviceId || null
      });

      const signature = snapshotSignature(snapshot);
      lastAppliedCloudSignature = signature;
      lastUploadedCloudSignature = signature;
      lastLocalSnapshotSignature = signature;
    } catch (error) {
      console.warn('Applying cloud snapshot failed:', error);
    } finally {
      suppressMutationHook = false;
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

  function shouldApplyRemoteSnapshot(snapshot) {
    if (!snapshot || snapshot.schema !== 'bilm-backup-v1') return false;
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

  async function saveLocalSnapshotToCloud(reason = 'auto') {
    await init();
    const user = auth?.currentUser;
    const forceReasons = new Set(['manual', 'pagehide', 'visibility-hidden']);
    if (!user || !isSyncEnabled() || pendingAutosync) return false;
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

        const nextList = [...byKey.values()]
          .sort((left, right) => getItemUpdatedAt(right) - getItemUpdatedAt(left))
          .slice(0, 120);
        localStorage.setItem(listKey, JSON.stringify(nextList));
      });
    } finally {
      suppressMutationHook = false;
    }

    writeSyncMeta({ lastCloudPullAt: Date.now() });
    emitListSyncApplied({
      listKeys: [...grouped.keys()],
      atMs: Date.now()
    });
    return true;
  }

  function clearListSyncRetryTimer() {
    if (listSyncRetryTimer) {
      window.clearTimeout(listSyncRetryTimer);
      listSyncRetryTimer = null;
    }
  }

  function scheduleListSyncRetry(error, operations = []) {
    clearListSyncRetryTimer();
    listSyncRetryDelayMs = listSyncRetryDelayMs > 0
      ? Math.min(60000, listSyncRetryDelayMs * 2)
      : 1200;
    const jitterMs = Math.floor(Math.random() * 450);
    const nextDelay = listSyncRetryDelayMs + jitterMs;
    const hasChatOperations = operations.some((operation) => String(operation?.listKey || '').trim() === 'bilm-shared-chat');
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

  function scheduleListSyncFlush(reason = 'list-mutation') {
    if (!isSyncEnabled()) return;
    clearListSyncRetryTimer();
    clearTimeout(listSyncDebounceTimer);
    listSyncDebounceTimer = window.setTimeout(() => {
      flushPendingListOperationsToCloud(reason).catch((error) => {
        console.warn('List sync push failed:', error);
      });
    }, LIST_SYNC_DEBOUNCE_MS);
  }

  async function flushPendingListOperationsToCloud(reason = 'list-mutation') {
    await init();
    const user = auth?.currentUser;
    if (!user || !isSyncEnabled() || pendingListSync || transferApiDisabled) return false;
    if (pendingListOperations.size === 0) return false;

    const batchEntries = [...pendingListOperations.entries()];
    const operations = batchEntries.map(([, operation]) => operation);
    if (!operations.length) return false;

    pendingListSync = true;
    try {
      const userId = getTransferUserId(user);
      const response = await pushListOperationsToTransferApi(user, userId, operations);
      batchEntries.forEach(([key, operation]) => {
        if (pendingListOperations.get(key) === operation) {
          pendingListOperations.delete(key);
        }
      });
      const maxUpdatedAt = operations.reduce((max, operation) => Math.max(max, normalizeOperationUpdatedAt(operation?.updatedAtMs, 0)), 0);
      const cursorMs = Math.max(
        normalizeOperationUpdatedAt(response?.cursorMs, 0),
        maxUpdatedAt
      );
      if (cursorMs > 0) {
        setListSyncCursorMs(cursorMs);
      }
      writeSyncMeta({
        lastListSyncPushAt: Date.now(),
        lastListSyncPushReason: reason
      });
      listSyncRetryDelayMs = 0;
      clearListSyncRetryTimer();
      return true;
    } catch (error) {
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

    const userId = getTransferUserId(user);
    let sinceMs = getListSyncCursorMs();
    let pages = 0;
    let applied = false;

    while (pages < 4) {
      pages += 1;
      const response = await pullListOperationsFromTransferApi(user, userId, sinceMs, 250);
      if (!response || !Array.isArray(response.operations)) break;
      const operations = response.operations;
      const cursorMs = normalizeOperationUpdatedAt(response.cursorMs, sinceMs);
      const migratedAtMs = normalizeOperationUpdatedAt(response?.state?.migratedAtMs, 0);
      if (migratedAtMs > 0) {
        writeSyncMeta({ [LIST_SYNC_MIGRATED_META_KEY]: migratedAtMs });
      }
      if (operations.length > 0) {
        const didApply = applyListOperationsToLocalStorage(operations);
        applied = applied || didApply;
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
      flushPendingListOperationsToCloud('visibility-hidden').catch((error) => {
        console.warn('Visibility list sync push failed:', error);
      });
    });

    window.addEventListener('pagehide', () => {
      flushPendingListOperationsToCloud('pagehide').catch(() => {
        // best effort
      });
    });
  }

  function scheduleAutosyncFromMutation(reason = 'mutation') {
    if (!isSyncEnabled()) return;
    clearTimeout(autosyncDebounceTimer);
    autosyncDebounceTimer = window.setTimeout(() => {
      flushPendingListOperationsToCloud(reason).catch((error) => {
        console.warn('Mutation list sync push failed:', error);
      });
    }, 800);
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
        if (suppressMutationHook) return result;
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
        }
        writeSyncMeta({ lastLocalChangeAt: Date.now(), lastMutationType: 'storage-set' });
        scheduleAutosyncFromMutation(listMutation ? 'list-storage-set' : 'storage-set');
        return result;
      };
      localProto.removeItem = function wrappedRemoveItem(...args) {
        const key = String(args?.[0] || '');
        const beforeRaw = key ? this.getItem(key) : null;
        const result = originalRemoveItem.apply(this, args);
        if (suppressMutationHook) return result;
        if (key === SYNC_META_KEY || key === SYNC_DEVICE_ID_KEY) return result;
        let listMutation = false;
        if (MERGEABLE_LIST_KEYS.has(key) && beforeRaw !== null) {
          enqueueListOperations(buildListOperationsFromRaw(key, beforeRaw, '[]', Date.now()));
          scheduleListSyncFlush('storage-remove-list');
          listMutation = true;
        }
        writeSyncMeta({ lastLocalChangeAt: Date.now(), lastMutationType: 'storage-remove' });
        scheduleAutosyncFromMutation(listMutation ? 'list-storage-remove' : 'storage-remove');
        return result;
      };
      localProto.clear = function wrappedClear(...args) {
        const result = originalClear.apply(this, args);
        if (suppressMutationHook) return result;
        pendingListOperations.clear();
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
    ensureAutosyncFlushBindings();
    autosyncInterval = window.setInterval(() => {
      if (!isSyncEnabled() || !auth?.currentUser) return;
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
  }

  async function syncFromCloudNow() {
    await init();
    const user = auth?.currentUser;
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
          currentUser = user || null;
          startCloudSnapshotListener(currentUser);
          if (currentUser && isSyncEnabled()) {
            syncFromCloudNow().catch((error) => {
              console.warn('Cloud import failed:', error);
            });
            startAutosyncLoop();
          } else {
            snapshotListenerReady = false;
            stopAutosyncLoop();
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
      const user = await requireAuth();
      const mirrorToFirebase = options?.mirrorToFirebase !== false;
      const cloudSnapshot = await api.getCloudSnapshot();
      const mergedSnapshot = mergeSnapshots(cloudSnapshot, snapshot || null) || snapshot || null;
      const payload = {
        ...(mergedSnapshot || {}),
        meta: {
          ...(mergedSnapshot?.meta || {}),
          updatedAtMs: Date.now(),
          deviceId: getOrCreateDeviceId(),
          version: 1
        }
      };
      const signature = snapshotSignature(payload);
      lastAppliedCloudSignature = signature;
      lastUploadedCloudSignature = signature;

      const userId = getTransferUserId(user);
      let savedToTransferApi = false;
      try {
        await saveSnapshotToTransferApi(user, userId, payload);
        savedToTransferApi = true;
      } catch (error) {
        console.warn('Data API save failed (Firestore save will still proceed):', error);
      }

      if (mirrorToFirebase && modules?.setDoc && modules?.doc && firestore) {
        await modules.setDoc(modules.doc(firestore, 'users', user.uid), {
          cloudBackup: {
            schema: 'bilm-cloud-sync-v1',
            updatedAt: modules.serverTimestamp(),
            snapshot: payload,
            transferApiMirrored: savedToTransferApi
          }
        }, { merge: true });
      }

      writeSyncMeta({
        lastCloudPushAt: Date.now(),
        lastLocalChangeAt: Date.now()
      });
    },
    async getCloudSnapshot() {
      const user = await requireAuth();
      const userId = getTransferUserId(user);
      let transferSnapshot = null;
      try {
        transferSnapshot = await loadSnapshotFromTransferApi(user, userId);
      } catch (error) {
        console.warn('Data API load failed (falling back to Firestore data):', error);
      }

      const docSnap = await modules.getDoc(modules.doc(firestore, 'users', user.uid));
      const data = docSnap.data() || {};
      const firestoreSnapshot = data.cloudBackup?.snapshot || null;
      const mergedSnapshot = mergeSnapshots(firestoreSnapshot, transferSnapshot);
      if (mergedSnapshot) return mergedSnapshot;
      return getSnapshotUpdatedAtMs(transferSnapshot) >= getSnapshotUpdatedAtMs(firestoreSnapshot)
        ? transferSnapshot
        : firestoreSnapshot;
    },
    async syncFromCloudNow() {
      await init();
      return syncFromCloudNow();
    },
    async flushSyncNow(reason = 'manual') {
      return flushPendingListOperationsToCloud(reason);
    },
    async pushSectorOperationsNow(operations = [], reason = 'manual') {
      await init();
      const user = await requireAuth();
      const userId = getTransferUserId(user);
      const normalizedListOperations = (Array.isArray(operations) ? operations : [])
        .map((operation) => {
          if (operation?.listKey) {
            const listKey = String(operation.listKey || '').trim();
            const itemKey = String(operation.itemKey || '').trim();
            if (!listKey || !itemKey) return null;
            return {
              listKey,
              itemKey,
              deleted: operation?.deleted === true,
              updatedAtMs: normalizeOperationUpdatedAt(operation?.updatedAtMs),
              payload: operation?.deleted === true
                ? undefined
                : normalizeListOperationPayload(operation?.payload, normalizeOperationUpdatedAt(operation?.updatedAtMs))
            };
          }
          return toListOperation(operation);
        })
        .filter(Boolean);
      if (!normalizedListOperations.length) {
        return { ok: true, processed: 0, cursorMs: getListSyncCursorMs() };
      }
      const response = await pushListOperationsToTransferApi(user, userId, normalizedListOperations);
      const maxUpdatedAt = normalizedListOperations.reduce((max, operation) => Math.max(max, normalizeOperationUpdatedAt(operation?.updatedAtMs, 0)), 0);
      const cursorMs = Math.max(normalizeOperationUpdatedAt(response?.cursorMs, 0), maxUpdatedAt);
      if (cursorMs > 0) setListSyncCursorMs(cursorMs);
      writeSyncMeta({
        lastListSyncPushAt: Date.now(),
        lastListSyncPushReason: reason
      });
      return response;
    },
    async scheduleCloudSave(reason = 'manual') {
      return flushPendingListOperationsToCloud(reason);
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

