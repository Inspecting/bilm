(async () => {
  const container = document.getElementById('navbar-placeholder') || document.getElementById('navbarContainer');
  if (!container) return;

  const shadow = container.attachShadow({ mode: 'open' });

  const [htmlRes, cssRes] = await Promise.all([
    fetch('/bilm.github.io/shared/navbar.html'),
    fetch('/bilm.github.io/shared/navbar.css')
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

  // Desktop nav buttons
  const buttons = shadow.querySelectorAll('nav.navbar button[data-page]');
  buttons.forEach(btn => {
    if (btn.dataset.page === page || (isSearchPage && btn.dataset.page === 'home')) {
      btn.classList.add('active');
    }
    btn.onclick = () => {
      const target = btn.dataset.page;
      window.location.href = `/bilm.github.io/${target === 'home' ? 'home/' : target}/`;
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
      window.location.href = `/bilm.github.io/${target === 'home' ? 'home/' : target}/`;
    };
  });

  // Search input handlers (no changes here)
  const searchInput = shadow.querySelector('#searchInput');
  if (searchInput) {
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const query = searchInput.value.trim();
        if (query) {
          window.location.href = `/bilm.github.io/home/search.html?q=${encodeURIComponent(query)}`;
        }
      }
    });
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
          window.location.href = `/bilm.github.io/home/search.html?q=${encodeURIComponent(query)}`;
        }
      } else if (e.key === 'Escape') {
        closeOverlay();
      }
    });
  }
})();