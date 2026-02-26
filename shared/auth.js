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
  let mutationObserverInstalled = false;
  let autosyncDebounceTimer = null;
  let suppressMutationHook = false;
  let lastUploadedCloudSignature = '';
  let lastLocalSnapshotSignature = '';
  let lastSaveAttemptAt = 0;
  let snapshotListenerReady = false;

  const MIN_SAVE_INTERVAL_MS = 15000;

  const SYNC_ENABLED_KEY = 'bilm-sync-enabled';
  const SYNC_META_KEY = 'bilm-sync-meta';
  const SYNC_DEVICE_ID_KEY = 'bilm-sync-device-id';
  const MERGEABLE_LIST_KEYS = new Set([
    'bilm-favorites',
    'bilm-watch-later',
    'bilm-continue-watching',
    'bilm-history-movies',
    'bilm-history-tv'
  ]);
  const BACKUP_LOCAL_ALLOWLIST = [
    /^bilm-/,
    /^tmdb-/,
    /^theme-/
  ];
  const BACKUP_SESSION_ALLOWLIST = [
    /^bilm-/,
    /^tmdb-/
  ];
  let lastAppliedCloudSignature = '';

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
    return String(item.key || item.tmdbId || item.id || '').trim();
  }

  function getItemUpdatedAt(item) {
    return Number(item?.updatedAt || item?.timestamp || item?.savedAt || 0) || 0;
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
    const localKeys = Object.keys(localStorage).filter((key) => ![SYNC_ENABLED_KEY, SYNC_META_KEY, SYNC_DEVICE_ID_KEY].includes(key));
    if (localKeys.length > 0) return true;
    if (sessionStorage.length > 0) return true;
    return String(document.cookie || '').trim().length > 0;
  }

  function shouldApplyRemoteSnapshot(snapshot) {
    if (!snapshot || snapshot.schema !== 'bilm-backup-v1') return false;
    if (!hasMeaningfulLocalData()) return true;

    const cloudUpdatedAtMs = Number(snapshot?.meta?.updatedAtMs || 0);
    if (!cloudUpdatedAtMs) return false;

    const meta = readSyncMeta();
    const localChangedAt = Number(meta?.lastLocalChangeAt || 0);
    const localCloudPullAt = Number(meta?.lastCloudPullAt || 0);
    const freshnessFloor = Math.max(localChangedAt, localCloudPullAt);
    return cloudUpdatedAtMs > freshnessFloor;
  }

  async function saveLocalSnapshotToCloud(reason = 'auto') {
    await init();
    const user = auth?.currentUser;
    if (!user || !isSyncEnabled() || pendingAutosync || !snapshotListenerReady) return false;

    const now = Date.now();
    const forceReasons = new Set(['manual', 'pagehide', 'visibility-hidden']);
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

  function ensureAutosyncFlushBindings() {
    if (autosyncFlushBound) return;
    autosyncFlushBound = true;

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') return;
      saveLocalSnapshotToCloud('visibility-hidden').catch((error) => {
        console.warn('Visibility autosync save failed:', error);
      });
    });

    window.addEventListener('pagehide', () => {
      saveLocalSnapshotToCloud('pagehide').catch(() => {
        // best effort
      });
    });
  }

  function scheduleAutosyncFromMutation(reason = 'mutation') {
    if (!isSyncEnabled()) return;
    clearTimeout(autosyncDebounceTimer);
    autosyncDebounceTimer = window.setTimeout(() => {
      saveLocalSnapshotToCloud(reason).catch((error) => {
        console.warn('Mutation autosync save failed:', error);
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
        }
        writeSyncMeta({ lastLocalChangeAt: Date.now(), lastMutationType: 'storage-set' });
        scheduleAutosyncFromMutation('storage-set');
        return result;
      };
      localProto.removeItem = function wrappedRemoveItem(...args) {
        const result = originalRemoveItem.apply(this, args);
        if (suppressMutationHook) return result;
        const key = String(args?.[0] || '');
        if (key === SYNC_META_KEY || key === SYNC_DEVICE_ID_KEY) return result;
        writeSyncMeta({ lastLocalChangeAt: Date.now(), lastMutationType: 'storage-remove' });
        scheduleAutosyncFromMutation('storage-remove');
        return result;
      };
      localProto.clear = function wrappedClear(...args) {
        const result = originalClear.apply(this, args);
        if (suppressMutationHook) return result;
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
      if (!isSyncEnabled() || !auth?.currentUser || pendingAutosync) return;
      const snapshot = collectBackupData();
      const signature = snapshotSignature(snapshot);
      if (!signature || signature === lastLocalSnapshotSignature) return;
      lastLocalSnapshotSignature = signature;
      writeSyncMeta({ lastLocalChangeAt: Date.now() });
      saveLocalSnapshotToCloud('interval').catch((error) => {
        console.warn('Autosync interval save failed:', error);
      });
    }, 3000);
  }

  function stopAutosyncLoop() {
    if (autosyncInterval) {
      window.clearInterval(autosyncInterval);
      autosyncInterval = null;
    }
  }

  async function syncFromCloudNow() {
    const snapshot = await api.getCloudSnapshot();
    if (!snapshot) return false;
    if (!shouldApplyRemoteSnapshot(snapshot)) {
      const localSnapshot = collectBackupData();
      const mergedSnapshot = mergeSnapshots(snapshot, localSnapshot);
      if (mergedSnapshot) {
        applyRemoteSnapshot(mergedSnapshot);
        await api.saveCloudSnapshot(mergedSnapshot);
      }
      return false;
    }
    applyRemoteSnapshot(snapshot);
    return true;
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

      if (!isSyncEnabled() || event.hasPendingWrites || !event.snapshot) return;
      const signature = snapshotSignature(event.snapshot);
      if (!signature || signature === lastAppliedCloudSignature) return;

      const localDeviceId = getOrCreateDeviceId();
      const sourceDeviceId = String(event.snapshot?.meta?.deviceId || '').trim();
      if (sourceDeviceId && sourceDeviceId === localDeviceId) {
        lastAppliedCloudSignature = signature;
        return;
      }

      if (!shouldApplyRemoteSnapshot(event.snapshot)) {
        const localSnapshot = collectBackupData();
        const mergedSnapshot = mergeSnapshots(event.snapshot, localSnapshot);
        if (mergedSnapshot) {
          applyRemoteSnapshot(mergedSnapshot);
          api.saveCloudSnapshot(mergedSnapshot).catch((error) => {
            console.warn('Listener merge save failed:', error);
          });
        }
        return;
      }
      applyRemoteSnapshot(event.snapshot);
      lastAppliedCloudSignature = signature;
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
      await modules.updateProfile(user, { displayName: cleaned || null });
      await modules.setDoc(modules.doc(firestore, 'users', user.uid), {
        profile: {
          username: cleaned || null,
          email: user.email || null,
          updatedAt: modules.serverTimestamp()
        }
      }, { merge: true });
      if (cleaned) {
        await modules.setDoc(modules.doc(firestore, 'usernames', normalizeUsername(cleaned)), {
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
      await modules.deleteDoc(modules.doc(firestore, 'users', user.uid));
      if (usernameKey) {
        await modules.deleteDoc(modules.doc(firestore, 'usernames', usernameKey));
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
    async saveCloudSnapshot(snapshot) {
      const user = await requireAuth();
      const currentDoc = await modules.getDoc(modules.doc(firestore, 'users', user.uid));
      const cloudSnapshot = (currentDoc.data() || {})?.cloudBackup?.snapshot || null;
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
      await modules.setDoc(modules.doc(firestore, 'users', user.uid), {
        cloudBackup: {
          schema: 'bilm-cloud-sync-v1',
          updatedAt: modules.serverTimestamp(),
          snapshot: payload
        }
      }, { merge: true });
      writeSyncMeta({
        lastCloudPushAt: Date.now(),
        lastLocalChangeAt: Date.now()
      });
    },
    async getCloudSnapshot() {
      const user = await requireAuth();
      const docSnap = await modules.getDoc(modules.doc(firestore, 'users', user.uid));
      const data = docSnap.data() || {};
      return data.cloudBackup?.snapshot || null;
    },
    async syncFromCloudNow() {
      await init();
      return syncFromCloudNow();
    },
    async scheduleCloudSave(reason = 'manual') {
      return saveLocalSnapshotToCloud(reason);
    }
  };
  window.bilmAuth = api;
})();
