(() => {
  const FIREBASE_COMPAT_VERSION = '10.12.5';
  const FIREBASE_SCRIPT_BASE = `https://www.gstatic.com/firebasejs/${FIREBASE_COMPAT_VERSION}`;
  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyAvgC5yuO5qCmPphj0bTHqIqMITX0vbRAE',
    authDomain: 'bilm-3f205.firebaseapp.com',
    projectId: 'bilm-3f205',
    storageBucket: 'bilm-3f205.firebasestorage.app',
    messagingSenderId: '981687790462',
    appId: '1:981687790462:web:1e84ca27ca6d04a0a5612f',
    measurementId: 'G-VDQDLYHGM4'
  };

  const subscribers = new Set();
  let initPromise;
  let auth;
  let firestore;
  let currentUser = null;

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-firebase-src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === 'true') {
          resolve();
          return;
        }
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.defer = true;
      script.dataset.firebaseSrc = src;
      script.addEventListener('load', () => {
        script.dataset.loaded = 'true';
        resolve();
      }, { once: true });
      script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      document.head.appendChild(script);
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
    const trimmed = String(identifier || '').trim();
    if (!trimmed) {
      throw new Error('Enter your username/email and password.');
    }
    if (trimmed.includes('@')) return trimmed;

    const usernameKey = normalizeUsername(trimmed);
    const usernameDoc = await firestore.collection('usernames').doc(usernameKey).get();
    if (!usernameDoc.exists) {
      throw new Error('No account found for that username/email.');
    }
    const data = usernameDoc.data() || {};
    if (!data.email) {
      throw new Error('Username is not linked to an email account.');
    }
    return data.email;
  }

  async function init() {
    if (initPromise) return initPromise;

    initPromise = (async () => {
      try {
        await loadScriptOnce(`${FIREBASE_SCRIPT_BASE}/firebase-app-compat.js`);
        await loadScriptOnce(`${FIREBASE_SCRIPT_BASE}/firebase-auth-compat.js`);
        await loadScriptOnce(`${FIREBASE_SCRIPT_BASE}/firebase-firestore-compat.js`);

        if (!window.firebase) {
          throw new Error('Firebase did not initialize.');
        }

        const app = window.firebase.apps?.length
          ? window.firebase.app()
          : window.firebase.initializeApp(FIREBASE_CONFIG);

        auth = window.firebase.auth(app);
        firestore = window.firebase.firestore(app);

        auth.onAuthStateChanged((user) => {
          currentUser = user || null;
          notifySubscribers(currentUser);
        });

        return { auth, firestore };
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
      return auth.createUserWithEmailAndPassword(email, password);
    },
    async signUpWithUsername({ username, email, password }) {
      await init();
      const cleanEmail = String(email || '').trim();
      const usernameKey = normalizeUsername(username);
      if (!usernameKey) {
        throw new Error('Username is required.');
      }
      if (usernameKey.length < 3) {
        throw new Error('Username must be at least 3 characters long.');
      }
      if (!/^[a-z0-9._-]+$/.test(usernameKey)) {
        throw new Error('Username can only use letters, numbers, dot, underscore, and dash.');
      }

      const usernameRef = firestore.collection('usernames').doc(usernameKey);
      const existingUsername = await usernameRef.get();
      if (existingUsername.exists) {
        throw new Error('That username is already taken.');
      }

      const cred = await auth.createUserWithEmailAndPassword(cleanEmail, password);
      const user = cred.user;
      await Promise.all([
        user?.updateProfile({ displayName: usernameKey }),
        firestore.collection('users').doc(user.uid).set({
          profile: {
            username: usernameKey,
            email: cleanEmail,
            updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
          }
        }, { merge: true }),
        usernameRef.set({
          uid: user.uid,
          username: usernameKey,
          email: cleanEmail,
          createdAt: window.firebase.firestore.FieldValue.serverTimestamp()
        })
      ]);
      return cred;
    },
    async signIn(email, password) {
      await init();
      return auth.signInWithEmailAndPassword(email, password);
    },
    async signInWithIdentifier(identifier, password) {
      await init();
      const email = await resolveEmailFromIdentifier(identifier);
      return auth.signInWithEmailAndPassword(email, password);
    },
    async reauthenticate(password) {
      await init();
      const user = await requireAuth();
      const credential = window.firebase.auth.EmailAuthProvider.credential(user.email, password);
      return user.reauthenticateWithCredential(credential);
    },
    async deleteAccount(password) {
      await init();
      const user = await requireAuth();
      if (!password) throw new Error('Password is required to delete your account.');
      await api.reauthenticate(password);
      const usernameKey = normalizeUsername(user.displayName);
      await firestore.collection('users').doc(user.uid).delete();
      if (usernameKey) {
        await firestore.collection('usernames').doc(usernameKey).delete();
      }
      await user.delete();
    },
    async signOut() {
      await init();
      return auth.signOut();
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
      await firestore.collection('users').doc(user.uid).set({
        cloudBackup: {
          schema: 'bilm-cloud-sync-v1',
          updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
          snapshot
        }
      }, { merge: true });
    },
    async getCloudSnapshot() {
      const user = await requireAuth();
      const doc = await firestore.collection('users').doc(user.uid).get();
      const data = doc.data() || {};
      return data.cloudBackup?.snapshot || null;
    }
  };

  window.bilmAuth = api;
})();
