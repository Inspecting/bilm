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

  const AUTO_SAVE_INTERVAL_MS = 60000;
  const AUTO_SAVE_NEXT_AT_KEY = 'bilm:autoSaveNextAt';
  const AUTO_SAVE_LOCK_KEY = 'bilm:autoSaveLock';
  const AUTO_SAVE_LOCK_TTL_MS = 15000;
  const autoSaveTabId = `tab-${Math.random().toString(36).slice(2)}`;
  let autoSaveTimer = null;
  let autoSaveInFlight = false;

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
    return writeAutoSaveNextAt(Date.now() + AUTO_SAVE_INTERVAL_MS);
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

    autoSaveInFlight = true;
    try {
      await api.saveCloudSnapshot(collectAutoSaveSnapshot());
      const base = readAutoSaveNextAt() || dueAt;
      const nextAt = Math.max(base + AUTO_SAVE_INTERVAL_MS, Date.now() + AUTO_SAVE_INTERVAL_MS);
      writeAutoSaveNextAt(nextAt);
    } catch (error) {
      console.warn('Global auto save failed:', error);
    } finally {
      autoSaveInFlight = false;
      releaseAutoSaveLock();
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
            maybeRunGlobalAutoSave(false);
          } else {
            stopGlobalAutoSave();
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
    async saveCloudSnapshot(snapshot) {
      const user = await requireAuth();
      await modules.setDoc(modules.doc(firestore, 'users', user.uid), {
        cloudBackup: {
          schema: 'bilm-cloud-sync-v1',
          updatedAt: modules.serverTimestamp(),
          snapshot
        }
      }, { merge: true });
      writeAutoSaveNextAt(Date.now() + AUTO_SAVE_INTERVAL_MS);
    },
    async getCloudSnapshot() {
      const user = await requireAuth();
      const docSnap = await modules.getDoc(modules.doc(firestore, 'users', user.uid));
      const data = docSnap.data() || {};
      return data.cloudBackup?.snapshot || null;
    }
  };

  window.bilmAuth = api;
})();
