document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');

  const continueWatchingSection = document.getElementById('continueWatchingSection');
  const favoritesSection = document.getElementById('favoritesSection');
  const continueMoviesRow = document.getElementById('continueMovies');
  const continueTvRow = document.getElementById('continueTv');
  const favoriteMoviesRow = document.getElementById('favoriteMovies');
  const favoriteTvRow = document.getElementById('favoriteTv');

  const CONTINUE_KEY = 'bilm-continue-watching';
  const FAVORITES_KEY = 'bilm-favorites';

  document.querySelector('main').classList.add('visible');

  searchBtn.onclick = () => {
    const query = searchInput.value.trim();
    if (!query) return alert('Please enter a search term');
    window.location.href = `/bilm/home/search.html?q=${encodeURIComponent(query)}`;
  };

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchBtn.click();
  });

  function loadList(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function toYear(dateString) {
    if (!dateString) return 'N/A';
    const parsed = new Date(dateString);
    if (Number.isNaN(parsed.getTime())) return 'N/A';
    return parsed.getFullYear();
  }

  function renderRow(container, items) {
    container.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Nothing here yet.';
      container.appendChild(empty);
      return;
    }

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'movie-card';

      const img = document.createElement('img');
      img.src = item.poster || 'https://via.placeholder.com/140x210?text=No+Image';
      img.alt = item.title;
      img.onerror = () => {
        img.src = 'https://via.placeholder.com/140x210?text=No+Image';
      };

      const title = document.createElement('p');
      const yearLabel = item.year || toYear(item.date);
      title.textContent = `${item.title} (${yearLabel || 'N/A'})`;

      card.appendChild(img);
      card.appendChild(title);

      card.onclick = () => {
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

    renderRow(continueMoviesRow, filterByType(continueItems, 'movie'));
    renderRow(continueTvRow, filterByType(continueItems, 'tv'));
    renderRow(favoriteMoviesRow, filterByType(favoriteItems, 'movie'));
    renderRow(favoriteTvRow, filterByType(favoriteItems, 'tv'));

    continueWatchingSection.style.display = continueItems.length ? 'block' : 'none';
    favoritesSection.style.display = favoriteItems.length ? 'block' : 'none';
  }

  renderSections();

  window.addEventListener('storage', renderSections);
});
