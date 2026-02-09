const TMDB_API_KEY = '3ade810499876bb5672f40e54960e6a2';
const BASE_URL = 'https://inspecting.github.io/bilm';
const DEFAULT_MOVIES_PER_LOAD = 15;
const PRIORITY_SECTION_COUNT = 3;

let allGenres = [];
let moviesPerLoad = DEFAULT_MOVIES_PER_LOAD;
const loadedCounts = {};
const loadedMovieIds = {};

const sortOptions = {
  trending: { title: 'Trending', endpoint: '/trending/movie/week' },
  popular: { title: 'Popular', endpoint: '/movie/popular' },
  top_rated: { title: 'Top Rated', endpoint: '/movie/top_rated' },
  now_playing: { title: 'Now Playing', endpoint: '/movie/now_playing' }
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
  const url = `https://api.themoviedb.org/3/genre/movie/list?api_key=${TMDB_API_KEY}&language=en-US`;
  const data = await fetchJSON(url);
  allGenres = data?.genres || [];
  return allGenres;
}

function buildGenreChips() {
  const container = document.getElementById('movieGenres');
  if (!container) return;
  container.innerHTML = '';

  const allChip = document.createElement('button');
  allChip.type = 'button';
  allChip.className = `chip ${state.genre === 'all' ? 'is-active' : ''}`;
  allChip.dataset.genre = 'all';
  allChip.textContent = 'All genres';
  container.appendChild(allChip);

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
        title: `${genre.name} Picks`,
        endpoint: `/discover/movie?with_genres=${genre.id}`,
        key: `genre-${genre.id}`
      });
    }
    return sections;
  }

  const genreSections = allGenres.map(genre => ({
    title: genre.name,
    endpoint: `/discover/movie?with_genres=${genre.id}`,
    key: `genre-${genre.id}`
  }));

  return [...sections, ...genreSections];
}

async function fetchMovies(endpoint, page = 1) {
  const url = endpoint.includes('?')
    ? `https://api.themoviedb.org/3${endpoint}&api_key=${TMDB_API_KEY}&page=${page}`
    : `https://api.themoviedb.org/3${endpoint}?api_key=${TMDB_API_KEY}&page=${page}`;
  const data = await fetchJSON(url);
  return data?.results || [];
}

function createMovieCard(movie) {
  const card = document.createElement('div');
  card.className = 'movie-card';
  card.dataset.tmdbId = movie.tmdbId;

  const img = document.createElement('img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.src = movie.img || 'https://via.placeholder.com/140x210?text=No+Image';
  img.alt = movie.title;
  img.onerror = () => {
    img.onerror = null;
    img.src = 'https://via.placeholder.com/140x210?text=No+Image';
  };

  const p = document.createElement('p');
  p.textContent = `${movie.title} (${movie.year || 'N/A'})`;

  card.appendChild(img);
  card.appendChild(p);

  card.onclick = () => {
    window.location.href = movie.link || '#';
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

async function loadMoviesForSection(section) {
  loadedCounts[section.key] ??= 0;
  loadedMovieIds[section.key] ??= new Set();

  const page = Math.floor(loadedCounts[section.key] / moviesPerLoad) + 1;
  const movies = await fetchMovies(section.endpoint, page);
  if (!movies.length) return false;

  const rowEl = document.getElementById(`row-${section.key}`);
  if (!rowEl) return false;

  const uniqueMovies = movies.filter(m => !loadedMovieIds[section.key].has(m.id));

  uniqueMovies.slice(0, moviesPerLoad).forEach(movie => {
    loadedMovieIds[section.key].add(movie.id);

    const posterBase = movie.poster_path
      ? `https://image.tmdb.org/t/p/${moviesPerLoad < DEFAULT_MOVIES_PER_LOAD ? 'w342' : 'w500'}${movie.poster_path}`
      : 'https://via.placeholder.com/140x210?text=No+Image';

    const movieData = {
      tmdbId: movie.id,
      title: movie.title,
      year: movie.release_date?.slice(0, 4) || 'N/A',
      img: posterBase,
      link: `${BASE_URL}/movies/viewer.html?id=${movie.id}`
    };

    const card = createMovieCard(movieData);
    rowEl.appendChild(card);
  });

  loadedCounts[section.key] += moviesPerLoad;
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
      await loadMoviesForSection(section);
      loading = false;
    }
  }, { passive: true });
}

function resetSections() {
  const container = document.getElementById('movieSections');
  if (!container) return;
  container.innerHTML = '';
  Object.keys(loadedCounts).forEach(key => delete loadedCounts[key]);
  Object.keys(loadedMovieIds).forEach(key => delete loadedMovieIds[key]);
}

function updateQuickFilterButtons() {
  document.querySelectorAll('#movieQuickFilters .chip').forEach(button => {
    button.classList.toggle('is-active', button.dataset.sort === state.sort);
  });
}

function updateGenreButtons() {
  document.querySelectorAll('#movieGenres .chip').forEach(button => {
    button.classList.toggle('is-active', button.dataset.genre === state.genre);
  });
}

async function renderSections() {
  const container = document.getElementById('movieSections');
  if (!container) return;
  resetSections();

  const sections = getSections();
  sections.forEach(section => createSectionSkeleton(section, container));

  const prioritySections = sections.slice(0, PRIORITY_SECTION_COUNT);
  const deferredSections = sections.slice(PRIORITY_SECTION_COUNT);
  await Promise.all(prioritySections.map(section => loadMoviesForSection(section)));

  const loadDeferredSections = async () => {
    await Promise.all(deferredSections.map(section => loadMoviesForSection(section)));
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
    moviesPerLoad = 10;
  }

  await fetchGenres();
  buildGenreChips();

  const sortSelect = document.getElementById('movieSort');
  if (sortSelect) {
    sortSelect.value = state.sort;
    sortSelect.addEventListener('change', (event) => {
      state.sort = event.target.value;
      updateQuickFilterButtons();
      renderSections();
    });
  }

  document.getElementById('movieQuickFilters')?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-sort]');
    if (!button) return;
    state.sort = button.dataset.sort;
    if (sortSelect) sortSelect.value = state.sort;
    updateQuickFilterButtons();
    renderSections();
  });

  document.getElementById('movieGenres')?.addEventListener('click', (event) => {
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
