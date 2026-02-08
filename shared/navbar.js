(async () => {
  const container = document.getElementById('navbar-placeholder') || document.getElementById('navbarContainer');
  if (!container) return;

  const shadow = container.attachShadow({ mode: 'open' });

  const [htmlRes, cssRes] = await Promise.all([
    fetch('/bilm/shared/navbar.html'),
    fetch('/bilm/shared/navbar.css')
  ]);

  const html = await htmlRes.text();
  const css = await cssRes.text();

  shadow.innerHTML = `<style>${css}</style>${html}`;

  const loadScript = (src) => new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });

  const ensureAuth = async () => {
    if (!window.bilmAuth) {
      await loadScript('/bilm/shared/auth.js');
    }
    return window.bilmAuth;
  };

  const pathParts = location.pathname.split('/').filter(Boolean);
  const bilmIndex = pathParts.indexOf('bilm');
  const section = bilmIndex >= 0 ? pathParts[bilmIndex + 1] : pathParts[0];
  const fileName = pathParts.at(-1) || '';
  const isSearchPage = fileName.startsWith('search');
  let page = section || 'home';

  const SEARCH_HISTORY_KEY = 'bilm-search-history';

  function loadList(key) {
    try {
      const raw = localStorage.getItem(key);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function saveList(key, list) {
    localStorage.setItem(key, JSON.stringify(list));
  }

  function saveSearchHistoryEntry(query) {
    const settings = window.bilmTheme?.getSettings?.() || {};
    if (settings.searchHistory === false) return;
    const history = loadList(SEARCH_HISTORY_KEY);
    const next = [
      { query, updatedAt: Date.now() },
      ...history
    ].slice(0, 10);
    saveList(SEARCH_HISTORY_KEY, next);
  }

  function submitSearch(query, { closeMobileOverlay = false } = {}) {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;
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
    window.location.href = `/bilm/search/?q=${encodeURIComponent(trimmedQuery)}`;
  }

  // Desktop nav buttons
  const buttons = shadow.querySelectorAll('nav.navbar button[data-page]');
  buttons.forEach(btn => {
    if (btn.dataset.page === page) {
      btn.classList.add('active');
    }
    btn.onclick = () => {
      const target = btn.dataset.page;
      window.location.href = `/bilm/${target === 'home' ? 'home/' : target}/`;
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
      window.location.href = `/bilm/${target === 'home' ? 'home/' : target}/`;
    };
  });

  const searchInput = shadow.querySelector('#searchInput');
  const navbarSearchForm = shadow.getElementById('navbarSearchForm');
  if (navbarSearchForm && searchInput) {
    navbarSearchForm.addEventListener('submit', event => {
      event.preventDefault();
      submitSearch(searchInput.value);
    });
  }

  const accountButton = shadow.getElementById('accountButton');
  if (accountButton) {
    const updateAccountButton = async () => {
      const auth = await ensureAuth();
      if (!auth) return;
      await auth.init();
      const profile = await auth.getProfile();
      if (profile?.username) {
        accountButton.textContent = profile.username;
        accountButton.setAttribute('aria-label', `Account for ${profile.username}`);
      } else {
        accountButton.textContent = 'Login';
        accountButton.setAttribute('aria-label', 'Login');
      }
    };

    updateAccountButton();

    try {
      const auth = await ensureAuth();
      if (auth) {
        const config = auth.readConfig();
        const client = await auth.init();
        if (config && client) {
          auth.startAutoSync();
          client.auth?.onAuthStateChange(() => {
            updateAccountButton();
          });
        }
      }
    } catch (error) {
      console.warn('Auth unavailable:', error);
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
