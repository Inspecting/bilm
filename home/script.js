function detectBasePath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const appRoots = new Set(['home', 'movies', 'tv', 'games', 'search', 'settings', 'random', 'test', 'shared', 'index.html']);
  if (!parts.length || appRoots.has(parts[0])) return '';
  if (parts.length > 1 && appRoots.has(parts[1])) return `/${parts[0]}`;
  return '';
}

function withBase(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${detectBasePath()}${normalized}`;
}

const APP_ROUTE_PATTERN = /^\/(?:home|movies|tv|games|search|settings|random|test|shared)(?:\/|$)/i;
const HOME_ROW_BATCH_SIZE = 24;
const HOME_ROW_RENDER_CHUNK_SIZE = 8;

function normalizeInternalAppPath(pathname = '') {
  const rawPath = String(pathname || '').trim();
  if (!rawPath) return '';
  const normalizedPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const basePath = detectBasePath();
  if (!basePath) return normalizedPath;
  if (normalizedPath === basePath || normalizedPath.startsWith(`${basePath}/`)) return normalizedPath;
  if (!APP_ROUTE_PATTERN.test(normalizedPath)) return normalizedPath;
  return `${basePath}${normalizedPath}`;
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
      const normalizedQuery = query.toLowerCase();
      const next = [
        { query, updatedAt: Date.now() },
        ...history.filter((entry) => String(entry?.query || '').trim().toLowerCase() !== normalizedQuery)
      ].slice(0, 120);
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

  function parseStoredMediaIdentity(item) {
    const typeFromItem = item?.type === 'tv' ? 'tv' : item?.type === 'movie' ? 'movie' : '';
    const idFromItem = Number(item?.tmdbId || item?.id);
    if (typeFromItem && idFromItem > 0) {
      return { mediaType: typeFromItem, tmdbId: idFromItem };
    }

    const rawLink = String(item?.link || '');
    if (!rawLink) {
      return {
        mediaType: typeFromItem || 'movie',
        tmdbId: idFromItem > 0 ? idFromItem : 0
      };
    }

    try {
      const resolved = new URL(rawLink, window.location.href);
      const linkId = Number(resolved.searchParams.get('id') || item?.tmdbId || item?.id);
      const inferredType = /\/tv\//i.test(resolved.pathname)
        ? 'tv'
        : /\/movies?\//i.test(resolved.pathname)
          ? 'movie'
          : (typeFromItem || 'movie');
      return {
        mediaType: inferredType,
        tmdbId: Number.isFinite(linkId) && linkId > 0 ? linkId : 0
      };
    } catch {
      return {
        mediaType: typeFromItem || 'movie',
        tmdbId: idFromItem > 0 ? idFromItem : 0
      };
    }
  }

  function normalizeCertification(value) {
    const normalized = String(value || '').trim();
    return normalized;
  }

  function pickMovieCertification(items) {
    const list = Array.isArray(items) ? items : [];
    const us = list.find((entry) => entry?.iso_3166_1 === 'US');
    const fromUs = us?.release_dates?.find((entry) => String(entry?.certification || '').trim())?.certification;
    if (String(fromUs || '').trim()) return String(fromUs).trim();

    for (const entry of list) {
      const value = entry?.release_dates?.find((row) => String(row?.certification || '').trim())?.certification;
      if (String(value || '').trim()) return String(value).trim();
    }
    return '';
  }

  function pickTvCertification(items) {
    const list = Array.isArray(items) ? items : [];
    const us = list.find((entry) => entry?.iso_3166_1 === 'US');
    const fromUs = String(us?.rating || '').trim();
    if (fromUs) return fromUs;

    for (const entry of list) {
      const value = String(entry?.rating || '').trim();
      if (value) return value;
    }
    return '';
  }

  async function fetchJSON(url) {
    const rawUrl = String(url || '').trim();
    const buildBackupUrl = () => {
      try {
        const parsed = new URL(rawUrl, window.location.href);
        if (parsed.origin !== 'https://storage-api.watchbilm.org') return '';
        if (!parsed.pathname.startsWith('/media/tmdb/')) return '';
        const tmdbPath = parsed.pathname.slice('/media/tmdb/'.length);
        const backup = new URL(`https://api.themoviedb.org/3/${tmdbPath}`);
        parsed.searchParams.forEach((value, key) => {
          if (String(key || '').toLowerCase() === 'api_key') return;
          backup.searchParams.append(key, value);
        });
        backup.searchParams.set('api_key', TMDB_API_KEY);
        return backup.toString();
      } catch {
        return '';
      }
    };

    try {
      const response = await fetch(rawUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      const backupUrl = buildBackupUrl();
      if (!backupUrl) return null;
      try {
        console.info('[api-fallback] home fetch using backup provider', {
          primaryUrl: rawUrl,
          backupUrl
        });
        const backupResponse = await fetch(backupUrl);
        if (!backupResponse.ok) throw new Error(`HTTP ${backupResponse.status}`);
        return await backupResponse.json();
      } catch {
        console.warn('Home API fallback failed:', error);
        return null;
      }
    }
  }

  function needsRatingHydration(item) {
    const identity = parseStoredMediaIdentity(item);
    return normalizeMediaRating(item) === null && identity.tmdbId > 0;
  }

  function needsCertificationHydration(item) {
    const identity = parseStoredMediaIdentity(item);
    return !normalizeCertification(item?.certification) && identity.tmdbId > 0;
  }

  async function hydrateRatingsForKey(key, expectedType) {
    const items = loadList(key);
    const targets = items.filter((item) => {
      if (expectedType && item?.type && item.type !== expectedType) return false;
      return needsRatingHydration(item) || needsCertificationHydration(item) || !item?.type || !Number(item?.tmdbId || item?.id);
    });
    if (!targets.length) return;

    const updates = await Promise.all(targets.map(async (item) => {
      const identity = parseStoredMediaIdentity(item);
      const tmdbId = identity.tmdbId;
      const mediaType = identity.mediaType || expectedType || 'movie';
      if (!tmdbId) return null;
      const details = await fetchJSON(`https://storage-api.watchbilm.org/media/tmdb/${mediaType}/${tmdbId}`);
      const rating = Number(details?.vote_average);
      const source = details?.id ? 'TMDB' : item?.source;
      const endpoint = mediaType === 'movie' ? 'release_dates' : 'content_ratings';
      const ratingsData = await fetchJSON(`https://storage-api.watchbilm.org/media/tmdb/${mediaType}/${tmdbId}/${endpoint}`);
      const certification = mediaType === 'movie'
        ? pickMovieCertification(ratingsData?.results)
        : pickTvCertification(ratingsData?.results);

      if (!Number.isFinite(rating) || rating <= 0) {
        return {
          key: item.key,
          source,
          type: mediaType,
          tmdbId,
          ...(certification ? { certification } : {})
        };
      }
      return { key: item.key, rating, vote_average: rating, source, type: mediaType, tmdbId, ...(certification ? { certification } : {}) };
    }));

    const mapped = new Map(updates.filter(Boolean).map((entry) => [entry.key, entry]));
    if (!mapped.size) return;

    const next = items.map((item) => {
      const update = mapped.get(item.key);
      if (!update) return item;
      return {
        ...item,
        ...(update.rating ? { rating: update.rating, vote_average: update.rating, tmdbRating: update.rating } : {}),
        ...(update.source ? { source: update.source } : {}),
        ...(update.type ? { type: update.type } : {}),
        ...(update.tmdbId ? { tmdbId: update.tmdbId, id: update.tmdbId } : {}),
        ...(update.certification ? { certification: update.certification } : {})
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
      const resolved = new URL(rawLink, window.location.href);
      const movieId = resolved.searchParams.get('id') || fallbackId;
      const normalizedPath = normalizeInternalAppPath(resolved.pathname);
      const normalizedSameOriginHref = `${normalizedPath}${resolved.search}${resolved.hash}`;
      const pointsToCurrentDetailsRoute = /\/(?:tv|movies)\/show\.html$/i.test(normalizedPath);
      if (movieId && (mediaType === 'movie' || mediaType === 'tv')) {
        const pointsToWrongTypeDetails = (
          (mediaType === 'movie' && /\/tv\//i.test(normalizedPath))
          || (mediaType === 'tv' && /\/movies?\//i.test(normalizedPath))
        );
        if (pointsToCurrentDetailsRoute || pointsToWrongTypeDetails) {
          return `${detailsBase}?id=${encodeURIComponent(movieId)}`;
        }
      }
      const internalRelativeRoute = /\/?movie\.html$/i.test(normalizedPath)
        || /\/home\/(?:movie\.html|viewer\.html|show\.html)$/i.test(normalizedPath)
        || /\/show\.html$/i.test(normalizedPath)
        || /\/home\/(?:movie\.html|viewer\.html)$/i.test(normalizedPath);
      const pointsToLegacyHomeDetailsRoute = /\/(?:home\/)?show\.html$/i.test(normalizedPath);
      const pointsToOldMovieRoute = /\/movies\/(?:viewer\.html|watch\/viewer\.html)$/i.test(normalizedPath)
        || /\/movies\/?$/i.test(normalizedPath)
        || /\/tv\/(?:viewer\.html|watch\/viewer\.html)$/i.test(normalizedPath)
        || /\/tv\/?$/i.test(normalizedPath);
      if ((pointsToOldMovieRoute || internalRelativeRoute || pointsToLegacyHomeDetailsRoute) && movieId) {
        return `${detailsBase}?id=${encodeURIComponent(movieId)}`;
      }

      if (resolved.origin === window.location.origin) {
        if (movieId && mediaType === 'movie' && /\/(home\/)?tv\//i.test(normalizedPath)) {
          return `${detailsBase}?id=${encodeURIComponent(movieId)}`;
        }
        if (movieId && mediaType === 'tv' && /\/(home\/)?movies?\//i.test(normalizedPath)) {
          return `${detailsBase}?id=${encodeURIComponent(movieId)}`;
        }
        return normalizedSameOriginHref;
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
    if (container.__bilmRowObserver) {
      container.__bilmRowObserver.disconnect();
      container.__bilmRowObserver = null;
    }
    container.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = emptyMessage || 'Nothing here yet.';
      container.appendChild(empty);
      return;
    }

    const state = sectionState[section];
    const controls = sectionControls[section];
    const renderToken = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    container.__bilmRenderToken = renderToken;

    function createCard(item) {
      const identity = parseStoredMediaIdentity(item);
      const card = window.BilmMediaCard.createMediaCard({
        item: {
          title: item.title,
          year: item.year || toYear(item.date) || 'N/A',
          type: item.type || identity.mediaType,
          tmdbId: Number(item?.tmdbId || identity.tmdbId || 0) || undefined,
          id: Number(item?.id || identity.tmdbId || 0) || undefined,
          img: item.poster,
          source: item.source || 'TMDB',
          rating: normalizeMediaRating(item),
          certification: item.certification,
          link: normalizeMediaLink(item)
        },
        className: 'movie-card',
        badgeClassName: 'source-badge-overlay',
        metaClassName: 'card-meta',
        titleClassName: 'card-title',
        subtitleClassName: 'card-subtitle'
      });
      if (!(card instanceof HTMLElement)) {
        return document.createDocumentFragment();
      }

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

      return card;
    }

    let renderedCount = 0;
    const supportsObserver = typeof window.IntersectionObserver === 'function';

    const appendNextBatch = () => {
      if (container.__bilmRenderToken !== renderToken) return;
      const nextItems = items.slice(renderedCount, renderedCount + HOME_ROW_BATCH_SIZE);
      if (!nextItems.length) return;

      let index = 0;
      const appendChunk = () => {
        if (container.__bilmRenderToken !== renderToken) return;
        const fragment = document.createDocumentFragment();
        const chunkEnd = Math.min(index + HOME_ROW_RENDER_CHUNK_SIZE, nextItems.length);
        while (index < chunkEnd) {
          fragment.appendChild(createCard(nextItems[index]));
          index += 1;
        }
        container.appendChild(fragment);
        if (index < nextItems.length) {
          window.requestAnimationFrame(appendChunk);
          return;
        }
        renderedCount += nextItems.length;
        if (renderedCount >= items.length) return;

        const sentinel = document.createElement('div');
        sentinel.className = 'card-load-sentinel';
        sentinel.setAttribute('aria-hidden', 'true');
        sentinel.style.width = '1px';
        sentinel.style.height = '1px';
        sentinel.style.flex = '0 0 auto';
        container.appendChild(sentinel);

        if (!supportsObserver) {
          sentinel.remove();
          appendNextBatch();
          return;
        }

        const observer = new IntersectionObserver((entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          observer.disconnect();
          container.__bilmRowObserver = null;
          sentinel.remove();
          appendNextBatch();
        }, {
          root: container,
          rootMargin: '0px 260px 0px 0px',
          threshold: 0.01
        });
        observer.observe(sentinel);
        container.__bilmRowObserver = observer;
      };

      appendChunk();
    };

    appendNextBatch();
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
