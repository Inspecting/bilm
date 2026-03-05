function detectBasePath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const appRoots = new Set(['home', 'movies', 'tv', 'games', 'search', 'settings', 'random', 'test', 'shared', 'index.html']);
  if (!parts.length || appRoots.has(parts[0])) return '';
  if (parts.length > 1 && appRoots.has(parts[1])) return `/${parts[0]}`;
  return '';
}

const TMDB_API_KEY = '3ade810499876bb5672f40e54960e6a2';
const ANILIST_GRAPHQL_URL = 'https://graphql.anilist.co';
const BASE_URL = detectBasePath();
const moviesPerLoad = 15;
const PRIORITY_SECTION_COUNT = 4;
const animeMoviesPerLoad = 15;
const ANIME_MOVIE_GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Romance', 'Sci-Fi'];

let allGenres = [];
const loadedCounts = {};
const loadedMovieIds = {};
const animeLoadedCounts = {};
const animeLoadedIds = {};
const API_COOLDOWN_MS = 100;
const API_MAX_RETRIES = 2;
const apiCooldownByHost = new Map();
const apiRequestQueueByHost = new Map();
const inFlightGetRequests = new Map();
const inFlightPostRequests = new Map();

const modeState = { current: 'regular' };

function setContentMode(mode) {
  const normalizedMode = mode === 'anime' ? 'anime' : 'regular';
  modeState.current = normalizedMode;

  const regularButton = document.getElementById('regularModeButton');
  const animeButton = document.getElementById('animeModeButton');
  const quickFilters = document.getElementById('quickFilters');
  const movieSections = document.getElementById('movieSections');
  const animeQuickFilters = document.getElementById('animeQuickFilters');
  const animeSections = document.getElementById('animeSections');

  const isAnime = normalizedMode === 'anime';
  if (regularButton) {
    regularButton.classList.toggle('is-active', !isAnime);
    regularButton.setAttribute('aria-selected', String(!isAnime));
  }
  if (animeButton) {
    animeButton.classList.toggle('is-active', isAnime);
    animeButton.setAttribute('aria-selected', String(isAnime));
  }
  if (quickFilters) quickFilters.classList.toggle('is-hidden', isAnime);
  if (movieSections) movieSections.classList.toggle('is-hidden', isAnime);
  if (animeQuickFilters) animeQuickFilters.classList.toggle('is-hidden', !isAnime);
  if (animeSections) animeSections.classList.toggle('is-hidden', !isAnime);
}

function bindModeToggleButtons() {
  const regularButton = document.getElementById('regularModeButton');
  const animeButton = document.getElementById('animeModeButton');
  if (regularButton) regularButton.addEventListener('click', () => setContentMode('regular'));
  if (animeButton) animeButton.addEventListener('click', () => setContentMode('anime'));
}

function slugifySectionTitle(title) {
  return (title || 'section')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}


function getApiHost(url) {
  try {
    return new URL(url, window.location.origin).host || 'default';
  } catch {
    return 'default';
  }
}

async function waitForApiCooldown(url) {
  const host = getApiHost(url);
  const previousRequest = apiRequestQueueByHost.get(host) || Promise.resolve();

  const requestTurn = previousRequest
    .catch(() => {})
    .then(async () => {
      const now = Date.now();
      const nextAllowedAt = apiCooldownByHost.get(host) || 0;
      const waitMs = nextAllowedAt - now;
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
      apiCooldownByHost.set(host, Date.now() + API_COOLDOWN_MS);
    });

  apiRequestQueueByHost.set(host, requestTurn);
  await requestTurn;
}
async function fetchJSON(url) {
  const cacheKey = String(url);
  if (inFlightGetRequests.has(cacheKey)) {
    return inFlightGetRequests.get(cacheKey);
  }

  const request = (async () => {
    for (let attempt = 0; attempt <= API_MAX_RETRIES; attempt += 1) {
      try {
        await waitForApiCooldown(url);
        const res = await fetch(url);
        if (res.ok) {
          return await res.json();
        }

        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number.parseFloat(res.headers.get('Retry-After'));
          const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 250 * (attempt + 1);
          if (attempt < API_MAX_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            continue;
          }
        }

        throw new Error(`HTTP ${res.status}`);
      } catch {
        if (attempt >= API_MAX_RETRIES) return null;
      }
    }

    return null;
  })();

  inFlightGetRequests.set(cacheKey, request);
  request.finally(() => {
    inFlightGetRequests.delete(cacheKey);
  });

  return request;
}

async function postJSON(url, body) {
  const cacheKey = `${url}:${JSON.stringify(body)}`;
  if (inFlightPostRequests.has(cacheKey)) {
    return inFlightPostRequests.get(cacheKey);
  }

  const request = (async () => {
    const isAniList = /graphql\.anilist\.co/i.test(url);

    for (let attempt = 0; attempt <= API_MAX_RETRIES; attempt += 1) {
      try {
        await waitForApiCooldown(url);
        const res = await fetch(url, {
          method: 'POST',
          headers: isAniList
            ? { 'Content-Type': 'text/plain;charset=UTF-8' }
            : { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body)
        });
        if (res.ok) {
          return await res.json();
        }

        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number.parseFloat(res.headers.get('Retry-After'));
          const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 250 * (attempt + 1);
          if (attempt < API_MAX_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            continue;
          }
        }

        throw new Error(`HTTP ${res.status}`);
      } catch {
        if (attempt >= API_MAX_RETRIES) return null;
      }
    }

    return null;
  })();

  inFlightPostRequests.set(cacheKey, request);
  request.finally(() => {
    inFlightPostRequests.delete(cacheKey);
  });

  return request;
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

  const genreSections = allGenres.map((genre) => ({
    title: genre.name,
    endpoint: `/discover/movie?with_genres=${genre.id}`
  }));

  return [...staticSections, ...genreSections].map((section) => ({
    ...section,
    slug: slugifySectionTitle(section.title)
  }));
}

function getAnimeMovieSections() {
  return ANIME_MOVIE_GENRES.map((genre) => ({
    title: genre,
    genre,
    slug: `anime-${slugifySectionTitle(genre)}`
  }));
}

async function fetchMovies(endpoint, page = 1) {
  const url = endpoint.includes('?')
    ? `https://api.themoviedb.org/3${endpoint}&api_key=${TMDB_API_KEY}&page=${page}`
    : `https://api.themoviedb.org/3${endpoint}?api_key=${TMDB_API_KEY}&page=${page}`;
  const data = await fetchJSON(url);
  return data?.results || [];
}

async function fetchAnimeMoviesByGenre(genre, page = 1) {
  const query = `
    query ($page: Int!, $perPage: Int!, $genre: String!) {
      Page(page: $page, perPage: $perPage) {
        media(type: ANIME, format: MOVIE, genre_in: [$genre], sort: [POPULARITY_DESC, SCORE_DESC]) {
          id
          title {
            romaji
            english
          }
          coverImage {
            large
            medium
          }
          startDate {
            year
          }
        }
      }
    }
  `;

  let data = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    data = await postJSON(ANILIST_GRAPHQL_URL, {
      query,
      variables: { page, perPage: animeMoviesPerLoad, genre }
    });
    if (data?.data?.Page?.media?.length) break;
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }

  return data?.data?.Page?.media || [];
}

function createMovieCard(movie) {
  return window.BilmMediaCard.createMediaCard({
    item: movie,
    className: 'movie-card',
    badgeClassName: 'source-badge-overlay',
    dataset: { tmdbId: movie.tmdbId }
  });
}

function createSectionSkeleton(section, container, prefix = '') {
  const sectionEl = document.createElement('section');
  sectionEl.className = 'section';
  sectionEl.id = `${prefix}section-${section.slug}`;

  const headerEl = document.createElement('div');
  headerEl.className = 'section-header';

  const titleEl = document.createElement('h2');
  titleEl.className = 'section-title';
  titleEl.textContent = section.title;

  headerEl.appendChild(titleEl);

  if (!prefix) {
    const viewMoreLink = document.createElement('a');
    viewMoreLink.className = 'view-more-button';
    viewMoreLink.href = `${BASE_URL}/movies/category.html?section=${encodeURIComponent(section.slug)}&title=${encodeURIComponent(section.title)}`;
    viewMoreLink.textContent = 'View more';
    viewMoreLink.setAttribute('aria-label', `View more ${section.title} movies`);
    headerEl.appendChild(viewMoreLink);
  }

  const rowEl = document.createElement('div');
  rowEl.className = 'scroll-row';
  rowEl.id = `${prefix}row-${section.slug}`;

  const statusEl = document.createElement('p');
  statusEl.className = 'section-status';
  statusEl.setAttribute('aria-live', 'polite');

  sectionEl.appendChild(headerEl);
  sectionEl.appendChild(rowEl);
  sectionEl.appendChild(statusEl);
  container.appendChild(sectionEl);
}

function renderQuickFilters(sections, containerId = 'quickFilters', targetPrefix = '') {
  const filtersContainer = document.getElementById(containerId);
  if (!filtersContainer) return;

  filtersContainer.innerHTML = '';
  sections.forEach((section) => {
    const chip = document.createElement('a');
    chip.className = 'filter-chip';
    chip.href = `#${targetPrefix}section-${section.slug}`;
    chip.textContent = section.title;
    chip.addEventListener('click', (event) => {
      event.preventDefault();
      const target = document.getElementById(`${targetPrefix}section-${section.slug}`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    filtersContainer.appendChild(chip);
  });
}

async function loadMoviesForSection(section) {
  loadedCounts[section.slug] ??= 0;
  loadedMovieIds[section.slug] ??= new Set();

  const page = Math.floor(loadedCounts[section.slug] / moviesPerLoad) + 1;
  const movies = await fetchMovies(section.endpoint, page);
  if (!movies.length) return false;

  const rowEl = document.getElementById(`row-${section.slug}`);

  const uniqueMovies = movies.filter((m) => !loadedMovieIds[section.slug].has(m.id));

  for (const movie of uniqueMovies.slice(0, moviesPerLoad)) {
    loadedMovieIds[section.slug].add(movie.id);

    const poster = movie.poster_path
      ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
      : 'https://via.placeholder.com/140x210?text=No+Image';

    const movieData = {
      tmdbId: movie.id,
      title: movie.title,
      type: 'movie',
      year: movie.release_date?.slice(0, 4) || 'N/A',
      img: poster,
      link: `${BASE_URL}/movies/show.html?id=${movie.id}`,
      source: 'TMDB',
      rating: movie.vote_average
    };

    const card = createMovieCard(movieData);
    rowEl.appendChild(card);
  }

  loadedCounts[section.slug] += moviesPerLoad;
  return true;
}

async function loadAnimeMoviesForSection(section) {
  animeLoadedCounts[section.slug] ??= 0;
  animeLoadedIds[section.slug] ??= new Set();

  const rowEl = document.getElementById(`anime-row-${section.slug}`);
  if (!rowEl) return false;
  const sectionEl = rowEl.closest('.section');
  const statusEl = sectionEl?.querySelector('.section-status');

  const page = Math.floor(animeLoadedCounts[section.slug] / animeMoviesPerLoad) + 1;
  const animeMovies = await fetchAnimeMoviesByGenre(section.genre, page);
  if (!animeMovies.length) {
    if (statusEl && !rowEl.children.length) {
      statusEl.textContent = 'Could not load anime titles right now. Please try again.';
    }
    return false;
  }

  const uniqueMovies = animeMovies.filter((m) => !animeLoadedIds[section.slug].has(m.id));
  const visibleMovies = uniqueMovies.slice(0, animeMoviesPerLoad);

  for (const animeMovie of visibleMovies) {
    animeLoadedIds[section.slug].add(animeMovie.id);

    const movieData = {
      tmdbId: animeMovie.id,
      title: animeMovie.title?.english || animeMovie.title?.romaji || 'Untitled',
      type: 'movie',
      year: animeMovie.startDate?.year || 'N/A',
      img: animeMovie.coverImage?.large || animeMovie.coverImage?.medium,
      link: `${BASE_URL}/movies/show.html?anime=1&aid=${animeMovie.id}&type=movie`,
      source: 'AniList'
    };

    const card = createMovieCard(movieData);
    rowEl.appendChild(card);
  }

  if (statusEl) {
    statusEl.textContent = visibleMovies.length ? '' : 'No new titles available right now.';
  }

  animeLoadedCounts[section.slug] += animeMoviesPerLoad;
  return true;
}

function setupInfiniteScroll(section, loaderFn, rowPrefix = '') {
  const rowEl = document.getElementById(`${rowPrefix}row-${section.slug}`);
  if (!rowEl) return;

  let loading = false;
  rowEl.addEventListener('scroll', async () => {
    if (loading) return;
    if (rowEl.scrollLeft + rowEl.clientWidth >= rowEl.scrollWidth - 300) {
      loading = true;
      await loaderFn(section);
      loading = false;
    }
  }, { passive: true });
}

document.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('movieSections');
  const animeContainer = document.getElementById('animeSections');
  if (!container || !animeContainer) {
    console.error('Missing movie section container(s) in HTML');
    return;
  }

  bindModeToggleButtons();
  setContentMode('regular');

  await fetchGenres();
  const sections = getSections();
  const animeSections = getAnimeMovieSections();

  renderQuickFilters(sections, 'quickFilters');
  sections.forEach((section) => createSectionSkeleton(section, container));

  renderQuickFilters(animeSections, 'animeQuickFilters', 'anime-');
  animeSections.forEach((section) => createSectionSkeleton(section, animeContainer, 'anime-'));

  const prioritySections = sections.slice(0, PRIORITY_SECTION_COUNT);
  const deferredSections = sections.slice(PRIORITY_SECTION_COUNT);
  await Promise.all(prioritySections.map((section) => loadMoviesForSection(section)));

  const priorityAnimeSections = animeSections.slice(0, PRIORITY_SECTION_COUNT);
  const deferredAnimeSections = animeSections.slice(PRIORITY_SECTION_COUNT);
  await Promise.all(priorityAnimeSections.map((section) => loadAnimeMoviesForSection(section)));

  const loadDeferredSections = async () => {
    await Promise.all(deferredSections.map((section) => loadMoviesForSection(section)));
    await Promise.all(deferredAnimeSections.map((section) => loadAnimeMoviesForSection(section)));
  };

  if ('requestIdleCallback' in window) {
    requestIdleCallback(loadDeferredSections, { timeout: 1200 });
  } else {
    setTimeout(loadDeferredSections, 0);
  }

  sections.forEach((section) => setupInfiniteScroll(section, loadMoviesForSection));
  animeSections.forEach((section) => setupInfiniteScroll(section, loadAnimeMoviesForSection, 'anime-'));
});
