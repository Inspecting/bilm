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
    const [appModule, authModule, firestoreModule, analyticsModule] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-analytics.js`)
    ]);

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
    async saveCloudSnapshot(snapshot) {
      const user = await requireAuth();
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
    }
  };

  window.bilmAuth = api;
})();
