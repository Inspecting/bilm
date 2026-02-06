document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');
  const homeSearchForm = document.getElementById('homeSearchForm');

  const continueWatchingSection = document.getElementById('continueWatchingSection');
  const favoritesSection = document.getElementById('favoritesSection');
  const continueMoviesRow = document.getElementById('continueMovies');
  const continueTvRow = document.getElementById('continueTv');
  const favoriteMoviesRow = document.getElementById('favoriteMovies');
  const favoriteTvRow = document.getElementById('favoriteTv');
  const continueEditBtn = document.getElementById('continueEditBtn');
  const continueRemoveBtn = document.getElementById('continueRemoveBtn');
  const favoritesEditBtn = document.getElementById('favoritesEditBtn');
  const favoritesRemoveBtn = document.getElementById('favoritesRemoveBtn');

  const CONTINUE_KEY = 'bilm-continue-watching';
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
      selected: new Set()
    },
    favorites: {
      editing: false,
      selected: new Set()
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
    } else {
      favoritesEditBtn.textContent = isEditing ? 'Done' : 'Edit';
      favoritesSection.classList.toggle('is-editing', isEditing);
      favoritesRemoveBtn.hidden = !isEditing;
      favoritesRemoveBtn.disabled = state.selected.size === 0;
    }
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
      actionBtn.setAttribute('aria-label', section === 'favorites' ? 'Remove from favorites' : 'Remove from continue watching');
      actionBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const confirmRemove = confirm(section === 'favorites'
          ? 'Remove this item from favorites?'
          : 'Remove this item from continue watching?');
        if (!confirmRemove) return;
        const key = section === 'favorites' ? FAVORITES_KEY : CONTINUE_KEY;
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

  function filterByType(items, type) {
    return items.filter(item => item.type === type);
  }

  function renderSections() {
    const continueItems = sortByRecent(loadList(CONTINUE_KEY));
    const favoriteItems = sortByRecent(loadList(FAVORITES_KEY));

    renderRow(continueMoviesRow, filterByType(continueItems, 'movie'), 'Start a movie to see it here.', 'continue');
    renderRow(continueTvRow, filterByType(continueItems, 'tv'), 'Start a show to keep your place.', 'continue');
    renderRow(favoriteMoviesRow, filterByType(favoriteItems, 'movie'), 'Save movies you love for quick access.', 'favorites');
    renderRow(favoriteTvRow, filterByType(favoriteItems, 'tv'), 'Favorite TV shows appear here.', 'favorites');
  }

  continueEditBtn.addEventListener('click', () => {
    setEditing('continue', !sectionState.continue.editing);
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

  renderSections();
  updateEditUI('continue');
  updateEditUI('favorites');

  window.addEventListener('storage', renderSections);
});
