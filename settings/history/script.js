document.addEventListener('DOMContentLoaded', () => {
  const SEARCH_HISTORY_KEY = 'bilm-search-history';
  const WATCH_HISTORY_KEY = 'bilm-continue-watching';

  const state = {
    activeType: 'search',
    sortOrder: 'recent',
    watchFilter: 'all',
    selectMode: false,
    selectedKeys: new Set()
  };

  const searchTabBtn = document.getElementById('searchTabBtn');
  const watchTabBtn = document.getElementById('watchTabBtn');
  const sortRecentBtn = document.getElementById('sortRecentBtn');
  const sortOldBtn = document.getElementById('sortOldBtn');
  const selectModeBtn = document.getElementById('selectModeBtn');
  const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
  const cancelSelectBtn = document.getElementById('cancelSelectBtn');
  const clearAllBtn = document.getElementById('clearAllBtn');
  const watchFilters = document.getElementById('watchFilters');
  const historyList = document.getElementById('historyList');

  const filterButtons = [...document.querySelectorAll('.filter-btn')];

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

  function getTimestamp(item) {
    return Number(item.updatedAt) || 0;
  }

  function formatDate(ts) {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return 'Unknown date';
    return date.toLocaleDateString();
  }

  function formatTime(ts) {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return 'Unknown time';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function getActiveKey() {
    return state.activeType === 'search' ? SEARCH_HISTORY_KEY : WATCH_HISTORY_KEY;
  }

  function getItemId(item) {
    return item.key || `${state.activeType}-${item.query || item.title}-${getTimestamp(item)}`;
  }

  function getVisibleItems() {
    let items = loadList(getActiveKey());

    if (state.activeType === 'watch' && state.watchFilter !== 'all') {
      items = items.filter(item => item.type === state.watchFilter);
    }

    const sorted = [...items].sort((a, b) => getTimestamp(b) - getTimestamp(a));
    if (state.sortOrder === 'old') {
      sorted.reverse();
    }

    return sorted;
  }

  function renderEmptyState() {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = `No ${state.activeType === 'search' ? 'search' : 'watch'} history yet.`;
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

  function renderHistoryItem(item) {
    const itemId = getItemId(item);
    const row = document.createElement('li');
    row.className = 'history-item';
    if (state.selectMode) row.classList.add('is-selectable');

    const left = document.createElement('div');
    left.className = 'history-left';

    if (state.selectMode) {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'history-checkbox';
      checkbox.checked = state.selectedKeys.has(itemId);
      checkbox.setAttribute('aria-label', 'Select history item');
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          state.selectedKeys.add(itemId);
        } else {
          state.selectedKeys.delete(itemId);
        }
        syncSelectActions();
      });
      left.appendChild(checkbox);
    }

    const details = document.createElement('div');
    details.className = 'history-details';

    const title = document.createElement('p');
    title.className = 'history-title';

    if (state.activeType === 'search') {
      title.textContent = item.query || 'Unknown search';
      details.appendChild(title);
    } else {
      const descriptor = item.type === 'tv'
        ? `TV${item.season ? ` · S${item.season}` : ''}${item.episode ? `E${item.episode}` : ''}`
        : 'Movie';
      title.textContent = `${item.title || 'Unknown title'} · ${descriptor}`;
      details.appendChild(title);
    }

    const meta = document.createElement('p');
    meta.className = 'history-meta';
    meta.textContent = `${formatDate(getTimestamp(item))} · ${formatTime(getTimestamp(item))}`;
    details.appendChild(meta);

    left.appendChild(details);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = 'X';
    deleteBtn.setAttribute('aria-label', 'Delete history item');
    deleteBtn.addEventListener('click', () => {
      const ok = window.confirm('Delete this history entry?');
      if (!ok) return;
      removeSingle(itemId);
    });

    row.appendChild(left);
    row.appendChild(deleteBtn);

    if (state.activeType === 'search') {
      row.addEventListener('click', (event) => {
        if (event.target === deleteBtn || event.target.classList.contains('history-checkbox')) return;
        const query = encodeURIComponent(item.query || '');
        window.location.href = `/bilm/home/search.html?q=${query}`;
      });
    }

    historyList.appendChild(row);
  }

  function syncSelectActions() {
    deleteSelectedBtn.disabled = state.selectedKeys.size === 0;
  }

  function getClearLabel() {
    return state.activeType === 'search' ? 'Clear all search history' : 'Clear all watch history';
  }

  function getClearConfirmMessage() {
    return state.activeType === 'search' ? 'Clear all search history?' : 'Clear all watch history?';
  }

  function render() {
    searchTabBtn.classList.toggle('is-active', state.activeType === 'search');
    watchTabBtn.classList.toggle('is-active', state.activeType === 'watch');
    searchTabBtn.setAttribute('aria-selected', state.activeType === 'search' ? 'true' : 'false');
    watchTabBtn.setAttribute('aria-selected', state.activeType === 'watch' ? 'true' : 'false');

    sortRecentBtn.classList.toggle('is-active', state.sortOrder === 'recent');
    sortOldBtn.classList.toggle('is-active', state.sortOrder === 'old');

    clearAllBtn.textContent = getClearLabel();
    watchFilters.hidden = state.activeType !== 'watch';

    selectModeBtn.hidden = state.selectMode;
    deleteSelectedBtn.hidden = !state.selectMode;
    cancelSelectBtn.hidden = !state.selectMode;
    syncSelectActions();

    filterButtons.forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.filter === state.watchFilter);
    });

    historyList.innerHTML = '';
    const items = getVisibleItems();
    if (!items.length) {
      renderEmptyState();
      return;
    }

    items.forEach(renderHistoryItem);
  }

  searchTabBtn.addEventListener('click', () => {
    state.activeType = 'search';
    state.selectMode = false;
    state.selectedKeys.clear();
    render();
  });

  watchTabBtn.addEventListener('click', () => {
    state.activeType = 'watch';
    state.selectMode = false;
    state.selectedKeys.clear();
    render();
  });

  sortRecentBtn.addEventListener('click', () => {
    state.sortOrder = 'recent';
    render();
  });

  sortOldBtn.addEventListener('click', () => {
    state.sortOrder = 'old';
    render();
  });

  selectModeBtn.addEventListener('click', () => {
    state.selectMode = true;
    state.selectedKeys.clear();
    render();
  });

  cancelSelectBtn.addEventListener('click', () => {
    state.selectMode = false;
    state.selectedKeys.clear();
    render();
  });

  deleteSelectedBtn.addEventListener('click', () => {
    if (!state.selectedKeys.size) return;
    const ok = window.confirm(`Delete ${state.selectedKeys.size} selected entr${state.selectedKeys.size === 1 ? 'y' : 'ies'}?`);
    if (!ok) return;

    const key = getActiveKey();
    const list = loadList(key);
    const next = list.filter(item => !state.selectedKeys.has(getItemId(item)));
    saveList(key, next);

    state.selectMode = false;
    state.selectedKeys.clear();
    render();
  });

  clearAllBtn.addEventListener('click', () => {
    const ok = window.confirm(getClearConfirmMessage());
    if (!ok) return;

    saveList(getActiveKey(), []);
    state.selectMode = false;
    state.selectedKeys.clear();
    render();
  });

  filterButtons.forEach(button => {
    button.addEventListener('click', () => {
      state.watchFilter = button.dataset.filter;
      render();
    });
  });

  render();
});
