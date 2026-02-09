const TMDB_API_KEY = '3ade810499876bb5672f40e54960e6a2';
const BASE_URL = 'https://inspecting.github.io/bilm';
const DEFAULT_PER_LOAD = 15;
const DEFAULT_PRIORITY_COUNT = 4;

let allGenres = [];
const loadedCounts = {};
const loadedMovieIds = {};

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

function getSections() {
  const staticSections = [
    { title: 'Trending', endpoint: '/trending/movie/week' },
    { title: 'Popular', endpoint: '/movie/popular' },
    { title: 'Top Rated', endpoint: '/movie/top_rated' },
    { title: 'Now Playing', endpoint: '/movie/now_playing' }
  ];

  const genreSections = allGenres.map(genre => ({
    title: genre.name,
    endpoint: `/discover/movie?with_genres=${genre.id}`
  }));

  return [...staticSections, ...genreSections];
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
  sectionEl.id = `section-${section.title.replace(/\s/g, '')}`;

  const titleEl = document.createElement('h2');
  titleEl.className = 'section-title';
  titleEl.textContent = section.title;

  const rowEl = document.createElement('div');
  rowEl.className = 'scroll-row';
  rowEl.id = `row-${section.title.replace(/\s/g, '')}`;

  sectionEl.appendChild(titleEl);
  sectionEl.appendChild(rowEl);
  container.appendChild(sectionEl);
}

function getThemeSettings() {
  return window.bilmTheme?.getSettings?.() || {};
}

function getLoadConfig(settings) {
  const dataSaver = settings.dataSaver === true;
  const imageQuality = settings.imageQuality || 'high';
  return {
    perLoad: dataSaver ? 8 : DEFAULT_PER_LOAD,
    priorityCount: dataSaver ? 2 : DEFAULT_PRIORITY_COUNT,
    imageSize: imageQuality === 'low' ? 'w342' : 'w500'
  };
}

function createNavButton(section, container) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = section.title;
  button.addEventListener('click', () => {
    const target = document.getElementById(`section-${section.title.replace(/\s/g, '')}`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  container.appendChild(button);
}

async function loadMoviesForSection(section, config) {
  loadedCounts[section.title] ??= 0;
  loadedMovieIds[section.title] ??= new Set();

  const page = Math.floor(loadedCounts[section.title] / config.perLoad) + 1;
  const movies = await fetchMovies(section.endpoint, page);
  if (!movies.length) return false;

  const rowEl = document.getElementById(`row-${section.title.replace(/\s/g, '')}`);

  // Filter to unique movies
  const uniqueMovies = movies.filter(m => !loadedMovieIds[section.title].has(m.id));

  for (const movie of uniqueMovies.slice(0, config.perLoad)) {
    loadedMovieIds[section.title].add(movie.id);

    const poster = movie.poster_path
      ? `https://image.tmdb.org/t/p/${config.imageSize}${movie.poster_path}`
      : 'https://via.placeholder.com/140x210?text=No+Image';

    const movieData = {
      tmdbId: movie.id,
      title: movie.title,
      year: movie.release_date?.slice(0, 4) || 'N/A',
      img: poster,
      link: `${BASE_URL}/movies/viewer.html?id=${movie.id}`
    };

    const card = createMovieCard(movieData);
    rowEl.appendChild(card);
  }

  loadedCounts[section.title] += config.perLoad;
  return true;
}

function setupInfiniteScroll(section, config) {
  const rowEl = document.getElementById(`row-${section.title.replace(/\s/g, '')}`);
  if (!rowEl) return;

  let loading = false;
  rowEl.addEventListener('scroll', async () => {
    if (loading) return;
    if (rowEl.scrollLeft + rowEl.clientWidth >= rowEl.scrollWidth - 300) {
      loading = true;
      await loadMoviesForSection(section, config);
      loading = false;
    }
  }, { passive: true });
}

document.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('movieSections');
  const statusEl = document.getElementById('movieStatus');
  const navEl = document.getElementById('movieNav');
  if (!container) {
    console.error('Missing container with id "movieSections" in HTML');
    return;
  }

  const settings = getThemeSettings();
  const config = getLoadConfig(settings);

  await fetchGenres();

  const sections = getSections();

  // Create section skeletons immediately for stable layout
  sections.forEach(section => createSectionSkeleton(section, container));
  if (navEl) {
    navEl.innerHTML = '';
    sections.slice(0, 10).forEach(section => createNavButton(section, navEl));
  }

  // Prioritize above-the-fold sections first for faster perceived load
  const prioritySections = sections.slice(0, config.priorityCount);
  const deferredSections = sections.slice(config.priorityCount);
  await Promise.all(prioritySections.map(section => loadMoviesForSection(section, config)));
  if (statusEl) {
    statusEl.textContent = `Loaded ${prioritySections.length} sections`;
  }

  const loadDeferredSections = async () => {
    await Promise.all(deferredSections.map(section => loadMoviesForSection(section, config)));
    if (statusEl) {
      statusEl.textContent = `Loaded ${sections.length} sections`;
    }
  };

  if ('requestIdleCallback' in window) {
    requestIdleCallback(loadDeferredSections, { timeout: 1200 });
  } else {
    setTimeout(loadDeferredSections, 0);
  }

  sections.forEach(section => setupInfiniteScroll(section, config));
});
