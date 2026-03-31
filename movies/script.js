function detectBasePath() {
  const appRoots = new Set(['home', 'movies', 'tv', 'games', 'search', 'settings', 'random', 'test', 'shared', 'index.html']);
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (!parts.length) return '';
  
  const appRootIndex = parts.findIndex((part) => appRoots.has(part));
  if (appRootIndex >= 0) {
    if (appRootIndex === 0) return '';
    return `/${parts.slice(0, appRootIndex).join('/')}`;
  }
  
  if (parts[0] === 'gh' && parts.length >= 3) {
    return `/${parts.slice(0, 3).join('/')}`;
  }
  if (parts[0] === 'npm' && parts.length >= 2) {
    return `/${parts.slice(0, 2).join('/')}`;
  }
  if (parts.length === 1) {
    return `/${parts[0]}`;
  }
  return '';
}

const ANILIST_GRAPHQL_URL = 'https://storage-api.watchbilm.org/media/anilist';
const BASE_URL = detectBasePath();
const moviesPerLoad = 15;
const PRIORITY_SECTION_COUNT = 4;
const animeMoviesPerLoad = 15;
const ANIME_MOVIE_GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Romance', 'Sci-Fi'];

let allGenres = [];
const genreNameById = new Map();
const loadedCounts = {};
const loadedMovieIds = {};
const animeLoadedCounts = {};
const animeLoadedIds = {};
const API_COOLDOWN_MS = 100;
const API_MAX_RETRIES = 2;
const SECTION_API_MAX_RETRIES = 1;
const SECTION_LOAD_INTERVAL_MS = 100;
const API_DEBUG_TIMING = false;
const apiCooldownByHost = new Map();
const apiRequestQueueByHost = new Map();
const inFlightGetRequests = new Map();
const inFlightPostRequests = new Map();
const pageRequestController = new AbortController();

const modeState = { current: 'regular' };
const filterState = {
  genres: new Set(),
  ageRatings: new Set(),
  minYear: '',
  maxYear: '',
  minRating: ''
};
const filterElements = {
  toggle: null,
  overlay: null,
  drawer: null,
  close: null,
  yearMin: null,
  yearMax: null,
  ratingMin: null,
  genreOptions: null,
  ageRatingOptions: null,
  clear: null,
  apply: null,
  summary: null
};
let filterMutationRefreshTimer = null;
let animeSectionsBootstrapped = false;
let animeSectionsLoadPromise = null;
let activeAniListUrl = ANILIST_GRAPHQL_URL;
let animeApiDisabled = false;

function getApiOrigin() {
  return String(window.location.hostname || '').toLowerCase() === 'cdn.jsdelivr.net'
    ? 'https://watchbilm.org'
    : window.location.origin;
}

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

  refreshFilterUiForCurrentMode();
  applyFiltersToActiveMode();
}

function bindModeToggleButtons(onAnimeSelected) {
  const regularButton = document.getElementById('regularModeButton');
  const animeButton = document.getElementById('animeModeButton');
  if (regularButton) regularButton.addEventListener('click', () => setContentMode('regular'));
  if (animeButton) {
    animeButton.addEventListener('click', async () => {
      setContentMode('anime');
      if (typeof onAnimeSelected === 'function') {
        await onAnimeSelected();
      }
    });
  }
}

function slugifySectionTitle(title) {
  return (title || 'section')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}

function normalizeFilterToken(value) {
  return String(value || '').trim().toLowerCase();
}

function sanitizeFilterYear(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1900 || parsed > 2100) return '';
  return parsed;
}

function sanitizeFilterRating(value) {
  const parsed = Number.parseFloat(String(value || '').trim());
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10) return '';
  return Math.round(parsed * 10) / 10;
}

function getActiveSectionsContainer() {
  return modeState.current === 'anime'
    ? document.getElementById('animeSections')
    : document.getElementById('movieSections');
}

function getActiveGenreOptionLabels() {
  if (modeState.current === 'anime') return [...ANIME_MOVIE_GENRES];
  return allGenres.map((genre) => String(genre?.name || '').trim()).filter(Boolean);
}

function getCardYear(card) {
  const directYear = sanitizeFilterYear(card?.dataset?.year);
  if (directYear) return directYear;
  const subtitle = card?.querySelector('.card-subtitle')?.textContent || '';
  const fromSubtitle = subtitle.split('•').map((part) => part.trim())[0];
  return sanitizeFilterYear(fromSubtitle);
}

function getCardRating(card) {
  const directRating = sanitizeFilterRating(card?.dataset?.rating);
  if (directRating !== '') return directRating;
  const badgeText = card?.querySelector('.rating-badge-overlay')?.textContent || '';
  const parsed = Number.parseFloat(String(badgeText).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 10) / 10;
}

function getCardAgeRating(card) {
  const fromDataset = String(card?.dataset?.ageRating || '').trim();
  if (fromDataset) return fromDataset.toUpperCase();
  const subtitle = String(card?.querySelector('.card-subtitle')?.textContent || '').trim();
  if (!subtitle) return 'N/A';
  const parts = subtitle.split('•').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return 'N/A';
  return String(parts[parts.length - 1] || 'N/A').toUpperCase();
}

function getCardGenreTokens(card) {
  const raw = String(card?.dataset?.genres || '');
  if (!raw) return [];
  return raw.split('|').map((entry) => normalizeFilterToken(entry)).filter(Boolean);
}

function cardMatchesActiveFilters(card) {
  const activeGenres = filterState.genres;
  const activeAgeRatings = filterState.ageRatings;
  const minYear = sanitizeFilterYear(filterState.minYear);
  const maxYear = sanitizeFilterYear(filterState.maxYear);
  const minRating = sanitizeFilterRating(filterState.minRating);

  const cardYear = getCardYear(card);
  const cardRating = getCardRating(card);
  const cardAgeRating = normalizeFilterToken(getCardAgeRating(card));
  const cardGenres = getCardGenreTokens(card);

  if (activeGenres.size > 0) {
    const hasGenreMatch = cardGenres.some((token) => activeGenres.has(token));
    if (!hasGenreMatch) return false;
  }

  if (activeAgeRatings.size > 0 && !activeAgeRatings.has(cardAgeRating)) {
    return false;
  }

  if (minYear !== '' && (!cardYear || cardYear < minYear)) {
    return false;
  }

  if (maxYear !== '' && (!cardYear || cardYear > maxYear)) {
    return false;
  }

  if (minRating !== '' && (cardRating == null || cardRating < minRating)) {
    return false;
  }

  return true;
}

function updateFilterSummary(visibleCount, totalCount) {
  if (!filterElements.summary) return;
  const hasActiveFilters = filterState.genres.size > 0
    || filterState.ageRatings.size > 0
    || sanitizeFilterYear(filterState.minYear) !== ''
    || sanitizeFilterYear(filterState.maxYear) !== ''
    || sanitizeFilterRating(filterState.minRating) !== '';

  if (!hasActiveFilters) {
    filterElements.summary.textContent = `Showing ${visibleCount} of ${totalCount} loaded titles.`;
    return;
  }

  filterElements.summary.textContent = `Filters on: showing ${visibleCount} of ${totalCount} loaded titles.`;
}

function scheduleFilterRefreshFromMutations() {
  if (filterMutationRefreshTimer) return;
  filterMutationRefreshTimer = window.setTimeout(() => {
    filterMutationRefreshTimer = null;
    refreshFilterUiForCurrentMode();
    applyFiltersToActiveMode();
  }, 120);
}

function applyFiltersToActiveMode() {
  const container = getActiveSectionsContainer();
  if (!container) return;

  const cards = [...container.querySelectorAll('.movie-card')];
  let visibleCount = 0;

  cards.forEach((card) => {
    const matches = cardMatchesActiveFilters(card);
    card.classList.toggle('is-filtered-out', !matches);
    if (matches) visibleCount += 1;
  });

  const sections = [...container.querySelectorAll('.section')];
  sections.forEach((section) => {
    const sectionCards = [...section.querySelectorAll('.movie-card')];
    const visibleCards = sectionCards.filter((card) => !card.classList.contains('is-filtered-out'));
    section.classList.toggle('is-filtered-out-section', sectionCards.length > 0 && visibleCards.length === 0);
  });

  updateFilterSummary(visibleCount, cards.length);
}

function renderFilterOptions(container, entries, selectedTokens, inputName) {
  if (!container) return;
  container.innerHTML = '';

  if (!entries.length) {
    const empty = document.createElement('span');
    empty.className = 'card-subtitle';
    empty.textContent = 'No options yet.';
    container.appendChild(empty);
    return;
  }

  entries.forEach((entry, index) => {
    const token = normalizeFilterToken(entry.token);
    const label = String(entry.label || '').trim() || 'Unknown';
    const wrapper = document.createElement('label');
    wrapper.className = 'filter-option';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = inputName;
    input.value = token;
    input.id = `${inputName}-${index}`;
    input.checked = selectedTokens.has(token);

    const text = document.createElement('span');
    text.textContent = label;

    wrapper.appendChild(input);
    wrapper.appendChild(text);
    container.appendChild(wrapper);
  });
}

function collectFilterStateFromUi() {
  if (!filterElements.drawer) return;
  const selectedGenreTokens = new Set(
    [...filterElements.drawer.querySelectorAll('input[name="genreFilterOption"]:checked')]
      .map((input) => normalizeFilterToken(input.value))
      .filter(Boolean)
  );
  const selectedAgeTokens = new Set(
    [...filterElements.drawer.querySelectorAll('input[name="ageFilterOption"]:checked')]
      .map((input) => normalizeFilterToken(input.value))
      .filter(Boolean)
  );

  let minYear = sanitizeFilterYear(filterElements.yearMin?.value);
  let maxYear = sanitizeFilterYear(filterElements.yearMax?.value);
  if (minYear !== '' && maxYear !== '' && minYear > maxYear) {
    const temp = minYear;
    minYear = maxYear;
    maxYear = temp;
  }
  const minRating = sanitizeFilterRating(filterElements.ratingMin?.value);

  filterState.genres = selectedGenreTokens;
  filterState.ageRatings = selectedAgeTokens;
  filterState.minYear = minYear === '' ? '' : String(minYear);
  filterState.maxYear = maxYear === '' ? '' : String(maxYear);
  filterState.minRating = minRating === '' ? '' : String(minRating);
}

function refreshFilterUiForCurrentMode() {
  if (!filterElements.drawer) return;

  const genreEntries = getActiveGenreOptionLabels().map((label) => ({
    token: label,
    label
  }));
  const allowedGenreTokens = new Set(genreEntries.map((entry) => normalizeFilterToken(entry.token)));
  filterState.genres = new Set([...filterState.genres].filter((token) => allowedGenreTokens.has(token)));

  const cards = [...(getActiveSectionsContainer()?.querySelectorAll('.movie-card') || [])];
  const ageEntries = [...new Set(cards.map((card) => getCardAgeRating(card)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
    .map((rating) => ({ token: rating, label: rating }));
  const allowedAgeTokens = new Set(ageEntries.map((entry) => normalizeFilterToken(entry.token)));
  filterState.ageRatings = new Set([...filterState.ageRatings].filter((token) => allowedAgeTokens.has(token)));

  renderFilterOptions(filterElements.genreOptions, genreEntries, filterState.genres, 'genreFilterOption');
  renderFilterOptions(filterElements.ageRatingOptions, ageEntries, filterState.ageRatings, 'ageFilterOption');

  if (filterElements.yearMin) filterElements.yearMin.value = filterState.minYear;
  if (filterElements.yearMax) filterElements.yearMax.value = filterState.maxYear;
  if (filterElements.ratingMin) filterElements.ratingMin.value = filterState.minRating;
}

function setFiltersDrawerOpen(open) {
  const isOpen = Boolean(open);
  if (!filterElements.drawer || !filterElements.overlay) return;
  filterElements.drawer.classList.toggle('is-hidden', !isOpen);
  filterElements.overlay.classList.toggle('is-hidden', !isOpen);
  filterElements.drawer.setAttribute('aria-hidden', String(!isOpen));
  if (filterElements.toggle) {
    filterElements.toggle.setAttribute('aria-expanded', String(isOpen));
  }
  document.body.classList.toggle('filters-open', isOpen);
}

function clearAllFilters() {
  filterState.genres = new Set();
  filterState.ageRatings = new Set();
  filterState.minYear = '';
  filterState.maxYear = '';
  filterState.minRating = '';
  refreshFilterUiForCurrentMode();
  applyFiltersToActiveMode();
}

function initializeFiltersUi() {
  filterElements.toggle = document.getElementById('filtersToggleBtn');
  filterElements.overlay = document.getElementById('filtersOverlay');
  filterElements.drawer = document.getElementById('filtersDrawer');
  filterElements.close = document.getElementById('closeFiltersBtn');
  filterElements.yearMin = document.getElementById('filterYearMin');
  filterElements.yearMax = document.getElementById('filterYearMax');
  filterElements.ratingMin = document.getElementById('filterRatingMin');
  filterElements.genreOptions = document.getElementById('filterGenreOptions');
  filterElements.ageRatingOptions = document.getElementById('filterAgeRatingOptions');
  filterElements.clear = document.getElementById('clearFiltersBtn');
  filterElements.apply = document.getElementById('applyFiltersBtn');
  filterElements.summary = document.getElementById('filtersSummary');

  if (!filterElements.toggle || !filterElements.drawer || !filterElements.overlay) return;

  filterElements.toggle.addEventListener('click', () => {
    refreshFilterUiForCurrentMode();
    setFiltersDrawerOpen(true);
  });

  filterElements.close?.addEventListener('click', () => setFiltersDrawerOpen(false));
  filterElements.overlay.addEventListener('click', () => setFiltersDrawerOpen(false));

  filterElements.clear?.addEventListener('click', () => {
    clearAllFilters();
  });

  filterElements.apply?.addEventListener('click', () => {
    collectFilterStateFromUi();
    refreshFilterUiForCurrentMode();
    applyFiltersToActiveMode();
  });

  filterElements.drawer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setFiltersDrawerOpen(false);
    }
  });

  if (typeof MutationObserver === 'function') {
    const observer = new MutationObserver((mutations) => {
      const shouldRefresh = mutations.some((mutation) => mutation.type === 'childList' || mutation.type === 'characterData');
      if (shouldRefresh) {
        scheduleFilterRefreshFromMutations();
      }
    });
    const targets = [document.getElementById('movieSections'), document.getElementById('animeSections')].filter(Boolean);
    targets.forEach((target) => {
      observer.observe(target, { childList: true, subtree: true, characterData: true });
    });
  }
}

function getRequestSignal(signal) {
  return signal || pageRequestController.signal;
}

function debugApiTiming(event, details) {
  if (!API_DEBUG_TIMING) return;
  console.debug(`[api:${event}]`, details);
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function getApiHost(url) {
  try {
    return new URL(url, window.location.origin).host || 'default';
  } catch {
    return 'default';
  }
}

async function waitForApiCooldown(url, signal) {
  if (signal?.aborted) return 0;
  const host = getApiHost(url);
  const previousRequest = apiRequestQueueByHost.get(host) || Promise.resolve();

  const requestTurn = previousRequest
    .catch(() => {})
    .then(async () => {
      const now = Date.now();
      const nextAllowedAt = apiCooldownByHost.get(host) || 0;
      const waitMs = nextAllowedAt - now;
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      apiCooldownByHost.set(host, Date.now() + API_COOLDOWN_MS);
      return Math.max(waitMs, 0);
    });

  apiRequestQueueByHost.set(host, requestTurn);
  return requestTurn;
}

function getStorageApiBackupGetUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || '').trim(), window.location.href);
    if (parsed.origin !== 'https://storage-api.watchbilm.org') return '';
    if (!parsed.pathname.startsWith('/media/tmdb/')) return '';
    const tmdbPath = parsed.pathname.slice('/media/tmdb/'.length);
    const backup = new URL(`/api/tmdb/${tmdbPath}`, getApiOrigin());
    parsed.searchParams.forEach((value, key) => {
      if (String(key || '').toLowerCase() === 'api_key') return;
      backup.searchParams.append(key, value);
    });
    return backup.toString();
  } catch {
    return '';
  }
}

function getStorageApiBackupPostUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || '').trim(), window.location.href);
    if (parsed.origin !== 'https://storage-api.watchbilm.org') return '';
    if (parsed.pathname !== '/media/anilist') return '';
    return 'https://graphql.anilist.co';
  } catch {
    return '';
  }
}

async function fetchJSON(url, options = {}) {
  const signal = getRequestSignal(options.signal);
  const maxRetries = options.maxRetries ?? API_MAX_RETRIES;
  const cacheKey = `${url}::${signal === pageRequestController.signal ? 'page' : 'custom'}`;
  if (inFlightGetRequests.has(cacheKey)) {
    return inFlightGetRequests.get(cacheKey);
  }

  const request = (async () => {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const queueWaitMs = attempt === 0 ? await waitForApiCooldown(url, signal) : 0;
        const startedAt = performance.now();
        const res = await fetch(url, { signal });
        debugApiTiming('fetch', {
          url,
          method: 'GET',
          attempt,
          queueWaitMs,
          fetchDurationMs: Math.round(performance.now() - startedAt),
          status: res.status
        });
        if (res.ok) {
          return await res.json();
        }

        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number.parseFloat(res.headers.get('Retry-After'));
          const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(350, 150 * (attempt + 1));
          if (attempt < maxRetries) {
            debugApiTiming('retry-backoff', { url, method: 'GET', attempt, backoffMs });
            await sleep(backoffMs);
            continue;
          }
        }

        throw new Error(`HTTP ${res.status}`);
      } catch (error) {
        if (isAbortError(error) || signal.aborted) return null;
        if (attempt >= maxRetries) break;
      }
    }

    const backupUrl = getStorageApiBackupGetUrl(url);
    if (!backupUrl || backupUrl === url) return null;
    try {
      console.info('[api-fallback] movies page using backup provider', {
        primaryUrl: url,
        backupUrl
      });
      await waitForApiCooldown(backupUrl, signal);
      const fallbackResponse = await fetch(backupUrl, { signal });
      if (!fallbackResponse.ok) return null;
      return await fallbackResponse.json();
    } catch {
      return null;
    }

    return null;
  })();

  inFlightGetRequests.set(cacheKey, request);
  request.finally(() => {
    inFlightGetRequests.delete(cacheKey);
  });

  return request;
}

async function postJSON(url, body, options = {}) {
  const signal = getRequestSignal(options.signal);
  const maxRetries = options.maxRetries ?? API_MAX_RETRIES;
  const cacheKey = `${url}:${JSON.stringify(body)}::${signal === pageRequestController.signal ? 'page' : 'custom'}`;
  if (inFlightPostRequests.has(cacheKey)) {
    return inFlightPostRequests.get(cacheKey);
  }

  const request = (async () => {
    const isAniList = /graphql\.anilist\.co/i.test(url);

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const queueWaitMs = attempt === 0 ? await waitForApiCooldown(url, signal) : 0;
        const startedAt = performance.now();
        const res = await fetch(url, {
          method: 'POST',
          headers: isAniList
            ? { 'Content-Type': 'text/plain;charset=UTF-8' }
            : { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
          signal
        });
        debugApiTiming('fetch', {
          url,
          method: 'POST',
          attempt,
          queueWaitMs,
          fetchDurationMs: Math.round(performance.now() - startedAt),
          status: res.status
        });
        if (res.ok) {
          return await res.json();
        }

        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number.parseFloat(res.headers.get('Retry-After'));
          const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(350, 150 * (attempt + 1));
          if (attempt < maxRetries) {
            debugApiTiming('retry-backoff', { url, method: 'POST', attempt, backoffMs });
            await sleep(backoffMs);
            continue;
          }
        }

        throw new Error(`HTTP ${res.status}`);
      } catch (error) {
        if (isAbortError(error) || signal.aborted) return null;
        if (attempt >= maxRetries) break;
      }
    }

    const backupUrl = getStorageApiBackupPostUrl(url);
    if (!backupUrl || backupUrl === url) return null;
    try {
      console.info('[api-fallback] movies page using backup provider', {
        primaryUrl: url,
        backupUrl
      });
      await waitForApiCooldown(backupUrl, signal);
      const fallbackResponse = await fetch(backupUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(body),
        signal
      });
      if (!fallbackResponse.ok) return null;
      return await fallbackResponse.json();
    } catch {
      return null;
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
  const url = `https://storage-api.watchbilm.org/media/tmdb/genre/movie/list?language=en-US`;
  const data = await fetchJSON(url, { maxRetries: SECTION_API_MAX_RETRIES });
  allGenres = data?.genres || [];
  genreNameById.clear();
  allGenres.forEach((genre) => {
    const id = Number(genre?.id);
    const name = String(genre?.name || '').trim();
    if (Number.isFinite(id) && name) {
      genreNameById.set(id, name);
    }
  });
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
    ? `https://storage-api.watchbilm.org/media/tmdb${endpoint}&page=${page}`
    : `https://storage-api.watchbilm.org/media/tmdb${endpoint}?page=${page}`;
  const data = await fetchJSON(url, { maxRetries: SECTION_API_MAX_RETRIES });
  return data?.results || [];
}

async function fetchAnimeMoviesByGenre(genre, page = 1) {
  if (animeApiDisabled) return [];

  const query = `
    query ($page: Int!, $perPage: Int!, $genre: String!) {
      Page(page: $page, perPage: $perPage) {
        media(type: ANIME, format: MOVIE, genre_in: [$genre], sort: [POPULARITY_DESC, SCORE_DESC]) {
          id
          title {
            romaji
            english
          }
          genres
          averageScore
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

  const anilistUrls = [activeAniListUrl, 'https://graphql.anilist.co'].filter((url, index, all) => all.indexOf(url) === index);

  for (const url of anilistUrls) {
    const data = await postJSON(url, {
      query,
      variables: { page, perPage: animeMoviesPerLoad, genre }
    }, { maxRetries: SECTION_API_MAX_RETRIES });

    if (data?.data?.Page?.media?.length) {
      activeAniListUrl = url;
      return data.data.Page.media;
    }
  }

  animeApiDisabled = true;
  return [];
}

function createMovieCard(movie, dataset = {}) {
  return window.BilmMediaCard.createMediaCard({
    item: movie,
    className: 'movie-card',
    badgeClassName: 'source-badge-overlay',
    dataset: {
      tmdbId: movie.tmdbId,
      year: movie.year,
      rating: movie.rating,
      ...dataset
    }
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
  if (pageRequestController.signal.aborted) return false;
  loadedCounts[section.slug] ??= 0;
  loadedMovieIds[section.slug] ??= new Set();

  const page = Math.floor(loadedCounts[section.slug] / moviesPerLoad) + 1;
  const movies = await fetchMovies(section.endpoint, page);
  if (!movies.length) return false;

  const rowEl = document.getElementById(`row-${section.slug}`);
  const statusEl = rowEl?.closest('.section')?.querySelector('.section-status');
  if (!rowEl || pageRequestController.signal.aborted) return false;

  const uniqueMovies = movies.filter((movie) => !loadedMovieIds[section.slug].has(movie.id));

  for (const movie of uniqueMovies.slice(0, moviesPerLoad)) {
    if (pageRequestController.signal.aborted) return false;
    loadedMovieIds[section.slug].add(movie.id);

    const poster = movie.poster_path
      ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
      : 'https://via.placeholder.com/140x210?text=No+Image';
    const genreTokens = (movie.genre_ids || [])
      .map((genreId) => genreNameById.get(Number(genreId)))
      .filter(Boolean)
      .map((genreName) => normalizeFilterToken(genreName));

    const movieData = {
      tmdbId: movie.id,
      title: movie.title,
      type: 'movie',
      year: movie.release_date?.slice(0, 4) || 'N/A',
      img: poster,
      link: `${BASE_URL}/movies/show.html?id=${movie.id}`,
      source: 'TMDB',
      rating: Number.isFinite(Number(movie.vote_average)) ? Number(movie.vote_average) : null
    };

    const card = createMovieCard(movieData, {
      genres: genreTokens.join('|'),
      ageRating: ''
    });
    rowEl.appendChild(card);
  }

  if (statusEl) {
    statusEl.textContent = uniqueMovies.length ? '' : 'No new titles available right now.';
  }

  loadedCounts[section.slug] += moviesPerLoad;
  applyFiltersToActiveMode();
  refreshFilterUiForCurrentMode();
  return true;
}

async function loadAnimeMoviesForSection(section) {
  if (pageRequestController.signal.aborted) return false;
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
    if (pageRequestController.signal.aborted) return false;
    animeLoadedIds[section.slug].add(animeMovie.id);
    const animeGenreTokens = (Array.isArray(animeMovie.genres) && animeMovie.genres.length
      ? animeMovie.genres
      : [section.genre])
      .map((genreName) => normalizeFilterToken(genreName));

    const movieData = {
      tmdbId: animeMovie.id,
      title: animeMovie.title?.english || animeMovie.title?.romaji || 'Untitled',
      type: 'movie',
      year: animeMovie.startDate?.year || 'N/A',
      img: animeMovie.coverImage?.large || animeMovie.coverImage?.medium,
      link: `${BASE_URL}/movies/show.html?anime=1&aid=${animeMovie.id}&type=movie`,
      source: 'AniList',
      rating: Number.isFinite(Number(animeMovie.averageScore)) ? Number(animeMovie.averageScore) / 10 : null
    };

    const card = createMovieCard(movieData, {
      genres: animeGenreTokens.join('|'),
      ageRating: 'N/A'
    });
    rowEl.appendChild(card);
  }

  if (statusEl) {
    statusEl.textContent = visibleMovies.length ? '' : 'No new titles available right now.';
  }

  animeLoadedCounts[section.slug] += animeMoviesPerLoad;
  applyFiltersToActiveMode();
  refreshFilterUiForCurrentMode();
  return true;
}


async function runSectionScheduler(prioritySections, deferredSections, loaderFn) {
  const schedule = [...prioritySections, ...deferredSections];
  for (const [index, section] of schedule.entries()) {
    if (pageRequestController.signal.aborted) break;
    await loaderFn(section);
    if (index < schedule.length - 1) {
      // Intentional UX pacing: start one section roughly every 100ms.
      await sleep(SECTION_LOAD_INTERVAL_MS);
    }
  }
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
  initializeFiltersUi();

  const ensureAnimeSectionsLoaded = async () => {
    if (animeSectionsBootstrapped || animeSectionsLoadPromise) return animeSectionsLoadPromise;

    animeSectionsLoadPromise = (async () => {
      const animeSections = getAnimeMovieSections();
      renderQuickFilters(animeSections, 'animeQuickFilters', 'anime-');
      animeSections.forEach((section) => createSectionSkeleton(section, animeContainer, 'anime-'));

      const priorityAnimeSections = animeSections.slice(0, PRIORITY_SECTION_COUNT);
      const deferredAnimeSections = animeSections.slice(PRIORITY_SECTION_COUNT);
      await runSectionScheduler(priorityAnimeSections, deferredAnimeSections, loadAnimeMoviesForSection);
      animeSections.forEach((section) => setupInfiniteScroll(section, loadAnimeMoviesForSection, 'anime-'));
      refreshFilterUiForCurrentMode();
      applyFiltersToActiveMode();
      animeSectionsBootstrapped = true;
    })().finally(() => {
      animeSectionsLoadPromise = null;
    });

    return animeSectionsLoadPromise;
  };

  bindModeToggleButtons(ensureAnimeSectionsLoaded);
  setContentMode('regular');

  await fetchGenres();
  if (pageRequestController.signal.aborted) return;
  const sections = getSections();

  renderQuickFilters(sections, 'quickFilters');
  sections.forEach((section) => createSectionSkeleton(section, container));

  const prioritySections = sections.slice(0, PRIORITY_SECTION_COUNT);
  const deferredSections = sections.slice(PRIORITY_SECTION_COUNT);

  await runSectionScheduler(prioritySections, deferredSections, loadMoviesForSection);

  sections.forEach((section) => setupInfiniteScroll(section, loadMoviesForSection));
  refreshFilterUiForCurrentMode();
  applyFiltersToActiveMode();
});


window.addEventListener('beforeunload', () => {
  pageRequestController.abort();
});
