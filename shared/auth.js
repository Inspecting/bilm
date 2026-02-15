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

  const CLOUD_BACKUP_COLLECTION = 'bilmUserBackups';
  const AUTO_SAVE_INTERVAL_MS = 60000;
  const AUTO_SAVE_NEXT_AT_KEY = 'bilm:autoSaveNextAt';
  const AUTO_SAVE_DEVICE_ID_KEY = 'bilm:autoSaveDeviceId';

  const subscribers = new Set();
  let initPromise;
  let modules;
  let firestoreModules;
  let app;
  let auth;
  let analytics;
  let firestore;
  let currentUser = null;

  function normalizeUser(user) {
    if (!user) return null;
    return {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || '',
      emailVerified: Boolean(user.emailVerified),
      photoURL: user.photoURL || ''
    };
  }

  function notifySubscribers(user) {
    subscribers.forEach((listener) => {
      try {
        listener(user);
      } catch (error) {
        console.error('Auth listener failed:', error);
      }
    });
  }

  function safeReadInt(value) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) ? parsed : 0;
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
      // Storage may be unavailable.
    }
    return timestamp;
  }

  function scheduleNextAutoSave(fromMs = Date.now()) {
    return writeAutoSaveNextAt(fromMs + AUTO_SAVE_INTERVAL_MS);
  }

  function ensureAutoSaveNextAt() {
    const existing = readAutoSaveNextAt();
    if (existing > 0) return existing;
    return scheduleNextAutoSave();
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

  function collectLocalSnapshot() {
    return {
      schema: 'bilm-backup-v1',
      exportedAt: new Date().toISOString(),
      savedAtMs: Date.now(),
      origin: location.origin,
      pathname: location.pathname,
      localStorage: readStorageSnapshot(localStorage),
      sessionStorage: readStorageSnapshot(sessionStorage),
      cookies: document.cookie
    };
  }

  function normalizeSnapshot(snapshot) {
    const input = snapshot && typeof snapshot === 'object' ? snapshot : {};
    return {
      schema: 'bilm-backup-v1',
      exportedAt: typeof input.exportedAt === 'string' ? input.exportedAt : new Date().toISOString(),
      savedAtMs: Number.isFinite(input.savedAtMs) ? input.savedAtMs : Date.now(),
      origin: typeof input.origin === 'string' ? input.origin : location.origin,
      pathname: typeof input.pathname === 'string' ? input.pathname : location.pathname,
      localStorage: input.localStorage && typeof input.localStorage === 'object' ? input.localStorage : {},
      sessionStorage: input.sessionStorage && typeof input.sessionStorage === 'object' ? input.sessionStorage : {},
      cookies: typeof input.cookies === 'string' ? input.cookies : ''
    };
  }

  function applySnapshot(snapshot) {
    const payload = normalizeSnapshot(snapshot);

    Object.entries(payload.localStorage || {}).forEach(([key, value]) => {
      localStorage.setItem(key, value);
    });

    Object.entries(payload.sessionStorage || {}).forEach(([key, value]) => {
      sessionStorage.setItem(key, value);
    });

    String(payload.cookies || '')
      .split(';')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((cookieEntry) => {
        document.cookie = `${cookieEntry};path=/`;
      });
  }

  async function loadCoreModules() {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
    const [appModule, authModule, analyticsModule] = await Promise.all([
      import(`${base}/firebase-app.js`),
      import(`${base}/firebase-auth.js`),
      import(`${base}/firebase-analytics.js`)
    ]);

    return { ...appModule, ...authModule, ...analyticsModule };
  }

  async function loadFirestoreModules() {
    if (firestoreModules) return firestoreModules;
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
    try {
      firestoreModules = await import(`${base}/firebase-firestore.js`);
      return firestoreModules;
    } catch (error) {
      console.warn('Firestore module unavailable:', error);
      firestoreModules = null;
      return null;
    }
  }

  async function init() {
    if (initPromise) return initPromise;

    initPromise = (async () => {
      modules = await loadCoreModules();
      app = modules.initializeApp(FIREBASE_CONFIG);
      auth = modules.getAuth(app);

      const firestoreMod = await loadFirestoreModules();
      if (firestoreMod?.getFirestore) {
        firestore = firestoreMod.getFirestore(app);
      }

      try {
        analytics = modules.getAnalytics(app);
      } catch {
        analytics = null;
      }

      modules.onAuthStateChanged(auth, (user) => {
        currentUser = normalizeUser(user);
        notifySubscribers(currentUser);
        if (user) ensureAutoSaveNextAt();
      });

      currentUser = normalizeUser(auth.currentUser);
      if (currentUser) ensureAutoSaveNextAt();
      return api;
    })();

    return initPromise;
  }

  async function ensureReady() {
    await init();
    if (!auth || !modules) throw new Error('Auth services are unavailable.');
  }

  async function ensureCloudReady() {
    await ensureReady();
    if (firestore && firestoreModules) return;

    const firestoreMod = await loadFirestoreModules();
    if (firestoreMod?.getFirestore && app) {
      firestoreModules = firestoreMod;
      firestore = firestoreMod.getFirestore(app);
    }

    if (!firestore || !firestoreModules) {
      throw new Error('Cloud backup is temporarily unavailable.');
    }
  }

  function validateEmailPassword(email, password) {
    if (!email || !email.includes('@')) {
      throw new Error('Enter a valid email address.');
    }
    if (!password || password.length < 6) {
      throw new Error('Password must be at least 6 characters.');
    }
  }

  function getBackupDocRef(uid) {
    return firestoreModules.doc(firestore, CLOUD_BACKUP_COLLECTION, uid);
  }

  async function signIn(email, password) {
    await ensureReady();
    validateEmailPassword(email, password);
    const credential = await modules.signInWithEmailAndPassword(auth, email.trim(), password);
    currentUser = normalizeUser(credential.user);
    notifySubscribers(currentUser);
    ensureAutoSaveNextAt();
    return currentUser;
  }

  async function signUp(email, password) {
    await ensureReady();
    validateEmailPassword(email, password);
    const credential = await modules.createUserWithEmailAndPassword(auth, email.trim(), password);
    currentUser = normalizeUser(credential.user);
    notifySubscribers(currentUser);
    ensureAutoSaveNextAt();
    return currentUser;
  }

  async function signOut() {
    await ensureReady();
    await modules.signOut(auth);
    currentUser = null;
    notifySubscribers(currentUser);
  }

  function getCurrentUser() {
    return currentUser;
  }

  function onAuthStateChanged(listener) {
    if (typeof listener !== 'function') return () => {};
    subscribers.add(listener);
    listener(currentUser);
    return () => subscribers.delete(listener);
  }

  async function setUsername(username) {
    await ensureReady();
    const activeUser = auth.currentUser;
    if (!activeUser) throw new Error('Log in first.');
    await modules.updateProfile(activeUser, { displayName: username || null });
    currentUser = normalizeUser(activeUser);
    notifySubscribers(currentUser);
    return currentUser;
  }

  async function deleteAccount(password) {
    await ensureReady();
    const activeUser = auth.currentUser;
    if (!activeUser || !activeUser.email) throw new Error('Log in first.');
    if (!password) throw new Error('Password is required.');

    const credential = modules.EmailAuthProvider.credential(activeUser.email, password);
    await modules.reauthenticateWithCredential(activeUser, credential);

    try {
      await ensureCloudReady();
      await firestoreModules.deleteDoc(getBackupDocRef(activeUser.uid));
    } catch (error) {
      console.warn('Could not remove cloud backup before account deletion:', error);
    }

    await modules.deleteUser(activeUser);
    currentUser = null;
    notifySubscribers(currentUser);
  }

  async function saveCloudSnapshot(snapshot, options = {}) {
    await ensureCloudReady();
    const activeUser = auth.currentUser;
    if (!activeUser) throw new Error('Log in first.');

    const normalizedSnapshot = normalizeSnapshot(snapshot || collectLocalSnapshot());
    const ref = getBackupDocRef(activeUser.uid);
    const preserveSchedule = options?.preserveSchedule === true;
    const nextAutoSaveAt = preserveSchedule ? ensureAutoSaveNextAt() : scheduleNextAutoSave();
    let nextRevision = 1;

    await firestoreModules.runTransaction(firestore, async (transaction) => {
      const existing = await transaction.get(ref);
      const currentRevision = existing.exists() ? safeReadInt(existing.data()?.revision) : 0;
      nextRevision = currentRevision + 1;
      transaction.set(ref, {
        uid: activeUser.uid,
        revision: nextRevision,
        updatedAt: firestoreModules.serverTimestamp(),
        updatedByDeviceId: getAutoSaveDeviceId(),
        snapshot: normalizedSnapshot
      }, { merge: true });
    });

    return { revision: nextRevision, nextAutoSaveAt };
  }

  async function getCloudSnapshot() {
    await ensureCloudReady();
    const activeUser = auth.currentUser;
    if (!activeUser) return null;

    const cloudDoc = await firestoreModules.getDoc(getBackupDocRef(activeUser.uid));
    if (!cloudDoc.exists()) return null;

    const data = cloudDoc.data() || {};
    return normalizeSnapshot(data.snapshot || {});
  }

  async function syncFromCloudNow() {
    const snapshot = await getCloudSnapshot();
    if (!snapshot) return false;
    applySnapshot(snapshot);
    return true;
  }

  function getAutoSaveNextAt() {
    return ensureAutoSaveNextAt();
  }

  const api = {
    init,
    signIn,
    signUp,
    signOut,
    getCurrentUser,
    onAuthStateChanged,
    setUsername,
    deleteAccount,
    saveCloudSnapshot,
    getCloudSnapshot,
    syncFromCloudNow,
    getAutoSaveNextAt
  };

  window.bilmAuth = api;
})();
