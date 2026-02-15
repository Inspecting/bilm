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

  const AUTO_SAVE_INTERVAL_MS = 30000;
  const THEME_SETTINGS_KEY = 'bilm-theme-settings';
  const AUTO_SAVE_NEXT_AT_KEY = 'bilm:autoSaveNextAt';
  const AUTO_SAVE_LOCK_KEY = 'bilm:autoSaveLock';
  const AUTO_SAVE_LOCK_TTL_MS = 15000;
  const AUTO_SAVE_DEVICE_ID_KEY = 'bilm:autoSaveDeviceId';
  const AUTO_SAVE_LAST_APPLIED_AT_KEY = 'bilm:autoSaveLastAppliedAt';
  const AUTO_SAVE_LAST_APPLIED_REVISION_KEY = 'bilm:autoSaveLastAppliedRevision';
  const autoSaveTabId = `tab-${Math.random().toString(36).slice(2)}`;
  let autoSaveTimer = null;
  let autoSaveInFlight = false;
  let cloudSyncUnsubscribe = null;
  let applyingRemoteSnapshot = false;

  function isAccountSyncEnabled() {
    try {
      const raw = localStorage.getItem(THEME_SETTINGS_KEY);
      if (!raw) return true;
      const settings = JSON.parse(raw);
      return settings?.accountAutoSync !== false;
    } catch {
      return true;
    }
  }

  function getAutoSaveDeviceId() {
    try {
      const existing = localStorage.getItem(AUTO_SAVE_DEVICE_ID_KEY);
      if (existing) return existing;
      const next = `device-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
      localStorage.setItem(AUTO_SAVE_DEVICE_ID_KEY, next);
      return next;
    } catch {
      return `device-volatile-${Math.random().toString(36).slice(2)}`;
    }
  }

  const autoSaveDeviceId = getAutoSaveDeviceId();

  function scheduleNextAutoSave(fromMs = Date.now()) {
    return writeAutoSaveNextAt(fromMs + AUTO_SAVE_INTERVAL_MS);
  }

  function safeReadInt(value) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function readAutoSaveNextAt() {
    try {
      return safeReadInt(localStorage.getItem(AUTO_SAVE_NEXT_AT_KEY));
    } catch {
      return 0;
    }
  }

  function writeAutoSaveNextAt(timestamp) {
    try {
      localStorage.setItem(AUTO_SAVE_NEXT_AT_KEY, String(timestamp));
    } catch {
      // no-op if storage is unavailable
    }
    return timestamp;
  }

  function ensureAutoSaveNextAt() {
    const existing = readAutoSaveNextAt();
    if (existing > 0) return existing;
    return scheduleNextAutoSave();
  }

  function readStorageSnapshot(storage) {
    try {
      return Object.entries(storage).reduce((all, [key, value]) => {
        all[key] = value;
        return all;
      }, {});
    } catch {
      return {};
    }
  }

  function collectAutoSaveSnapshot() {
    return {
      schema: 'bilm-backup-v1',
      exportedAt: new Date().toISOString(),
      savedAtMs: Date.now(),
      savedByDeviceId: autoSaveDeviceId,
      origin: location.origin,
      pathname: location.pathname,
      localStorage: readStorageSnapshot(localStorage),
      sessionStorage: readStorageSnapshot(sessionStorage),
      cookies: document.cookie
    };
  }

  function acquireAutoSaveLock() {
    try {
      const now = Date.now();
      const raw = localStorage.getItem(AUTO_SAVE_LOCK_KEY);
      if (raw) {
        const lock = JSON.parse(raw);
        if (lock?.expiresAt && lock.expiresAt > now && lock?.owner !== autoSaveTabId) {
          return false;
        }
      }
      localStorage.setItem(AUTO_SAVE_LOCK_KEY, JSON.stringify({ owner: autoSaveTabId, expiresAt: now + AUTO_SAVE_LOCK_TTL_MS }));
      return true;
    } catch {
      return true;
    }
  }

  function releaseAutoSaveLock() {
    try {
      const raw = localStorage.getItem(AUTO_SAVE_LOCK_KEY);
      if (!raw) return;
      const lock = JSON.parse(raw);
      if (lock?.owner === autoSaveTabId) {
        localStorage.removeItem(AUTO_SAVE_LOCK_KEY);
      }
    } catch {
      // no-op
    }
  }

  async function maybeRunGlobalAutoSave(force = false) {
    if (autoSaveInFlight) return;
    if (!auth?.currentUser) return;

    const dueAt = ensureAutoSaveNextAt();
    if (!force && Date.now() < dueAt) return;
    if (!acquireAutoSaveLock()) return;
    writeAutoSaveNextAt(dueAt + AUTO_SAVE_INTERVAL_MS);

    autoSaveInFlight = true;
    try {
      await api.saveCloudSnapshot(collectAutoSaveSnapshot(), { preserveSchedule: true });
    } catch (error) {
      console.warn('Global auto save failed:', error);
    } finally {
      autoSaveInFlight = false;
      releaseAutoSaveLock();
    }
  }

  function readLastAppliedAt() {
    try {
      return safeReadInt(localStorage.getItem(AUTO_SAVE_LAST_APPLIED_AT_KEY));
    } catch {
      return 0;
    }
  }

  function writeLastAppliedAt(timestamp) {
    try {
      localStorage.setItem(AUTO_SAVE_LAST_APPLIED_AT_KEY, String(timestamp));
    } catch {
      // no-op if storage is unavailable
    }
    return timestamp;
  }

  function readLastAppliedRevision() {
    try {
      return safeReadInt(localStorage.getItem(AUTO_SAVE_LAST_APPLIED_REVISION_KEY));
    } catch {
      return 0;
    }
  }

  function writeLastAppliedRevision(revision) {
    try {
      localStorage.setItem(AUTO_SAVE_LAST_APPLIED_REVISION_KEY, String(revision));
    } catch {
      // no-op if storage is unavailable
    }
    return revision;
  }

  function normalizeSnapshot(snapshot) {
    const normalized = { ...(snapshot || {}) };
    if (normalized.schema !== 'bilm-backup-v1') {
      normalized.schema = 'bilm-backup-v1';
    }
    const now = Date.now();
    normalized.savedAtMs = Number.isFinite(Number(normalized.savedAtMs))
      ? Number(normalized.savedAtMs)
      : now;
    normalized.savedByDeviceId = String(normalized.savedByDeviceId || autoSaveDeviceId);
    normalized.localStorage = { ...(normalized.localStorage || {}) };
    normalized.sessionStorage = { ...(normalized.sessionStorage || {}) };
    normalized.cookies = String(normalized.cookies || '');
    normalized.exportedAt = normalized.exportedAt || new Date(normalized.savedAtMs).toISOString();
    normalized.origin = normalized.origin || location.origin;
    normalized.pathname = normalized.pathname || location.pathname;
    return normalized;
  }

  function mergeCookieStrings(primary, secondary) {
    const merged = [
      ...String(primary || '').split(';').map((item) => item.trim()).filter(Boolean),
      ...String(secondary || '').split(';').map((item) => item.trim()).filter(Boolean)
    ];
    return [...new Set(merged)].join('; ');
  }

  function mergeSnapshots(localSnapshot, remoteSnapshot) {
    const local = normalizeSnapshot(localSnapshot);
    const remote = normalizeSnapshot(remoteSnapshot);
    const preferLocal = local.savedAtMs >= remote.savedAtMs;

    const favored = preferLocal ? local : remote;
    const other = preferLocal ? remote : local;

    return {
      schema: 'bilm-backup-v1',
      exportedAt: new Date(Math.max(local.savedAtMs, remote.savedAtMs)).toISOString(),
      savedAtMs: Math.max(local.savedAtMs, remote.savedAtMs),
      savedByDeviceId: local.savedByDeviceId,
      origin: local.origin || remote.origin || location.origin,
      pathname: local.pathname || remote.pathname || location.pathname,
      localStorage: { ...(other.localStorage || {}), ...(favored.localStorage || {}) },
      sessionStorage: { ...(other.sessionStorage || {}), ...(favored.sessionStorage || {}) },
      cookies: mergeCookieStrings(local.cookies, remote.cookies)
    };
  }

  function applyRemoteSnapshot(snapshot) {
    if (!snapshot || snapshot.schema !== 'bilm-backup-v1') return;
    applyingRemoteSnapshot = true;
    try {
      Object.entries(snapshot.localStorage || {}).forEach(([key, value]) => {
        localStorage.setItem(key, value);
      });
      Object.entries(snapshot.sessionStorage || {}).forEach(([key, value]) => {
        sessionStorage.setItem(key, value);
      });
      String(snapshot.cookies || '')
        .split(';')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .forEach((cookieEntry) => {
          document.cookie = `${cookieEntry};path=/`;
        });
    } catch (error) {
      console.warn('Applying cloud snapshot failed:', error);
    } finally {
      applyingRemoteSnapshot = false;
    }
  }

  function stopCloudSyncListener() {
    if (!cloudSyncUnsubscribe) return;
    cloudSyncUnsubscribe();
    cloudSyncUnsubscribe = null;
  }

  function startCloudSyncListener() {
    if (!isAccountSyncEnabled()) return;
    if (!auth?.currentUser || !modules?.onSnapshot || !firestore || cloudSyncUnsubscribe) return;
    const userRef = modules.doc(firestore, 'users', auth.currentUser.uid);
    cloudSyncUnsubscribe = modules.onSnapshot(userRef, (docSnap) => {
      const data = docSnap.data() || {};
      const backup = data.cloudBackup || {};
      const snapshot = backup.snapshot;
      if (!snapshot) return;
      const remoteRevision = safeReadInt(backup.revision);
      const lastAppliedRevision = readLastAppliedRevision();
      if (remoteRevision > 0 && remoteRevision <= lastAppliedRevision) return;
      if (snapshot.savedByDeviceId === autoSaveDeviceId) {
        if (remoteRevision > 0) writeLastAppliedRevision(remoteRevision);
        return;
      }

      const remoteSavedAt = Number(snapshot.savedAtMs || 0);
      if (!Number.isFinite(remoteSavedAt) || remoteSavedAt <= 0) return;

      const lastAppliedAt = readLastAppliedAt();
      if ((remoteSavedAt <= lastAppliedAt && remoteRevision <= 0) || applyingRemoteSnapshot) return;

      applyRemoteSnapshot(snapshot);
      writeLastAppliedAt(remoteSavedAt);
      if (remoteRevision > 0) writeLastAppliedRevision(remoteRevision);
    }, (error) => {
      console.warn('Cloud sync listener failed:', error);
    });
  }

  async function syncFromCloudNow() {
    if (!isAccountSyncEnabled()) return false;
    const user = await requireAuth();
    const docSnap = await modules.getDoc(modules.doc(firestore, 'users', user.uid));
    const data = docSnap.data() || {};
    const backup = data.cloudBackup || {};
    const snapshot = backup.snapshot || null;
    if (!snapshot) return false;
    const revision = safeReadInt(backup.revision);
    applyRemoteSnapshot(snapshot);
    const remoteSavedAt = Number(snapshot.savedAtMs || Date.now());
    writeLastAppliedAt(remoteSavedAt);
    if (revision > 0) writeLastAppliedRevision(revision);
    return true;
  }

  function handleAccountSyncSettingChange() {
    if (!auth?.currentUser) return;
    if (isAccountSyncEnabled()) {
      startCloudSyncListener();
      syncFromCloudNow().catch((error) => {
        console.warn('Immediate cloud sync failed:', error);
      });
    } else {
      stopCloudSyncListener();
    }
  }

  function startGlobalAutoSave() {
    ensureAutoSaveNextAt();
    if (autoSaveTimer) return;
    autoSaveTimer = setInterval(() => {
      maybeRunGlobalAutoSave(false);
    }, 1000);
  }

  function stopGlobalAutoSave() {
    if (!autoSaveTimer) return;
    clearInterval(autoSaveTimer);
    autoSaveTimer = null;
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

        try {
          analytics = m.getAnalytics(app);
        } catch {
          analytics = null;
        }

        m.onAuthStateChanged(auth, (user) => {
          currentUser = user || null;
          if (currentUser) {
            startGlobalAutoSave();
            startCloudSyncListener();
            syncFromCloudNow().catch((error) => {
              console.warn('Startup cloud sync failed:', error);
            });
            maybeRunGlobalAutoSave(false);
          } else {
            stopGlobalAutoSave();
            stopCloudSyncListener();
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

  const api = {
    init,
    async signUp(email, password) {
      await init();
      return modules.createUserWithEmailAndPassword(auth, String(email || '').trim(), password);
    },
    async signUpWithUsername({ email, password }) {
      await init();
      return modules.createUserWithEmailAndPassword(auth, String(email || '').trim(), password);
    },
    async signIn(email, password) {
      await init();
      return modules.signInWithEmailAndPassword(auth, String(email || '').trim(), password);
    },
    async signInWithIdentifier(identifier, password) {
      await init();
      return modules.signInWithEmailAndPassword(auth, String(identifier || '').trim(), password);
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
          updatedAt: modules.serverTimestamp()
        }
      }, { merge: true });
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
      stopGlobalAutoSave();
      stopCloudSyncListener();
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
    getAutoSaveNextAt() {
      return ensureAutoSaveNextAt();
    },
    async saveCloudSnapshot(snapshot, options = {}) {
      const user = await requireAuth();
      const userRef = modules.doc(firestore, 'users', user.uid);
      const localSnapshot = normalizeSnapshot(snapshot);

      const result = await modules.runTransaction(firestore, async (transaction) => {
        const existingSnap = await transaction.get(userRef);
        const existingData = existingSnap.data() || {};
        const existingBackup = existingData.cloudBackup || {};
        const existingSnapshot = existingBackup.snapshot || null;
        const existingRevision = safeReadInt(existingBackup.revision);

        const resolvedSnapshot = existingSnapshot
          ? mergeSnapshots(localSnapshot, existingSnapshot)
          : localSnapshot;
        const nextRevision = existingRevision + 1;

        transaction.set(userRef, {
          cloudBackup: {
            schema: 'bilm-cloud-sync-v2',
            updatedAt: modules.serverTimestamp(),
            revision: nextRevision,
            snapshot: resolvedSnapshot
          }
        }, { merge: true });

        return {
          revision: nextRevision,
          savedAtMs: Number(resolvedSnapshot.savedAtMs || Date.now())
        };
      });

      writeLastAppliedRevision(result.revision);
      writeLastAppliedAt(result.savedAtMs);
      if (!options?.preserveSchedule) scheduleNextAutoSave();
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
    }
  };

  window.addEventListener('storage', (event) => {
    if (event.key !== THEME_SETTINGS_KEY) return;
    handleAccountSyncSettingChange();
  });

  window.bilmAuth = api;
})();
