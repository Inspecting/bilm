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
  const SEARCH_HISTORY_KEY = 'bilm-search-history';
  const WATCH_HISTORY_KEY = 'bilm-watch-history';
  const LEGACY_WATCH_HISTORY_KEY = 'bilm-continue-watching';
  const HISTORY_PREFS_KEY = 'bilm-history-page-prefs';
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

  const state = {
    activeType: 'search',
    sortOrder: 'recent',
    watchFilter: 'all',
    dateRange: 'all',
    textFilter: '',
    selectMode: false,
    compactView: false,
    selectedKeys: new Set(),
    pageSize: 25,
    visibleLimit: 25,
    loadingMore: false
  };

  const searchTabBtn = document.getElementById('searchTabBtn');
  const watchTabBtn = document.getElementById('watchTabBtn');
  const sortRecentBtn = document.getElementById('sortRecentBtn');
  const sortOldBtn = document.getElementById('sortOldBtn');
  const selectModeBtn = document.getElementById('selectModeBtn');
  const selectAllBtn = document.getElementById('selectAllBtn');
  const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
  const cancelSelectBtn = document.getElementById('cancelSelectBtn');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');
  const watchFilters = document.getElementById('watchFilters');
  const historyList = document.getElementById('historyList');
  const searchFilterInput = document.getElementById('searchFilterInput');
  const compactViewBtn = document.getElementById('compactViewBtn');
  const historyScrollRegion = document.getElementById('historyScrollRegion');
  const historyLoadState = document.getElementById('historyLoadState');

  const visibleCount = document.getElementById('visibleCount');
  const totalCount = document.getElementById('totalCount');
  const newestLabel = document.getElementById('newestLabel');
  const oldestLabel = document.getElementById('oldestLabel');

  const watchTypeButtons = [...document.querySelectorAll('.type-filter-btn')];
  const dateRangeButtons = [...document.querySelectorAll('#dateRangeFilters .filter-btn')];

  function loadList(key) {
    const list = storage.getJSON(key, []);
    return Array.isArray(list) ? list : [];
  }

  function saveList(key, list) {
    storage.setJSON(key, list);
  }


  function migrateLegacyWatchHistory() {
    const current = loadList(WATCH_HISTORY_KEY);
    if (current.length) return;
    const legacy = loadList(LEGACY_WATCH_HISTORY_KEY);
    if (!legacy.length) return;
    saveList(WATCH_HISTORY_KEY, legacy);
  }

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(HISTORY_PREFS_KEY);
      const prefs = raw ? JSON.parse(raw) : {};
      state.compactView = Boolean(prefs.compactView);
    } catch {
      state.compactView = false;
    }
  }

  function savePrefs() {
    localStorage.setItem(HISTORY_PREFS_KEY, JSON.stringify({ compactView: state.compactView }));
  }

  function getTimestamp(item) {
    return Number(item.updatedAt) || 0;
  }

  function formatDateTime(ts) {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return 'Unknown date';
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function getActiveKey() {
    return state.activeType === 'search' ? SEARCH_HISTORY_KEY : WATCH_HISTORY_KEY;
  }

  function getItemId(item) {
    const basis = state.activeType === 'search' ? item.query : `${item.title}-${item.type}-${item.season}-${item.episode}`;
    return item.key || `${state.activeType}-${basis}-${getTimestamp(item)}`;
  }

  function resolveMovieDetailsLink(item) {
    const detailsBase = withBase('/movies/movie.html');
    const fallbackId = item?.id || item?.tmdbId;
    const rawLink = String(item?.link || '');

    if (!rawLink) {
      return fallbackId ? `${detailsBase}?id=${encodeURIComponent(fallbackId)}` : '';
    }

    try {
      const resolved = new URL(rawLink, window.location.origin);
      const movieId = resolved.searchParams.get('id') || fallbackId;
      const pointsToOldMovieRoute = /\/movies\/(?:viewer\.html|watch\/viewer\.html)$/i.test(resolved.pathname)
        || /\/movies\/?$/i.test(resolved.pathname);
      if (pointsToOldMovieRoute && movieId) {
        return `${detailsBase}?id=${encodeURIComponent(movieId)}`;
      }
    } catch {
      return fallbackId ? `${detailsBase}?id=${encodeURIComponent(fallbackId)}` : '';
    }

    return rawLink;
  }

  function getRangeCutoff() {
    const now = Date.now();
    if (state.dateRange === 'today') return now - 24 * 60 * 60 * 1000;
    if (state.dateRange === 'week') return now - 7 * 24 * 60 * 60 * 1000;
    if (state.dateRange === 'month') return now - 30 * 24 * 60 * 60 * 1000;
    return 0;
  }

  function matchesText(item) {
    const q = state.textFilter.trim().toLowerCase();
    if (!q) return true;

    if (state.activeType === 'search') {
      return String(item.query || '').toLowerCase().includes(q);
    }

    const fields = [item.title, item.type, item.season, item.episode].map(v => String(v || '').toLowerCase());
    return fields.some(field => field.includes(q));
  }

  function getFilteredItems() {
    const list = loadList(getActiveKey());
    const cutoff = getRangeCutoff();

    let items = list.filter(item => getTimestamp(item) >= cutoff && matchesText(item));

    if (state.activeType === 'watch' && state.watchFilter !== 'all') {
      items = items.filter(item => item.type === state.watchFilter);
    }

    const sorted = [...items].sort((a, b) => getTimestamp(b) - getTimestamp(a));
    if (state.sortOrder === 'old') sorted.reverse();

    return sorted;
  }

  function getVisibleItems(items) {
    return items.slice(0, state.visibleLimit);
  }

  function queueMoreItems() {
    const items = getFilteredItems();
    if (state.visibleLimit >= items.length) return;
    state.loadingMore = true;
    historyLoadState.textContent = 'Loading more...';
    window.requestAnimationFrame(() => {
      state.visibleLimit = Math.min(state.visibleLimit + state.pageSize, items.length);
      state.loadingMore = false;
      render();
    });
  }

  function updateLoadState(visibleItems, allItems) {
    if (!allItems.length) {
      historyLoadState.textContent = '';
      return;
    }

    if (visibleItems.length >= allItems.length) {
      historyLoadState.textContent = `Showing all ${allItems.length} entries.`;
      return;
    }

    historyLoadState.textContent = `Showing ${visibleItems.length} of ${allItems.length}. Scroll to load more.`;
  }

  function renderEmptyState() {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = state.textFilter
      ? 'No history matched your filters. Try broadening your search.'
      : `No ${state.activeType === 'search' ? 'search' : 'watch'} history yet.`;
    historyList.appendChild(empty);
  }

  function removeSingle(itemId) {
    const key = getActiveKey();
    const list = loadList(key);
    const next = list.filter(item => getItemId(item) !== itemId);
    saveList(key, next);
    state.selectedKeys.delete(itemId);
    render();
  }

  function updateStats(visibleItems) {
    const allItems = loadList(getActiveKey());
    visibleCount.textContent = String(visibleItems.length);
    totalCount.textContent = String(allItems.length);

    if (!allItems.length) {
      newestLabel.textContent = '—';
      oldestLabel.textContent = '—';
      return;
    }

    const sorted = [...allItems].sort((a, b) => getTimestamp(a) - getTimestamp(b));
    oldestLabel.textContent = formatDateTime(getTimestamp(sorted[0]));
    newestLabel.textContent = formatDateTime(getTimestamp(sorted[sorted.length - 1]));
  }

  function renderHistoryItem(item) {
    const itemId = getItemId(item);
    const row = document.createElement('li');
    row.className = 'history-item';

    if (state.selectMode) row.classList.add('is-selectable');
    if (state.selectMode && state.selectedKeys.has(itemId)) row.classList.add('is-selected');

    const left = document.createElement('div');
    left.className = 'history-left';

    const title = document.createElement('p');
    title.className = 'history-title';

    const meta = document.createElement('p');
    meta.className = 'history-meta';
    meta.textContent = formatDateTime(getTimestamp(item));

    const chip = document.createElement('span');
    chip.className = 'history-chip';

    if (state.activeType === 'search') {
      title.textContent = item.query || 'Unknown search';
      chip.textContent = 'Search';
    } else {
      const descriptor = item.type === 'tv'
        ? `TV${item.season ? ` · S${item.season}` : ''}${item.episode ? `E${item.episode}` : ''}`
        : 'Movie';
      title.textContent = item.title || 'Unknown title';
      chip.textContent = descriptor;
    }

    left.appendChild(title);
    left.appendChild(meta);
    left.appendChild(chip);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = '✕';
    deleteBtn.setAttribute('aria-label', 'Delete history item');
    deleteBtn.addEventListener('click', event => {
      event.stopPropagation();
      if (!window.confirm('Delete this history entry?')) return;
      removeSingle(itemId);
    });

    row.appendChild(left);

    if (state.selectMode) {
      row.addEventListener('click', () => {
        if (state.selectedKeys.has(itemId)) state.selectedKeys.delete(itemId);
        else state.selectedKeys.add(itemId);
        render();
      });
    } else {
      row.appendChild(deleteBtn);

      if (state.activeType === 'search') {
        row.addEventListener('click', () => {
          const query = encodeURIComponent(item.query || '');
          window.location.href = `${withBase('/search/')}?q=${query}`;
        });
      } else {
        row.addEventListener('click', () => {
          const destination = item.type === 'movie'
            ? resolveMovieDetailsLink(item)
            : item.link
              || (item.type === 'tv' && item.id ? `${withBase('/tv/viewer.html')}?id=${encodeURIComponent(item.id)}` : '');
          const destination = item.link
            || (item.type === 'tv' && item.id ? `${withBase('/tv/viewer.html')}?id=${encodeURIComponent(item.id)}` : '')
            || (item.type === 'movie' && item.id ? `${withBase('/movies/movie.html')}?id=${encodeURIComponent(item.id)}` : '');
          if (!destination) return;
          window.location.href = destination;
        });
      }
    }

    historyList.appendChild(row);
  }

  function syncSelectActions(items) {
    const selectedSize = state.selectedKeys.size;
    deleteSelectedBtn.disabled = selectedSize === 0;
    selectAllBtn.textContent = selectedSize === items.length && items.length
      ? 'Unselect all visible'
      : 'Select all visible';
  }

  function render() {
    document.body.classList.toggle('compact', state.compactView);
    compactViewBtn.setAttribute('aria-pressed', state.compactView ? 'true' : 'false');
    compactViewBtn.classList.toggle('is-active', state.compactView);
    compactViewBtn.textContent = state.compactView ? 'Comfortable view' : 'Compact view';

    searchTabBtn.classList.toggle('is-active', state.activeType === 'search');
    watchTabBtn.classList.toggle('is-active', state.activeType === 'watch');
    searchTabBtn.setAttribute('aria-selected', state.activeType === 'search' ? 'true' : 'false');
    watchTabBtn.setAttribute('aria-selected', state.activeType === 'watch' ? 'true' : 'false');

    sortRecentBtn.classList.toggle('is-active', state.sortOrder === 'recent');
    sortOldBtn.classList.toggle('is-active', state.sortOrder === 'old');

    clearHistoryBtn.textContent = state.activeType === 'search' ? 'Clear all search history' : 'Clear all watch history';
    watchFilters.hidden = state.activeType !== 'watch';

    if (state.activeType === 'search') {
      state.watchFilter = 'all';
    }

    selectModeBtn.hidden = state.selectMode;
    selectAllBtn.hidden = !state.selectMode;
    cancelSelectBtn.hidden = !state.selectMode;
    deleteSelectedBtn.hidden = !state.selectMode;
    clearHistoryBtn.hidden = state.selectMode;

    watchTypeButtons.forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.filter === state.watchFilter);
    });

    dateRangeButtons.forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.range === state.dateRange);
    });

    historyList.innerHTML = '';
    const items = getFilteredItems();
    const visibleItems = getVisibleItems(items);
    updateStats(visibleItems);

    if (!items.length) {
      renderEmptyState();
      syncSelectActions(items);
      updateLoadState([], items);
      return;
    }

    visibleItems.forEach(renderHistoryItem);
    syncSelectActions(visibleItems);
    updateLoadState(visibleItems, items);
  }

  function resetSelection() {
    state.selectMode = false;
    state.selectedKeys.clear();
  }

  function resetVisibleWindow() {
    state.visibleLimit = state.pageSize;
  }

  searchTabBtn.addEventListener('click', () => {
    state.activeType = 'search';
    resetSelection();
    resetVisibleWindow();
    render();
  });

  watchTabBtn.addEventListener('click', () => {
    state.activeType = 'watch';
    resetSelection();
    resetVisibleWindow();
    render();
  });

  sortRecentBtn.addEventListener('click', () => {
    state.sortOrder = 'recent';
    resetVisibleWindow();
    render();
  });

  sortOldBtn.addEventListener('click', () => {
    state.sortOrder = 'old';
    resetVisibleWindow();
    render();
  });

  selectModeBtn.addEventListener('click', () => {
    state.selectMode = true;
    state.selectedKeys.clear();
    render();
  });

  selectAllBtn.addEventListener('click', () => {
    const items = getVisibleItems(getFilteredItems());
    const itemIds = items.map(getItemId);
    const allSelected = itemIds.length && itemIds.every(id => state.selectedKeys.has(id));

    if (allSelected) {
      itemIds.forEach(id => state.selectedKeys.delete(id));
    } else {
      itemIds.forEach(id => state.selectedKeys.add(id));
    }

    render();
  });

  cancelSelectBtn.addEventListener('click', () => {
    resetSelection();
    resetVisibleWindow();
    render();
  });

  deleteSelectedBtn.addEventListener('click', () => {
    if (!state.selectedKeys.size) return;
    const count = state.selectedKeys.size;
    if (!window.confirm(`Delete ${count} selected entr${count === 1 ? 'y' : 'ies'}?`)) return;

    const key = getActiveKey();
    const list = loadList(key);
    const next = list.filter(item => !state.selectedKeys.has(getItemId(item)));
    saveList(key, next);

    resetSelection();
    resetVisibleWindow();
    render();
  });


  clearHistoryBtn.addEventListener('click', () => {
    const isSearch = state.activeType === 'search';
    if (!window.confirm(`Clear all ${isSearch ? 'search' : 'watch'} history?`)) return;
    saveList(getActiveKey(), []);
    resetSelection();
    resetVisibleWindow();
    render();
  });

  watchTypeButtons.forEach(button => {
    button.addEventListener('click', () => {
      state.watchFilter = button.dataset.filter;
      resetVisibleWindow();
      render();
    });
  });

  dateRangeButtons.forEach(button => {
    button.addEventListener('click', () => {
      state.dateRange = button.dataset.range;
      resetSelection();
      resetVisibleWindow();
      render();
    });
  });

  searchFilterInput.addEventListener('input', () => {
    state.textFilter = searchFilterInput.value;
    resetSelection();
    resetVisibleWindow();
    render();
  });

  compactViewBtn.addEventListener('click', () => {
    state.compactView = !state.compactView;
    savePrefs();
    render();
  });


  historyScrollRegion.addEventListener('scroll', () => {
    if (state.loadingMore || state.selectMode) return;
    const threshold = 120;
    const isNearBottom = historyScrollRegion.scrollTop + historyScrollRegion.clientHeight >= historyScrollRegion.scrollHeight - threshold;
    if (isNearBottom) {
      queueMoreItems();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement !== searchFilterInput) {
      event.preventDefault();
      searchFilterInput.focus();
    }
  });

  loadPrefs();
  migrateLegacyWatchHistory();
  resetVisibleWindow();
  render();
});
