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
  let analytics;
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

  async function loadModules() {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
    const [
      appModule,
      authModule,
      analyticsModule
    ] = await Promise.all([
      import(`${base}/firebase-app.js`),
      import(`${base}/firebase-auth.js`),
      import(`${base}/firebase-analytics.js`)
    ]);

    return {
      ...appModule,
      ...authModule,
      ...analyticsModule
    };
  }

  async function init() {
    if (initPromise) return initPromise;

    initPromise = (async () => {
      modules = await loadModules();
      app = modules.initializeApp(FIREBASE_CONFIG);
      auth = modules.getAuth(app);

      try {
        analytics = modules.getAnalytics(app);
      } catch {
        analytics = null;
      }

      modules.onAuthStateChanged(auth, (user) => {
        currentUser = normalizeUser(user);
        notifySubscribers(currentUser);
      });

      currentUser = normalizeUser(auth.currentUser);
      return api;
    })();

    return initPromise;
  }

  async function ensureReady() {
    await init();
    if (!auth || !modules) throw new Error('Auth not initialized.');
  }

  function validateEmailPassword(email, password) {
    if (!email || !email.includes('@')) {
      throw new Error('Enter a valid email address.');
    }
    if (!password || password.length < 6) {
      throw new Error('Password must be at least 6 characters.');
    }
  }

  async function signIn(email, password) {
    await ensureReady();
    validateEmailPassword(email, password);
    const credential = await modules.signInWithEmailAndPassword(auth, email.trim(), password);
    currentUser = normalizeUser(credential.user);
    notifySubscribers(currentUser);
    return currentUser;
  }

  async function signUp(email, password) {
    await ensureReady();
    validateEmailPassword(email, password);
    const credential = await modules.createUserWithEmailAndPassword(auth, email.trim(), password);
    currentUser = normalizeUser(credential.user);
    notifySubscribers(currentUser);
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
    if (typeof listener !== 'function') {
      return () => {};
    }

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
    await modules.deleteUser(activeUser);
    currentUser = null;
    notifySubscribers(currentUser);
  }

  // Compatibility methods kept so older settings UI doesn't hard-crash.
  async function saveCloudSnapshot() {
    return null;
  }

  async function getCloudSnapshot() {
    return null;
  }

  async function syncFromCloudNow() {
    return false;
  }

  function getAutoSaveNextAt() {
    return 0;
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
