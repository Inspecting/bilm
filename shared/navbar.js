function detectBasePath() {
  const appRoots = new Set(['home', 'movies', 'tv', 'games', 'search', 'settings', 'random', 'test', 'shared', 'index.html']);

  const scriptSrc = document.currentScript?.src;
  if (scriptSrc) {
    try {
      const scriptPath = new URL(scriptSrc, window.location.href).pathname;
      const sharedIndex = scriptPath.lastIndexOf('/shared/');
      if (sharedIndex >= 0) {
        const prefix = scriptPath.slice(0, sharedIndex);
        return prefix || '';
      }
    } catch {
      // Fall back to pathname parsing.
    }
  }

  const parts = window.location.pathname.split('/').filter(Boolean);
  if (!parts.length || appRoots.has(parts[0])) return '';
  if (parts.length > 1 && appRoots.has(parts[1])) return `/${parts[0]}`;
  return '';
}

function withBase(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${detectBasePath()}${normalized}`;
}

function loadAuthScript() {
  return new Promise((resolve, reject) => {
    if (window.bilmAuth) {
      resolve(window.bilmAuth);
      return;
    }
    const src = withBase('/shared/auth.js');
    const existing = document.querySelector(`script[data-bilm-auth="${src}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.bilmAuth), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load auth module.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.dataset.bilmAuth = src;
    script.addEventListener('load', () => resolve(window.bilmAuth), { once: true });
    script.addEventListener('error', () => reject(new Error('Failed to load auth module.')), { once: true });
    document.head.appendChild(script);
  });
}

(async () => {
  const container = document.getElementById('navbar-placeholder') || document.getElementById('navbarContainer');
  if (!container) return;

  document.body.classList.add('has-fixed-navbar');

  const shadow = container.attachShadow({ mode: 'open' });

  const [htmlRes, cssRes] = await Promise.all([
    fetch(withBase('/shared/navbar.html')),
    fetch(withBase('/shared/navbar.css'))
  ]);

  const html = await htmlRes.text();
  const css = await cssRes.text();

  shadow.innerHTML = `<style>${css}</style>${html}`;


  const chatWidget = shadow.getElementById('sharedChatWidget');
  const chatToggle = shadow.getElementById('sharedChatToggle');
  const chatPanel = shadow.getElementById('sharedChatPanel');
  const chatClose = shadow.getElementById('sharedChatClose');
  const chatForm = shadow.getElementById('sharedChatForm');
  const chatInput = shadow.getElementById('sharedChatInput');
  const chatMessages = shadow.getElementById('sharedChatMessages');
  let chatMessagesUnsubscribe = null;
  let chatCurrentUser = null;

  function formatChatTime(ts) {
    const value = Number(ts || 0) || Date.now();
    return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function renderChatMessages(messages = []) {
    if (!chatMessages) return;
    chatMessages.innerHTML = '';
    if (!messages.length) {
      const empty = document.createElement('p');
      empty.className = 'shared-chat-empty';
      empty.textContent = 'No messages yet.';
      chatMessages.appendChild(empty);
      return;
    }

    messages.forEach((entry) => {
      const row = document.createElement('article');
      row.className = 'shared-chat-message';

      const meta = document.createElement('div');
      meta.className = 'shared-chat-message-meta';

      const left = document.createElement('span');
      const author = String(entry.author || 'Account').trim() || 'Account';
      left.textContent = `${author} • ${formatChatTime(entry.createdAtMs)}`;

      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = 'Delete';
      del.addEventListener('click', async () => {
        if (!chatCurrentUser || !window.bilmAuth?.init) return;
        try {
          await window.bilmAuth.init();
          const modules = window.bilmAuthModules;
          if (!modules?.deleteDoc || !modules?.doc || !modules?.collection || !modules?.getFirestore) return;
          const fs = modules.getFirestore();
          await modules.deleteDoc(modules.doc(modules.collection(modules.doc(fs, 'users', chatCurrentUser.uid), 'sharedChat'), entry.id));
        } catch (error) {
          console.warn('Failed to delete chat message:', error);
        }
      });

      meta.append(left, del);

      const body = document.createElement('p');
      body.textContent = String(entry.text || '');

      row.append(meta, body);
      chatMessages.appendChild(row);
    });

    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function toggleChatPanel(nextOpen) {
    if (!chatPanel || !chatToggle) return;
    const open = Boolean(nextOpen);
    chatPanel.hidden = !open;
    chatToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open && chatInput) chatInput.focus();
  }

  const pathParts = location.pathname.split('/').filter(Boolean);
  const appSections = new Set(['home', 'movies', 'tv', 'games', 'search', 'settings', 'random', 'test']);
  const section = pathParts.find(part => appSections.has(part)) || 'home';
  const fileName = pathParts.at(-1) || '';
  const isSearchPage = section === 'search' || fileName.startsWith('search');
  let page = section;


  const logoLink = shadow.querySelector('.logo');
  if (logoLink) {
    const homeUrl = withBase('/home/');
    logoLink.setAttribute('href', homeUrl);
    logoLink.addEventListener('click', (event) => {
      event.preventDefault();
      window.location.href = homeUrl;
    });
  }

  const SEARCH_HISTORY_KEY = 'bilm-search-history';
  const INCOGNITO_SEARCH_MAP_KEY = 'bilm-incognito-search-map';
  const storage = window.bilmTheme?.storage || {
    getJSON: (key, fallback = []) => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : fallback;
      } catch {
        return fallback;
      }
    },
    setJSON: (key, value) => {
      localStorage.setItem(key, JSON.stringify(value));
    }
  };

  function loadList(key) {
    const list = storage.getJSON(key, []);
    return Array.isArray(list) ? list : [];
  }

  function saveList(key, list) {
    storage.setJSON(key, list);
  }

  function saveSearchHistoryEntry(query) {
    const settings = window.bilmTheme?.getSettings?.() || {};
    if (settings.searchHistory === false || settings.incognito === true) return;
    const history = loadList(SEARCH_HISTORY_KEY);
    const normalizedQuery = query.toLowerCase();
    const next = [
      { query, updatedAt: Date.now() },
      ...history.filter((entry) => String(entry?.query || '').trim().toLowerCase() !== normalizedQuery)
    ].slice(0, 120);
    saveList(SEARCH_HISTORY_KEY, next);
  }

  function saveIncognitoSearch(query) {
    const token = Math.random().toString(36).slice(2, 12);
    let map = {};
    try {
      map = JSON.parse(sessionStorage.getItem(INCOGNITO_SEARCH_MAP_KEY) || '{}') || {};
    } catch {
      map = {};
    }
    map[token] = query;
    const orderedEntries = Object.entries(map).slice(-50);
    const compactMap = Object.fromEntries(orderedEntries);
    try {
      sessionStorage.setItem(INCOGNITO_SEARCH_MAP_KEY, JSON.stringify(compactMap));
    } catch {
      return query;
    }
    return token;
  }

  function submitSearch(query, { closeMobileOverlay = false } = {}) {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;
    const settings = window.bilmTheme?.getSettings?.() || {};
    saveSearchHistoryEntry(trimmedQuery);
    if (closeMobileOverlay) {
      const overlay = shadow.getElementById('mobileSearchOverlay');
      const input = shadow.getElementById('mobileSearchInput');
      const clearBtn = shadow.getElementById('mobileSearchCloseBtn');
      if (overlay) {
        overlay.classList.remove('active');
      }
      if (input) {
        input.value = '';
      }
      if (clearBtn) {
        clearBtn.style.display = 'none';
      }
      document.body.style.overflow = '';
    }
    const outgoingQuery = settings.incognito === true
      ? saveIncognitoSearch(trimmedQuery)
      : trimmedQuery;
    window.location.href = `${withBase('/search/')}?q=${encodeURIComponent(outgoingQuery)}`;
  }

  // Desktop nav buttons
  const buttons = shadow.querySelectorAll('nav.navbar button[data-page]');
  buttons.forEach(btn => {
    if (btn.dataset.page === page) {
      btn.classList.add('active');
    }
    btn.onclick = () => {
      const target = btn.dataset.page;
      window.location.href = withBase(`/${target === 'home' ? 'home' : target}/`);
    };
  });

  // Mobile nav buttons
  const mobileButtons = shadow.querySelectorAll('nav.mobile-bottom-nav button[data-page]');
  mobileButtons.forEach(btn => {
    if (btn.dataset.page === page || (isSearchPage && btn.dataset.page === 'search')) {
      btn.classList.add('active');
    }
    btn.onclick = () => {
      const target = btn.dataset.page;
      if (target === 'search') {
        const overlay = shadow.getElementById('mobileSearchOverlay');
        const input = shadow.getElementById('mobileSearchInput');
        overlay.classList.add('active');
        input.focus();
        document.body.style.overflow = 'hidden';
        return;
      }
      window.location.href = withBase(`/${target === 'home' ? 'home' : target}/`);
    };
  });


  const accountBtn = shadow.getElementById('navbarAccountBtn');
  loadAuthScript().then(async (authApi) => {
    await authApi.init();

    if (chatWidget) {
      chatWidget.hidden = false;
    }

    const syncAccountButton = (user) => {
      chatCurrentUser = user || null;
      if (!user) {
        renderChatMessages([]);
        if (chatMessagesUnsubscribe) {
          chatMessagesUnsubscribe();
          chatMessagesUnsubscribe = null;
        }
      }
      if (user && window.bilmAuthModules?.onSnapshot) {
        if (chatMessagesUnsubscribe) {
          chatMessagesUnsubscribe();
        }
        const modules = window.bilmAuthModules;
        const fs = modules.getFirestore();
        const chatCollection = modules.collection(modules.doc(fs, 'users', user.uid), 'sharedChat');
        const chatQuery = modules.query(chatCollection, modules.orderBy('createdAtMs', 'asc'), modules.limit(120));
        chatMessagesUnsubscribe = modules.onSnapshot(chatQuery, (snap) => {
          const rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
          renderChatMessages(rows);
        }, (error) => {
          console.warn('Shared chat listener failed:', error);
        });
      }
      if (!accountBtn) return;
      accountBtn.textContent = user ? (user.displayName || user.email || 'Account') : 'Account';
      accountBtn.title = user ? 'Open account settings / log out' : 'Log in or create account';
    };

    syncAccountButton(authApi.getCurrentUser());
    authApi.onAuthStateChanged(syncAccountButton);



    if (chatToggle) {
      chatToggle.addEventListener('click', () => {
        toggleChatPanel(chatPanel?.hidden);
      });
    }

    if (chatClose) {
      chatClose.addEventListener('click', () => toggleChatPanel(false));
    }

    if (chatForm && chatInput) {
      chatForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const text = chatInput.value.trim();
        if (!text || !chatCurrentUser) return;
        try {
          const modules = window.bilmAuthModules;
          if (!modules?.addDoc || !modules?.collection || !modules?.doc || !modules?.getFirestore) return;
          const fs = modules.getFirestore();
          const chatCollection = modules.collection(modules.doc(fs, 'users', chatCurrentUser.uid), 'sharedChat');
          await modules.addDoc(chatCollection, {
            text,
            author: chatCurrentUser.displayName || chatCurrentUser.email || 'Account',
            authorUid: chatCurrentUser.uid,
            createdAtMs: Date.now()
          });
          chatInput.value = '';
        } catch (error) {
          console.warn('Failed to send shared chat message:', error);
        }
      });
    }
  }).catch(() => {
    if (accountBtn) {
      accountBtn.textContent = 'Account';
      accountBtn.addEventListener('click', () => {
        window.location.href = withBase('/settings/account/');
      });
    }
  });

  const searchInput = shadow.querySelector('#searchInput');
  const navbarSearchForm = shadow.getElementById('navbarSearchForm');
  const desktopClearBtn = shadow.getElementById('desktopSearchClearBtn');
  if (navbarSearchForm && searchInput) {
    navbarSearchForm.addEventListener('submit', event => {
      event.preventDefault();
      submitSearch(searchInput.value);
    });

    const toggleDesktopClear = () => {
      if (!desktopClearBtn) return;
      const hasText = searchInput.value.trim().length > 0;
      desktopClearBtn.hidden = !hasText;
      desktopClearBtn.style.display = hasText ? 'flex' : 'none';
    };

    toggleDesktopClear();
    searchInput.addEventListener('input', toggleDesktopClear);
    if (desktopClearBtn) {
      desktopClearBtn.addEventListener('click', () => {
        searchInput.value = '';
        toggleDesktopClear();
        searchInput.focus();
      });
    }
  }

  // Mobile search overlay handlers (no changes here)
  const overlay = shadow.getElementById('mobileSearchOverlay');
  if (overlay) {
    const input = shadow.getElementById('mobileSearchInput');
    const clearBtn = shadow.getElementById('mobileSearchCloseBtn');
    const topCloseBtn = shadow.getElementById('mobileSearchTopCloseBtn');

    const closeOverlay = () => {
      overlay.classList.remove('active');
      input.value = '';
      clearBtn.style.display = 'none';
      document.body.style.overflow = '';
    };

    input.addEventListener('input', () => {
      clearBtn.style.display = input.value.length > 0 ? 'block' : 'none';
    });

    clearBtn.addEventListener('click', () => {
      input.value = '';
      clearBtn.style.display = 'none';
      input.focus();
    });

    topCloseBtn.addEventListener('click', closeOverlay);

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const query = input.value.trim();
        if (query) {
          submitSearch(query, { closeMobileOverlay: true });
        }
      } else if (e.key === 'Escape') {
        closeOverlay();
      }
    });
  }
})();
