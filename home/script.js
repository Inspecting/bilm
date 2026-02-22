function detectBasePath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const appRoots = new Set(['home', 'movies', 'tv', 'games', 'search', 'settings', 'random', 'test', 'shared', 'index.html']);
  if (!parts.length || appRoots.has(parts[0])) return '';
  return `/${parts[0]}`;
}

function withBase(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${detectBasePath()}${normalized}`;
}

document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');
  const homeSearchForm = document.getElementById('homeSearchForm');

  const continueWatchingSection = document.getElementById('continueWatchingSection');
  const favoritesSection = document.getElementById('favoritesSection');
  const watchLaterSection = document.getElementById('watchLaterSection');
  const continueItemsRow = document.getElementById('continueItems');
  const favoriteItemsRow = document.getElementById('favoriteItems');
  const watchLaterItemsRow = document.getElementById('watchLaterItems');
  const continueFilterButtons = [...document.querySelectorAll('#continueFilters .type-filter-btn')];
  const favoritesFilterButtons = [...document.querySelectorAll('#favoritesFilters .type-filter-btn')];
  const watchLaterFilterButtons = [...document.querySelectorAll('#watchLaterFilters .type-filter-btn')];
  const continueEditBtn = document.getElementById('continueEditBtn');
  const continueRemoveBtn = document.getElementById('continueRemoveBtn');
  const favoritesEditBtn = document.getElementById('favoritesEditBtn');
  const favoritesRemoveBtn = document.getElementById('favoritesRemoveBtn');
  const watchLaterEditBtn = document.getElementById('watchLaterEditBtn');
  const watchLaterRemoveBtn = document.getElementById('watchLaterRemoveBtn');

  const CONTINUE_KEY = 'bilm-continue-watching';
  const FAVORITES_KEY = 'bilm-favorites';
  const WATCH_LATER_KEY = 'bilm-watch-later';
  const SEARCH_HISTORY_KEY = 'bilm-search-history';
  const TMDB_API_KEY = '3ade810499876bb5672f40e54960e6a2';
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

  document.querySelector('main').classList.add('visible');

  function runSearch() {
    const query = searchInput.value.trim();
    if (!query) {
      alert('Please enter a search term');
      return;
    }

    const settings = window.bilmTheme?.getSettings?.() || {};
    if (settings.searchHistory !== false && settings.incognito !== true) {
      const history = loadList(SEARCH_HISTORY_KEY);
      const next = [
        { query, updatedAt: Date.now() },
        ...history
      ].slice(0, 10);
      saveList(SEARCH_HISTORY_KEY, next);
    }

    window.location.href = `${withBase('/search/')}?q=${encodeURIComponent(query)}`;
  }

  searchBtn.addEventListener('click', (event) => {
    event.preventDefault();
    runSearch();
  });

  homeSearchForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    runSearch();
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runSearch();
    }
  });

  function loadList(key) {
    const list = storage.getJSON(key, []);
    return Array.isArray(list) ? list : [];
  }

  function saveList(key, items) {
    storage.setJSON(key, items);
  }

  function toYear(dateString) {
    if (!dateString) return 'N/A';
    const parsed = new Date(dateString);
    if (Number.isNaN(parsed.getTime())) return 'N/A';
    return parsed.getFullYear();
  }

  function normalizeMediaRating(item) {
    const candidates = [
      item?.rating,
      item?.vote_average,
      item?.voteAverage,
      item?.score,
      item?.tmdbRating
    ];

    for (const candidate of candidates) {
      if (candidate === undefined || candidate === null) continue;
      const numeric = Number.parseFloat(String(candidate).replace(/[^\d.]/g, ''));
      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
      }
    }

    return null;
  }

  async function fetchJSON(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch {
      return null;
    }
  }

  function needsRatingHydration(item) {
    return normalizeMediaRating(item) === null && Number(item?.tmdbId || item?.id) > 0;
  }

  async function hydrateRatingsForKey(key, expectedType) {
    const items = loadList(key);
    const targets = items.filter((item) => {
      if (expectedType && item?.type && item.type !== expectedType) return false;
      return needsRatingHydration(item);
    });
    if (!targets.length) return;

    const updates = await Promise.all(targets.map(async (item) => {
      const tmdbId = Number(item?.tmdbId || item?.id);
      const mediaType = item?.type === 'tv' ? 'tv' : expectedType || 'movie';
      if (!tmdbId) return null;
      const details = await fetchJSON(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${TMDB_API_KEY}`);
      const rating = Number(details?.vote_average);
      const source = details?.id ? 'TMDB' : item?.source;
      if (!Number.isFinite(rating) || rating <= 0) return source ? { key: item.key, source } : null;
      return { key: item.key, rating, vote_average: rating, source };
    }));

    const mapped = new Map(updates.filter(Boolean).map((entry) => [entry.key, entry]));
    if (!mapped.size) return;

    const next = items.map((item) => {
      const update = mapped.get(item.key);
      if (!update) return item;
      return {
        ...item,
        ...(update.rating ? { rating: update.rating, vote_average: update.rating, tmdbRating: update.rating } : {}),
        ...(update.source ? { source: update.source } : {})
      };
    });

    saveList(key, next);
  }

  async function hydrateStoredRatings() {
    await Promise.all([
      hydrateRatingsForKey(CONTINUE_KEY),
      hydrateRatingsForKey(FAVORITES_KEY),
      hydrateRatingsForKey(WATCH_LATER_KEY)
    ]);
  }

  function normalizeMediaLink(item) {
    const rawLink = String(item?.link || '');
    const fallbackId = item?.tmdbId || item?.id;
    const mediaType = item?.type === 'tv' ? 'tv' : 'movie';
    const detailsBase = mediaType === 'tv'
      ? withBase('/tv/show.html')
      : withBase('/movies/show.html');

    if (!rawLink && fallbackId) return `${detailsBase}?id=${encodeURIComponent(fallbackId)}`;
    if (!rawLink) return '';

    try {
      const resolved = new URL(rawLink, window.location.origin);
      const movieId = resolved.searchParams.get('id') || fallbackId;
      const internalRelativeRoute = /\/?movie\.html$/i.test(resolved.pathname)
        || /\/home\/(?:movie\.html|viewer\.html|show\.html)$/i.test(resolved.pathname)
        || /\/show\.html$/i.test(resolved.pathname);
      const pointsToOldMovieRoute = /\/movies\/(?:viewer\.html|watch\/viewer\.html)$/i.test(resolved.pathname)
        || /\/movies\/?$/i.test(resolved.pathname)
        || /\/tv\/(?:viewer\.html|watch\/viewer\.html)$/i.test(resolved.pathname)
        || /\/tv\/?$/i.test(resolved.pathname);
      if ((pointsToOldMovieRoute || internalRelativeRoute) && movieId) {
        return `${detailsBase}?id=${encodeURIComponent(movieId)}`;
      }

      if (resolved.origin === window.location.origin && movieId) {
        if (mediaType === 'movie' && /\/(home\/)?tv\//i.test(resolved.pathname)) {
          return `${detailsBase}?id=${encodeURIComponent(movieId)}`;
        }
        if (mediaType === 'tv' && /\/(home\/)?movies?\//i.test(resolved.pathname)) {
          return `${detailsBase}?id=${encodeURIComponent(movieId)}`;
        }
      }
    } catch {
      if (fallbackId) return `${detailsBase}?id=${encodeURIComponent(fallbackId)}`;
    }

    return rawLink;
  }

  const sectionState = {
    continue: {
      editing: false,
      selected: new Set(),
      filter: 'all'
    },
    favorites: {
      editing: false,
      selected: new Set(),
      filter: 'all'
    },
    watchLater: {
      editing: false,
      selected: new Set(),
      filter: 'all'
    }
  };

  const sectionControls = {
    continue: {
      section: continueWatchingSection,
      itemsRow: continueItemsRow,
      filterButtons: continueFilterButtons,
      editBtn: continueEditBtn,
      removeBtn: continueRemoveBtn,
      storageKey: CONTINUE_KEY,
      removeLabel: 'Remove from continue watching',
      confirmRemoveSingle: 'Remove this item from continue watching?',
      confirmRemoveBulk: 'Remove selected items from Continue Watching?'
    },
    favorites: {
      section: favoritesSection,
      itemsRow: favoriteItemsRow,
      filterButtons: favoritesFilterButtons,
      editBtn: favoritesEditBtn,
      removeBtn: favoritesRemoveBtn,
      storageKey: FAVORITES_KEY,
      removeLabel: 'Remove from favorites',
      confirmRemoveSingle: 'Remove this item from favorites?',
      confirmRemoveBulk: 'Remove selected items from Favorites?'
    },
    watchLater: {
      section: watchLaterSection,
      itemsRow: watchLaterItemsRow,
      filterButtons: watchLaterFilterButtons,
      editBtn: watchLaterEditBtn,
      removeBtn: watchLaterRemoveBtn,
      storageKey: WATCH_LATER_KEY,
      removeLabel: 'Remove from watch later',
      confirmRemoveSingle: 'Remove this item from Watch Later?',
      confirmRemoveBulk: 'Remove selected items from Watch Later?'
    }
  };

  function setEditing(section, isEditing) {
    const state = sectionState[section];
    state.editing = isEditing;
    if (!isEditing) {
      state.selected.clear();
    }
    updateEditUI(section);
    renderSections();
  }

  function updateEditUI(section) {
    const state = sectionState[section];
    const isEditing = state.editing;
    const controls = sectionControls[section];
    if (!controls) return;
    controls.editBtn.textContent = isEditing ? 'Done' : 'Edit';
    controls.section.classList.toggle('is-editing', isEditing);
    controls.removeBtn.hidden = !isEditing;
    controls.removeBtn.disabled = state.selected.size === 0;
  }

  function updateFilterButtons(section) {
    const buttons = sectionControls[section]?.filterButtons;
    if (!buttons) return;
    const activeFilter = sectionState[section].filter;
    buttons.forEach(button => {
      button.classList.toggle('is-active', button.dataset.filter === activeFilter);
    });
  }

  function renderRow(container, items, emptyMessage, section) {
    container.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = emptyMessage || 'Nothing here yet.';
      container.appendChild(empty);
      return;
    }

    items.forEach(item => {
      const state = sectionState[section];
      const card = window.BilmMediaCard.createMediaCard({
        item: {
          title: item.title,
          year: item.year || toYear(item.date) || 'N/A',
          type: item.type,
          img: item.poster,
          source: item.source || 'TMDB',
          rating: normalizeMediaRating(item),
          link: normalizeMediaLink(item)
        },
        className: 'movie-card',
        badgeClassName: 'source-badge-overlay',
        metaClassName: 'card-meta',
        titleClassName: 'card-title',
        subtitleClassName: 'card-subtitle'
      });

      if (state.editing) {
        card.classList.add('is-editing');
      }
      if (state.selected.has(item.key)) {
        card.classList.add('is-selected');
      }

      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = 'card-action';
      actionBtn.textContent = '✕';
      const controls = sectionControls[section];
      actionBtn.setAttribute('aria-label', controls?.removeLabel || 'Remove');
      actionBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const confirmRemove = confirm(controls?.confirmRemoveSingle || 'Remove this item?');
        if (!confirmRemove) return;
        const list = loadList(controls?.storageKey).filter(entry => entry.key !== item.key);
        saveList(controls?.storageKey, list);
        state.selected.delete(item.key);
        updateEditUI(section);
        renderSections();
      });

      card.appendChild(actionBtn);

      card.onclick = () => {
        if (state.editing) {
          if (state.selected.has(item.key)) {
            state.selected.delete(item.key);
          } else {
            state.selected.add(item.key);
          }
          updateEditUI(section);
          renderSections();
          return;
        }
        const destination = normalizeMediaLink(item);
        if (destination) {
          window.location.href = destination;
        }
      };

      container.appendChild(card);
    });
  }

  function sortByRecent(items) {
    return [...items].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function applyTypeFilter(items, filter) {
    if (filter === 'all') return items;
    return items.filter(item => item.type === filter);
  }

  function renderSections() {
    const continueItems = sortByRecent(loadList(CONTINUE_KEY));
    const favoriteItems = sortByRecent(loadList(FAVORITES_KEY));
    const watchLaterItems = sortByRecent(loadList(WATCH_LATER_KEY));

    const continueFilteredItems = applyTypeFilter(continueItems, sectionState.continue.filter);
    const favoritesFilteredItems = applyTypeFilter(favoriteItems, sectionState.favorites.filter);
    const watchLaterFilteredItems = applyTypeFilter(watchLaterItems, sectionState.watchLater.filter);

    const continueEmpty = sectionState.continue.filter === 'movie'
      ? 'Start a movie to see it here.'
      : sectionState.continue.filter === 'tv'
        ? 'Start a show to keep your place.'
        : 'Start watching something to build your list.';

    const favoritesEmpty = sectionState.favorites.filter === 'movie'
      ? 'Save movies you love for quick access.'
      : sectionState.favorites.filter === 'tv'
        ? 'Favorite TV shows appear here.'
        : 'Favorite anything you want quick access to.';

    const watchLaterEmpty = sectionState.watchLater.filter === 'movie'
      ? 'Queue movies to watch later.'
      : sectionState.watchLater.filter === 'tv'
        ? 'Save TV shows for later.'
        : 'Save anything you want to watch later.';

    renderRow(continueItemsRow, continueFilteredItems, continueEmpty, 'continue');
    renderRow(favoriteItemsRow, favoritesFilteredItems, favoritesEmpty, 'favorites');
    renderRow(watchLaterItemsRow, watchLaterFilteredItems, watchLaterEmpty, 'watchLater');
  }

  continueEditBtn.addEventListener('click', () => {
    setEditing('continue', !sectionState.continue.editing);
  });

  favoritesEditBtn.addEventListener('click', () => {
    setEditing('favorites', !sectionState.favorites.editing);
  });

  watchLaterEditBtn.addEventListener('click', () => {
    setEditing('watchLater', !sectionState.watchLater.editing);
  });

  continueRemoveBtn.addEventListener('click', () => {
    const state = sectionState.continue;
    if (!state.selected.size) return;
    const confirmRemove = confirm('Remove selected items from Continue Watching?');
    if (!confirmRemove) return;
    const list = loadList(CONTINUE_KEY).filter(item => !state.selected.has(item.key));
    saveList(CONTINUE_KEY, list);
    state.selected.clear();
    updateEditUI('continue');
    renderSections();
  });

  favoritesRemoveBtn.addEventListener('click', () => {
    const state = sectionState.favorites;
    if (!state.selected.size) return;
    const confirmRemove = confirm(sectionControls.favorites.confirmRemoveBulk);
    if (!confirmRemove) return;
    const list = loadList(FAVORITES_KEY).filter(item => !state.selected.has(item.key));
    saveList(FAVORITES_KEY, list);
    state.selected.clear();
    updateEditUI('favorites');
    renderSections();
  });

  watchLaterRemoveBtn.addEventListener('click', () => {
    const state = sectionState.watchLater;
    if (!state.selected.size) return;
    const confirmRemove = confirm(sectionControls.watchLater.confirmRemoveBulk);
    if (!confirmRemove) return;
    const list = loadList(WATCH_LATER_KEY).filter(item => !state.selected.has(item.key));
    saveList(WATCH_LATER_KEY, list);
    state.selected.clear();
    updateEditUI('watchLater');
    renderSections();
  });

  continueFilterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      sectionState.continue.filter = button.dataset.filter;
      updateFilterButtons('continue');
      renderSections();
    });
  });

  favoritesFilterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      sectionState.favorites.filter = button.dataset.filter;
      updateFilterButtons('favorites');
      renderSections();
    });
  });

  watchLaterFilterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      sectionState.watchLater.filter = button.dataset.filter;
      updateFilterButtons('watchLater');
      renderSections();
    });
  });

  renderSections();
  hydrateStoredRatings().then(renderSections);
  updateEditUI('continue');
  updateEditUI('favorites');
  updateEditUI('watchLater');
  updateFilterButtons('continue');
  updateFilterButtons('favorites');
  updateFilterButtons('watchLater');

  window.addEventListener('storage', renderSections);
});
