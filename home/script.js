document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');
  const homeSearchForm = document.getElementById('homeSearchForm');

  const continueWatchingSection = document.getElementById('continueWatchingSection');
  const watchLaterSection = document.getElementById('watchLaterSection');
  const favoritesSection = document.getElementById('favoritesSection');
  const continueItemsRow = document.getElementById('continueItems');
  const watchLaterItemsRow = document.getElementById('watchLaterItems');
  const favoriteItemsRow = document.getElementById('favoriteItems');
  const continueFilterButtons = [...document.querySelectorAll('#continueFilters .type-filter-btn')];
  const watchLaterFilterButtons = [...document.querySelectorAll('#watchLaterFilters .type-filter-btn')];
  const favoritesFilterButtons = [...document.querySelectorAll('#favoritesFilters .type-filter-btn')];
  const continueEditBtn = document.getElementById('continueEditBtn');
  const continueRemoveBtn = document.getElementById('continueRemoveBtn');
  const watchLaterEditBtn = document.getElementById('watchLaterEditBtn');
  const watchLaterRemoveBtn = document.getElementById('watchLaterRemoveBtn');
  const favoritesEditBtn = document.getElementById('favoritesEditBtn');
  const favoritesRemoveBtn = document.getElementById('favoritesRemoveBtn');

  const CONTINUE_KEY = 'bilm-continue-watching';
  const WATCH_LATER_KEY = 'bilm-watch-later';
  const FAVORITES_KEY = 'bilm-favorites';
  const SEARCH_HISTORY_KEY = 'bilm-search-history';

  document.querySelector('main').classList.add('visible');

  function runSearch() {
    const query = searchInput.value.trim();
    if (!query) {
      alert('Please enter a search term');
      return;
    }

    const settings = window.bilmTheme?.getSettings?.() || {};
    if (settings.searchHistory !== false) {
      const history = loadList(SEARCH_HISTORY_KEY);
      const next = [
        { query, updatedAt: Date.now() },
        ...history
      ].slice(0, 10);
      saveList(SEARCH_HISTORY_KEY, next);
    }

    window.location.href = `/bilm/search/?q=${encodeURIComponent(query)}`;
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
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveList(key, items) {
    localStorage.setItem(key, JSON.stringify(items));
  }

  function toYear(dateString) {
    if (!dateString) return 'N/A';
    const parsed = new Date(dateString);
    if (Number.isNaN(parsed.getTime())) return 'N/A';
    return parsed.getFullYear();
  }

  const sectionState = {
    continue: {
      editing: false,
      selected: new Set(),
      filter: 'all'
    },
    watchLater: {
      editing: false,
      selected: new Set(),
      filter: 'all'
    },
    favorites: {
      editing: false,
      selected: new Set(),
      filter: 'all'
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
    if (section === 'continue') {
      continueEditBtn.textContent = isEditing ? 'Done' : 'Edit';
      continueWatchingSection.classList.toggle('is-editing', isEditing);
      continueRemoveBtn.hidden = !isEditing;
      continueRemoveBtn.disabled = state.selected.size === 0;
    } else if (section === 'watchLater') {
      watchLaterEditBtn.textContent = isEditing ? 'Done' : 'Edit';
      watchLaterSection.classList.toggle('is-editing', isEditing);
      watchLaterRemoveBtn.hidden = !isEditing;
      watchLaterRemoveBtn.disabled = state.selected.size === 0;
    } else {
      favoritesEditBtn.textContent = isEditing ? 'Done' : 'Edit';
      favoritesSection.classList.toggle('is-editing', isEditing);
      favoritesRemoveBtn.hidden = !isEditing;
      favoritesRemoveBtn.disabled = state.selected.size === 0;
    }
  }

  function updateFilterButtons(section) {
    const buttons = section === 'continue'
      ? continueFilterButtons
      : section === 'watchLater'
        ? watchLaterFilterButtons
        : favoritesFilterButtons;
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
      const card = document.createElement('div');
      card.className = 'movie-card';
      const state = sectionState[section];
      if (state.editing) {
        card.classList.add('is-editing');
      }
      if (state.selected.has(item.key)) {
        card.classList.add('is-selected');
      }

      const img = document.createElement('img');
      img.src = item.poster || 'https://via.placeholder.com/140x210?text=No+Image';
      img.alt = item.title;
      img.onerror = () => {
        img.src = 'https://via.placeholder.com/140x210?text=No+Image';
      };

      const title = document.createElement('p');
      const yearLabel = item.year || toYear(item.date);
      title.textContent = `${item.title} (${yearLabel || 'N/A'})`;

      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = 'card-action';
      actionBtn.textContent = '✕';
      actionBtn.setAttribute('aria-label', section === 'favorites'
        ? 'Remove from favorites'
        : section === 'watchLater'
          ? 'Remove from watch later'
          : 'Remove from continue watching');
      actionBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const confirmRemove = confirm(section === 'favorites'
          ? 'Remove this item from favorites?'
          : section === 'watchLater'
            ? 'Remove this item from watch later?'
            : 'Remove this item from continue watching?');
        if (!confirmRemove) return;
        const key = section === 'favorites' ? FAVORITES_KEY : section === 'watchLater' ? WATCH_LATER_KEY : CONTINUE_KEY;
        const list = loadList(key).filter(entry => entry.key !== item.key);
        saveList(key, list);
        state.selected.delete(item.key);
        updateEditUI(section);
        renderSections();
      });

      card.appendChild(img);
      card.appendChild(actionBtn);
      card.appendChild(title);

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
        if (item.link) {
          window.location.href = item.link;
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
    const watchLaterItems = sortByRecent(loadList(WATCH_LATER_KEY));
    const favoriteItems = sortByRecent(loadList(FAVORITES_KEY));

    const continueFilteredItems = applyTypeFilter(continueItems, sectionState.continue.filter);
    const watchLaterFilteredItems = applyTypeFilter(watchLaterItems, sectionState.watchLater.filter);
    const favoritesFilteredItems = applyTypeFilter(favoriteItems, sectionState.favorites.filter);

    const continueEmpty = sectionState.continue.filter === 'movie'
      ? 'Start a movie to see it here.'
      : sectionState.continue.filter === 'tv'
        ? 'Start a show to keep your place.'
        : 'Start watching something to build your list.';

    const watchLaterEmpty = sectionState.watchLater.filter === 'movie'
      ? 'Save movies for later viewing.'
      : sectionState.watchLater.filter === 'tv'
        ? 'Save TV shows to watch later.'
        : 'Build a watch-later list for your next session.';

    const favoritesEmpty = sectionState.favorites.filter === 'movie'
      ? 'Save movies you love for quick access.'
      : sectionState.favorites.filter === 'tv'
        ? 'Favorite TV shows appear here.'
        : 'Favorite anything you want quick access to.';

    renderRow(continueItemsRow, continueFilteredItems, continueEmpty, 'continue');
    renderRow(watchLaterItemsRow, watchLaterFilteredItems, watchLaterEmpty, 'watchLater');
    renderRow(favoriteItemsRow, favoritesFilteredItems, favoritesEmpty, 'favorites');
  }

  continueEditBtn.addEventListener('click', () => {
    setEditing('continue', !sectionState.continue.editing);
  });

  watchLaterEditBtn.addEventListener('click', () => {
    setEditing('watchLater', !sectionState.watchLater.editing);
  });

  favoritesEditBtn.addEventListener('click', () => {
    setEditing('favorites', !sectionState.favorites.editing);
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

  watchLaterRemoveBtn.addEventListener('click', () => {
    const state = sectionState.watchLater;
    if (!state.selected.size) return;
    const confirmRemove = confirm('Remove selected items from Watch Later?');
    if (!confirmRemove) return;
    const list = loadList(WATCH_LATER_KEY).filter(item => !state.selected.has(item.key));
    saveList(WATCH_LATER_KEY, list);
    state.selected.clear();
    updateEditUI('watchLater');
    renderSections();
  });

  favoritesRemoveBtn.addEventListener('click', () => {
    const state = sectionState.favorites;
    if (!state.selected.size) return;
    const confirmRemove = confirm('Remove selected items from Favorites?');
    if (!confirmRemove) return;
    const list = loadList(FAVORITES_KEY).filter(item => !state.selected.has(item.key));
    saveList(FAVORITES_KEY, list);
    state.selected.clear();
    updateEditUI('favorites');
    renderSections();
  });

  continueFilterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      sectionState.continue.filter = button.dataset.filter;
      updateFilterButtons('continue');
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

  favoritesFilterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      sectionState.favorites.filter = button.dataset.filter;
      updateFilterButtons('favorites');
      renderSections();
    });
  });

  renderSections();
  updateEditUI('continue');
  updateEditUI('watchLater');
  updateEditUI('favorites');
  updateFilterButtons('continue');
  updateFilterButtons('watchLater');
  updateFilterButtons('favorites');

  window.addEventListener('storage', renderSections);
});
