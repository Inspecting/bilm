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

  const pathParts = location.pathname.split('/').filter(Boolean);
  let page = pathParts.at(-1)?.split('.')[0] || 'home';
  if (page === '') page = 'home';

  // Detect if on viewer page inside movies or tv folder
  if (page === 'viewer' && pathParts.length >= 2) {
    const parentFolder = pathParts[pathParts.length - 2];
    if (parentFolder === 'movies') page = 'movies';
    else if (parentFolder === 'tv') page = 'tv';
  }

  const isSearchPage = page === 'search';


  const SEARCH_HISTORY_KEY = 'bilm-search-history-v1';

  function getSearchHistory() {
    try {
      const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function storeSearchQuery(query, source = 'navbar') {
    const trimmed = query.trim();
    if (!trimmed) return;
    const settings = window.bilmTheme?.getSettings?.() || {};
    if (settings.searchHistory === false) return;

    if (window.bilmHistory?.upsertSearchHistory) {
      window.bilmHistory.upsertSearchHistory({ query: trimmed, source });
      return;
    }

    const next = [
      { query: trimmed, source, updatedAt: Date.now() },
      ...getSearchHistory().filter((item) => (item.query || '').toLowerCase() !== trimmed.toLowerCase())
    ].slice(0, 10);

    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
  }

  function goToSearch(query) {
    const trimmed = query.trim();
    if (!trimmed) return;
    window.location.href = `/bilm/home/search.html?q=${encodeURIComponent(trimmed)}`;
  }

  // Desktop nav buttons
  const buttons = shadow.querySelectorAll('nav.navbar button[data-page]');
  buttons.forEach(btn => {
    if (btn.dataset.page === page || (isSearchPage && btn.dataset.page === 'home')) {
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

  // Search input handlers (no changes here)
  const searchInput = shadow.querySelector('#searchInput');
  if (searchInput) {
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const query = searchInput.value.trim();
        if (query) {
          storeSearchQuery(query, 'desktop-navbar');
          goToSearch(query);
        }
      }
    });
  }

  // Mobile search overlay handlers
  const overlay = shadow.getElementById('mobileSearchOverlay');
  if (overlay) {
    const input = shadow.getElementById('mobileSearchInput');
    const clearBtn = shadow.getElementById('mobileSearchCloseBtn');
    const topCloseBtn = shadow.getElementById('mobileSearchTopCloseBtn');
    const recentsContainer = shadow.getElementById('mobileRecentSearches');

    const renderRecentSearches = () => {
      if (!recentsContainer) return;
      const settings = window.bilmTheme?.getSettings?.() || {};
      if (settings.searchHistory === false) {
        recentsContainer.innerHTML = '<div class="mobile-recent-empty">Search history is turned off in Settings.</div>';
        return;
      }

      const recent = (window.bilmHistory?.getSearchHistory?.() || getSearchHistory()).slice(0, 10);
      if (!recent.length) {
        recentsContainer.innerHTML = '<div class="mobile-recent-empty">No recent searches yet.</div>';
        return;
      }

      recentsContainer.innerHTML = '';
      recent.forEach((entry) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mobile-recent-chip';
        btn.textContent = entry.query;
        btn.addEventListener('click', () => {
          input.value = entry.query;
          storeSearchQuery(entry.query, 'mobile-recent');
          goToSearch(entry.query);
        });
        recentsContainer.appendChild(btn);
      });
    };

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
          storeSearchQuery(query, 'mobile-navbar');
          goToSearch(query);
        }
      } else if (e.key === 'Escape') {
        closeOverlay();
      }
    });

    overlay.addEventListener('transitionend', renderRecentSearches);
    window.addEventListener('bilm:theme-changed', renderRecentSearches);

    const mobileSearchBtn = shadow.getElementById('mobileSearchBtn');
    if (mobileSearchBtn) {
      mobileSearchBtn.addEventListener('click', () => {
        renderRecentSearches();
      });
    }
  }
})();