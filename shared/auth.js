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

  const SYNC_ENABLED_KEY = 'bilm-sync-enabled';
  let lastAppliedCloudSignature = '';

  function isSyncEnabled() {
    return localStorage.getItem(SYNC_ENABLED_KEY) !== '0';
  }

  function snapshotSignature(snapshot) {
    try {
      return JSON.stringify(snapshot || null);
    } catch {
      return '';
    }
  }

  function applyRemoteSnapshot(snapshot) {
    if (!snapshot || snapshot.schema !== 'bilm-backup-v1') return;
    try {
      const syncPreference = localStorage.getItem(SYNC_ENABLED_KEY);
      localStorage.clear();
      sessionStorage.clear();

      Object.entries(snapshot.localStorage || {}).forEach(([key, value]) => {
        localStorage.setItem(key, value);
      });
      Object.entries(snapshot.sessionStorage || {}).forEach(([key, value]) => {
        sessionStorage.setItem(key, value);
      });

      document.cookie.split(';').forEach((cookie) => {
        const eqPos = cookie.indexOf('=');
        const name = eqPos > -1 ? cookie.slice(0, eqPos).trim() : cookie.trim();
        if (name) {
          document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
        }
      });

      String(snapshot.cookies || '')
        .split(';')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .forEach((cookieEntry) => {
          document.cookie = `${cookieEntry};path=/`;
        });

      if (syncPreference === '0') {
        localStorage.setItem(SYNC_ENABLED_KEY, '0');
      }
    } catch (error) {
      console.warn('Applying cloud snapshot failed:', error);
    }
  }

  async function syncFromCloudNow() {
    const snapshot = await api.getCloudSnapshot();
    if (!snapshot) return false;
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
    if (!user || !modules?.onSnapshot || !firestore) {
      emitCloudSnapshotEvent({ snapshot: null, updatedAtMs: null, user: null });
      return;
    }

    const userDocRef = modules.doc(firestore, 'users', user.uid);
    cloudSnapshotUnsubscribe = modules.onSnapshot(userDocRef, (docSnap) => {
      const data = docSnap.data() || {};
      const cloudBackup = data.cloudBackup || {};
      const event = {
        snapshot: cloudBackup.snapshot || null,
        updatedAtMs: cloudBackup.updatedAt?.toMillis?.() || null,
        hasPendingWrites: docSnap.metadata?.hasPendingWrites === true,
        fromCache: docSnap.metadata?.fromCache === true,
        user
      };
      emitCloudSnapshotEvent(event);

      if (!isSyncEnabled() || event.hasPendingWrites || !event.snapshot) return;
      const signature = snapshotSignature(event.snapshot);
      if (!signature || signature === lastAppliedCloudSignature) return;
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
    async signUpWithUsername({ email, password }) {
      await init();
      return withAuthRetry(() => modules.createUserWithEmailAndPassword(auth, String(email || '').trim(), password));
    },
    async signIn(email, password) {
      await init();
      return withAuthRetry(() => modules.signInWithEmailAndPassword(auth, String(email || '').trim(), password));
    },
    async signInWithIdentifier(identifier, password) {
      await init();
      return withAuthRetry(() => modules.signInWithEmailAndPassword(auth, String(identifier || '').trim(), password));
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
      lastAppliedCloudSignature = snapshotSignature(snapshot);
      await modules.setDoc(modules.doc(firestore, 'users', user.uid), {
        cloudBackup: {
          schema: 'bilm-cloud-sync-v1',
          updatedAt: modules.serverTimestamp(),
          snapshot
        }
      }, { merge: true });
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
  window.bilmAuth = api;
})();
