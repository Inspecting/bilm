const TMDB_API_KEY = '3ade810499876bb5672f40e54960e6a2';
const BASE_URL = 'https://inspecting.github.io/bilm';
const DEFAULT_SHOWS_PER_LOAD = 15;
const PRIORITY_SECTION_COUNT = 3;

let allGenres = [];
let showsPerLoad = DEFAULT_SHOWS_PER_LOAD;
const loadedCounts = {};
const loadedShowIds = {};

const sortOptions = {
  trending: { title: 'Trending', endpoint: '/trending/tv/week' },
  popular: { title: 'Popular', endpoint: '/tv/popular' },
  top_rated: { title: 'Top Rated', endpoint: '/tv/top_rated' },
  airing_today: { title: 'Airing Today', endpoint: '/tv/airing_today' }
};

const state = {
  sort: 'trending',
  genre: 'all'
};

async function fetchJSON(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchGenres() {
  const url = `https://api.themoviedb.org/3/genre/tv/list?api_key=${TMDB_API_KEY}&language=en-US`;
  const data = await fetchJSON(url);
  allGenres = data?.genres || [];
  return allGenres;
}

function buildGenreChips() {
  const container = document.getElementById('tvGenres');
  if (!container) return;
  container.innerHTML = '';

  const allChip = document.createElement('button');
  allChip.type = 'button';
  allChip.className = `chip ${state.genre === 'all' ? 'is-active' : ''}`;
  allChip.dataset.genre = 'all';
  allChip.textContent = 'All genres';
  container.appendChild(allChip);

  const quickSorts = [
    { key: 'trending', label: 'Trending' },
    { key: 'popular', label: 'Popular' },
    { key: 'top_rated', label: 'Top Rated' },
    { key: 'airing_today', label: 'Airing Today' }
  ];
  allGenres.forEach(genre => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `chip ${state.genre === String(genre.id) ? 'is-active' : ''}`;
    chip.dataset.genre = String(genre.id);
    chip.textContent = genre.name;
    container.appendChild(chip);
  });
}

function getSections() {
  const sections = [];
  const activeSort = sortOptions[state.sort] || sortOptions.trending;
  sections.push({
    title: activeSort.title,
    endpoint: activeSort.endpoint,
    key: `sort-${state.sort}`
  });

  if (state.genre !== 'all') {
    const genre = allGenres.find(item => String(item.id) === state.genre);
    if (genre) {
      sections.push({
        title: `${genre.name} Spotlight`,
        endpoint: `/discover/tv?with_genres=${genre.id}`,
        key: `genre-${genre.id}`
      });
    }
    return sections;
  }

  quickSorts.forEach(sort => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `chip ${state.sort === sort.key ? 'is-active' : ''}`;
    chip.dataset.sort = sort.key;
    chip.textContent = sort.label;
    container.appendChild(chip);
  });

  allGenres.forEach(genre => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `chip ${state.genre === String(genre.id) ? 'is-active' : ''}`;
    chip.dataset.genre = String(genre.id);
    chip.textContent = genre.name;
    container.appendChild(chip);
  });
}

function getSections() {
  const sections = [];
  const activeSort = sortOptions[state.sort] || sortOptions.trending;
  sections.push({
    title: activeSort.title,
    endpoint: activeSort.endpoint,
    key: `sort-${state.sort}`
  });

  if (state.genre !== 'all') {
    const genre = allGenres.find(item => String(item.id) === state.genre);
    if (genre) {
      sections.push({
        title: `${genre.name} Spotlight`,
        endpoint: `/discover/tv?with_genres=${genre.id}`,
        key: `genre-${genre.id}`
      });
    }
    return sections;
  }

  const genreSections = allGenres.map(genre => ({
    title: genre.name,
    endpoint: `/discover/tv?with_genres=${genre.id}`,
    key: `genre-${genre.id}`
  }));

  return [...sections, ...genreSections];
}

async function fetchShows(endpoint, page = 1) {
  const url = endpoint.includes('?')
    ? `https://api.themoviedb.org/3${endpoint}&api_key=${TMDB_API_KEY}&page=${page}`
    : `https://api.themoviedb.org/3${endpoint}?api_key=${TMDB_API_KEY}&page=${page}`;
  const data = await fetchJSON(url);
  return data?.results || [];
}

function createShowCard(show) {
  const card = document.createElement('div');
  card.className = 'movie-card';
  card.dataset.tmdbId = show.tmdbId;

  const img = document.createElement('img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.src = show.img || 'https://via.placeholder.com/140x210?text=No+Image';
  img.alt = show.title;
  img.onerror = () => {
    img.onerror = null;
    img.src = 'https://via.placeholder.com/140x210?text=No+Image';
  };

  const p = document.createElement('p');
  p.textContent = `${show.title} (${show.year || 'N/A'})`;

  card.appendChild(img);
  card.appendChild(p);

  card.onclick = () => {
    window.location.href = show.link || '#';
  };

  return card;
}

function createSectionSkeleton(section, container) {
  const sectionEl = document.createElement('div');
  sectionEl.className = 'section';
  sectionEl.id = `section-${section.key}`;

  const titleEl = document.createElement('h2');
  titleEl.className = 'section-title';
  titleEl.textContent = section.title;

  const rowEl = document.createElement('div');
  rowEl.className = 'scroll-row';
  rowEl.id = `row-${section.key}`;

  sectionEl.appendChild(titleEl);
  sectionEl.appendChild(rowEl);
  container.appendChild(sectionEl);
}

async function loadShowsForSection(section) {
  loadedCounts[section.key] ??= 0;
  loadedShowIds[section.key] ??= new Set();

  const page = Math.floor(loadedCounts[section.key] / showsPerLoad) + 1;
  const shows = await fetchShows(section.endpoint, page);
  if (!shows.length) return false;

  const rowEl = document.getElementById(`row-${section.key}`);
  if (!rowEl) return false;

  const uniqueShows = shows.filter(s => !loadedShowIds[section.key].has(s.id));

  uniqueShows.slice(0, showsPerLoad).forEach(show => {
    loadedShowIds[section.key].add(show.id);

    const poster = show.poster_path
      ? `https://image.tmdb.org/t/p/${showsPerLoad < DEFAULT_SHOWS_PER_LOAD ? 'w342' : 'w500'}${show.poster_path}`
      : 'https://via.placeholder.com/140x210?text=No+Image';

    const showData = {
      tmdbId: show.id,
      title: show.name,
      year: show.first_air_date?.slice(0, 4) || 'N/A',
      img: poster,
      link: `${BASE_URL}/tv/viewer.html?id=${show.id}`
    };

    const card = createShowCard(showData);
    rowEl.appendChild(card);
  });

  loadedCounts[section.key] += showsPerLoad;
  return true;
}

function setupInfiniteScroll(section) {
  const rowEl = document.getElementById(`row-${section.key}`);
  if (!rowEl) return;

  let loading = false;
  rowEl.addEventListener('scroll', async () => {
    if (loading) return;
    if (rowEl.scrollLeft + rowEl.clientWidth >= rowEl.scrollWidth - 300) {
      loading = true;
      await loadShowsForSection(section);
      loading = false;
    }
  }, { passive: true });
}

function resetSections() {
  const container = document.getElementById('tvSections');
  if (!container) return;
  container.innerHTML = '';
  Object.keys(loadedCounts).forEach(key => delete loadedCounts[key]);
  Object.keys(loadedShowIds).forEach(key => delete loadedShowIds[key]);
}

function updateQuickFilterButtons() {
  document.querySelectorAll('#tvGenres .chip[data-sort]').forEach(button => {
  document.querySelectorAll('#tvQuickFilters .chip').forEach(button => {
    button.classList.toggle('is-active', button.dataset.sort === state.sort);
  });
}

function updateGenreButtons() {
  document.querySelectorAll('#tvGenres .chip[data-genre]').forEach(button => {
  document.querySelectorAll('#tvGenres .chip').forEach(button => {
    button.classList.toggle('is-active', button.dataset.genre === state.genre);
  });
}

async function renderSections() {
  const container = document.getElementById('tvSections');
  if (!container) return;
  resetSections();

  const sections = getSections();
  sections.forEach(section => createSectionSkeleton(section, container));

  const prioritySections = sections.slice(0, PRIORITY_SECTION_COUNT);
  const deferredSections = sections.slice(PRIORITY_SECTION_COUNT);
  await Promise.all(prioritySections.map(section => loadShowsForSection(section)));

  const loadDeferredSections = async () => {
    await Promise.all(deferredSections.map(section => loadShowsForSection(section)));
  };

  if ('requestIdleCallback' in window) {
    requestIdleCallback(loadDeferredSections, { timeout: 1200 });
  } else {
    setTimeout(loadDeferredSections, 0);
  }

  sections.forEach(section => setupInfiniteScroll(section));
}

document.addEventListener('DOMContentLoaded', async () => {
  const settings = window.bilmTheme?.getSettings?.() || {};
  if (settings.dataSaver) {
    showsPerLoad = 10;
  }

  await fetchGenres();
  buildGenreChips();

  const sortSelect = document.getElementById('tvSort');
  if (sortSelect) {
    sortSelect.value = state.sort;
    sortSelect.addEventListener('change', (event) => {
      state.sort = event.target.value;
      updateQuickFilterButtons();
      renderSections();
    });
  }

  document.getElementById('tvGenres')?.addEventListener('click', (event) => {
    const sortButton = event.target.closest('button[data-sort]');
    if (sortButton) {
      state.sort = sortButton.dataset.sort;
      if (sortSelect) sortSelect.value = state.sort;
      updateQuickFilterButtons();
      renderSections();
      return;
    }
  document.getElementById('tvQuickFilters')?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-sort]');
    if (!button) return;
    state.sort = button.dataset.sort;
    if (sortSelect) sortSelect.value = state.sort;
    updateQuickFilterButtons();
    renderSections();
  });

  document.getElementById('tvGenres')?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-genre]');
    if (!button) return;
    state.genre = button.dataset.genre;
    updateGenreButtons();
    renderSections();
  });

  updateQuickFilterButtons();
  updateGenreButtons();
  await renderSections();
});
