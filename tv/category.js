function detectBasePath() {
  const appRoots = new Set(['home', 'movies', 'tv', 'search', 'settings', 'random', 'test', 'shared', 'index.html']);
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

function getApiOrigin() {
  return String(window.location.hostname || '').toLowerCase() === 'cdn.jsdelivr.net'
    ? 'https://watchbilm.org'
    : window.location.origin;
}

function toSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sanitizeYear(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1900 || parsed > 2100) return '';
  return parsed;
}

function sanitizeRating(value) {
  const parsed = Number.parseFloat(String(value || '').trim());
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10) return '';
  return Math.round(parsed * 10) / 10;
}

function pickTvCertification(items) {
  const list = Array.isArray(items) ? items : [];
  const us = list.find((entry) => entry?.iso_3166_1 === 'US');
  const fromUs = String(us?.rating || '').trim();
  if (fromUs) return fromUs.toUpperCase();

  for (const entry of list) {
    const value = String(entry?.rating || '').trim();
    if (value) return value.toUpperCase();
  }
  return '';
}

const BASE_URL = detectBasePath();
const params = new URLSearchParams(window.location.search);
const mode = params.get('mode') === 'anime' ? 'anime' : 'regular';
const section = toSlug(params.get('section') || 'trending');
const genre = toSlug(params.get('genre'));
const headingParam = String(params.get('title') || '').trim();

let yearMin = sanitizeYear(params.get('year_min'));
let yearMax = sanitizeYear(params.get('year_max'));
if (yearMin !== '' && yearMax !== '' && yearMin > yearMax) {
  const temp = yearMin;
  yearMin = yearMax;
  yearMax = temp;
}
const ratingMin = sanitizeRating(params.get('rating_min'));

const TV_AGE_VALUES = new Set(['TV-Y', 'TV-Y7', 'TV-G', 'TV-PG', 'TV-14', 'TV-MA']);
const ANIME_AGE_VALUES = new Set(['adult', 'not_adult', 'unknown']);
const age = (() => {
  const value = String(params.get('age') || '').trim();
  if (!value) return '';
  if (mode === 'anime') {
    return ANIME_AGE_VALUES.has(value) ? value : '';
  }
  const upper = value.toUpperCase();
  return TV_AGE_VALUES.has(upper) ? upper : '';
})();

const categoryTitle = document.getElementById('categoryTitle');
const categoryTitleText = categoryTitle?.querySelector('.category-title-text') || categoryTitle;
const categoryGrid = document.getElementById('categoryGrid');
const categoryStatus = document.getElementById('categoryStatus');

let loading = false;
let ended = false;
let observer;
const seenIds = new Set();
let page = 1;
let animeSourcePage = 1;

const TMDB_PAGE_SIZE = 20;
const INITIAL_LOAD_COUNT = 40;
const ANIME_SOURCE_PAGES_PER_BATCH = 12;
const REGULAR_SOURCE_PAGES_PER_BATCH = 12;

const staticMap = {
  trending: '/trending/tv/week',
  popular: '/tv/popular',
  'top-rated': '/tv/top_rated',
  'airing-today': '/tv/airing_today'
};
const staticLabelMap = {
  trending: 'Trending',
  popular: 'Popular',
  'top-rated': 'Top Rated',
  'airing-today': 'Airing Today'
};
const ANIME_TV_GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Mystery', 'Romance', 'Sci-Fi'];
const animeGenreBySlug = new Map(ANIME_TV_GENRES.map((label) => [toSlug(label), label]));

let regularConfigPromise = null;
let tvGenresPromise = null;
const tvCertificationCache = new Map();
const API_COOLDOWN_MS = 120;
const API_MAX_RETRIES = 2;
const TV_CERTIFICATION_MAX_CONCURRENCY = 4;
const apiCooldownByHost = new Map();
const apiRequestQueueByHost = new Map();
const inFlightGetRequests = new Map();
const inFlightPostRequests = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRequestHost(rawUrl) {
  try {
    return new URL(String(rawUrl || '').trim(), window.location.href).host || window.location.host;
  } catch {
    return window.location.host || 'local';
  }
}

async function waitForApiCooldown(rawUrl) {
  const host = getRequestHost(rawUrl);
  const previous = apiRequestQueueByHost.get(host) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  apiRequestQueueByHost.set(host, previous.then(() => gate));

  await previous;
  const now = Date.now();
  const nextAllowedAt = apiCooldownByHost.get(host) || 0;
  const waitMs = Math.max(0, nextAllowedAt - now);
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  apiCooldownByHost.set(host, Date.now() + API_COOLDOWN_MS);

  release();
  if (apiRequestQueueByHost.get(host) === gate) {
    apiRequestQueueByHost.delete(host);
  }
}

function shouldRetryStatus(status) {
  return status === 429 || status >= 500;
}

function getRetryDelayMs(response, attempt) {
  const retryAfter = Number.parseFloat(response?.headers?.get?.('Retry-After'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(Math.round(retryAfter * 1000), 10000);
  }
  return Math.min(250 * (2 ** attempt), 2500);
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

async function fetchWithRetry(rawUrl, options = {}) {
  const maxRetries = options.maxRetries ?? API_MAX_RETRIES;
  const requestOptions = options.fetchOptions || {};
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      await waitForApiCooldown(rawUrl);
      const response = await fetch(rawUrl, requestOptions);
      if (response.ok) {
        return response;
      }
      if (attempt < maxRetries && shouldRetryStatus(response.status)) {
        await sleep(getRetryDelayMs(response, attempt));
        continue;
      }
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (attempt >= maxRetries) {
        throw error;
      }
      await sleep(Math.min(250 * (2 ** attempt), 2500));
    }
  }
  throw new Error('Request failed');
}

async function fetchJSON(url) {
  const rawUrl = String(url || '').trim();
  if (!rawUrl) return null;
  if (inFlightGetRequests.has(rawUrl)) {
    return inFlightGetRequests.get(rawUrl);
  }

  const backupUrl = getStorageApiBackupGetUrl(rawUrl);
  const request = (async () => {
    try {
      const response = await fetchWithRetry(rawUrl);
      return await response.json();
    } catch (error) {
      if (!backupUrl) return null;
      try {
        console.info('[api-fallback] tv category using backup provider', {
          primaryUrl: rawUrl,
          backupUrl
        });
        const backupResponse = await fetchWithRetry(backupUrl);
        return await backupResponse.json();
      } catch {
        console.warn('TV category fallback failed:', error);
        return null;
      }
    }
  })().finally(() => {
    inFlightGetRequests.delete(rawUrl);
  });

  inFlightGetRequests.set(rawUrl, request);
  return request;
}

async function postAniList(url, body) {
  const rawUrl = String(url || '').trim();
  if (!rawUrl) return null;
  const payload = JSON.stringify(body || {});
  const cacheKey = `${rawUrl}::${payload}`;
  if (inFlightPostRequests.has(cacheKey)) {
    return inFlightPostRequests.get(cacheKey);
  }

  const request = (async () => {
    const fetchAniList = async (targetUrl) => {
      const usePlainText = /graphql\.anilist\.co/i.test(targetUrl);
      const response = await fetchWithRetry(targetUrl, {
        fetchOptions: {
          method: 'POST',
          headers: usePlainText
            ? { 'Content-Type': 'text/plain;charset=UTF-8' }
            : { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: payload
        }
      });
      return await response.json();
    };

    try {
      return await fetchAniList(rawUrl);
    } catch (error) {
      if (/graphql\.anilist\.co/i.test(rawUrl)) {
        console.warn('AniList fallback failed:', error);
        return null;
      }
      try {
        console.info('[api-fallback] tv category anime using backup provider');
        return await fetchAniList('https://graphql.anilist.co');
      } catch (fallbackError) {
        console.warn('AniList backup failed:', fallbackError);
        return null;
      }
    }
  })().finally(() => {
    inFlightPostRequests.delete(cacheKey);
  });

  inFlightPostRequests.set(cacheKey, request);
  return request;
}

async function mapWithConcurrency(items, maxConcurrency, mapper) {
  const source = Array.isArray(items) ? items : [];
  const results = new Array(source.length);
  if (!source.length) return results;

  let index = 0;
  const workerCount = Math.max(1, Math.min(maxConcurrency, source.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (index < source.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(source[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchTvGenres() {
  if (!tvGenresPromise) {
    tvGenresPromise = fetchJSON('https://storage-api.watchbilm.org/media/tmdb/genre/tv/list?language=en-US')
      .then((data) => Array.isArray(data?.genres) ? data.genres : [])
      .catch(() => []);
  }
  return tvGenresPromise;
}

async function resolveTvGenreBySlug(slug) {
  if (!slug) return null;
  const list = await fetchTvGenres();
  return list.find((item) => toSlug(item?.name) === slug) || null;
}

async function fetchTvCertification(showId) {
  const numericId = Number(showId || 0) || 0;
  if (!numericId) return '';
  if (tvCertificationCache.has(numericId)) return tvCertificationCache.get(numericId);

  const request = (async () => {
    const data = await fetchJSON(`https://storage-api.watchbilm.org/media/tmdb/tv/${numericId}/content_ratings`);
    return pickTvCertification(data?.results);
  })().catch(() => '');

  tvCertificationCache.set(numericId, request);
  const resolved = await request;
  tvCertificationCache.set(numericId, Promise.resolve(resolved));
  return resolved;
}

function matchesTvAge(certification) {
  if (!age) return true;
  return String(certification || '').toUpperCase() === age;
}

async function resolveRegularConfig() {
  const hasAdvancedFilters = yearMin !== '' || yearMax !== '' || ratingMin !== '' || Boolean(age);
  let genreInfo = await resolveTvGenreBySlug(genre);
  if (!genreInfo && !staticMap[section]) {
    genreInfo = await resolveTvGenreBySlug(section);
  }

  if (!hasAdvancedFilters && !genreInfo && staticMap[section]) {
    return {
      endpoint: staticMap[section],
      heading: staticLabelMap[section] || 'TV Shows',
      needsAgePostFilter: false
    };
  }

  const discoverParams = new URLSearchParams();
  discoverParams.set('include_adult', 'false');
  discoverParams.set('sort_by', 'popularity.desc');
  if (genreInfo?.id) discoverParams.set('with_genres', String(genreInfo.id));
  if (yearMin !== '') discoverParams.set('first_air_date.gte', `${yearMin}-01-01`);
  if (yearMax !== '') discoverParams.set('first_air_date.lte', `${yearMax}-12-31`);
  if (ratingMin !== '') {
    discoverParams.set('vote_average.gte', String(ratingMin));
    discoverParams.set('vote_count.gte', '50');
  }

  return {
    endpoint: `/discover/tv?${discoverParams.toString()}`,
    heading: headingParam || genreInfo?.name || 'Filtered',
    needsAgePostFilter: Boolean(age)
  };
}

async function getRegularConfig() {
  if (!regularConfigPromise) {
    regularConfigPromise = resolveRegularConfig();
  }
  return regularConfigPromise;
}

function resolveAnimeGenreLabel() {
  if (genre && animeGenreBySlug.has(genre)) return animeGenreBySlug.get(genre);
  if (section && animeGenreBySlug.has(section)) return animeGenreBySlug.get(section);
  return '';
}

function getHeadingText(base) {
  if (headingParam) return headingParam;
  const normalized = String(base || '').trim();
  if (normalized) return normalized;
  if (mode === 'anime') {
    const genreLabel = resolveAnimeGenreLabel();
    return genreLabel ? `${genreLabel} Anime` : 'Anime';
  }
  return 'TV Shows';
}

function setHeading(base) {
  if (!categoryTitleText) return;
  const heading = getHeadingText(base);
  if (mode === 'anime') {
    categoryTitleText.textContent = heading.includes('TV') ? heading : `${heading} TV`;
  } else {
    categoryTitleText.textContent = heading.includes('TV') ? heading : `${heading} TV Shows`;
  }
}

function matchesAnimeShowFilters(show) {
  const year = Number(show?.startDate?.year || 0) || 0;
  const rating = Number.isFinite(Number(show?.averageScore)) ? Number(show.averageScore) / 10 : null;
  const isAdult = typeof show?.isAdult === 'boolean' ? show.isAdult : null;

  if (yearMin !== '' && (!year || year < yearMin)) return false;
  if (yearMax !== '' && (!year || year > yearMax)) return false;
  if (ratingMin !== '' && (rating == null || rating < ratingMin)) return false;

  if (age === 'adult' && isAdult !== true) return false;
  if (age === 'not_adult' && isAdult !== false) return false;
  if (age === 'unknown' && typeof isAdult === 'boolean') return false;

  return true;
}

function appendShowCard(show, certification = '') {
  const card = window.BilmMediaCard.createMediaCard({
    item: {
      tmdbId: show.id,
      title: show.name,
      type: 'tv',
      year: show.first_air_date?.slice(0, 4) || 'N/A',
      img: show.poster_path ? `https://image.tmdb.org/t/p/w500${show.poster_path}` : 'https://via.placeholder.com/140x210?text=No+Image',
      link: `${BASE_URL}/tv/show.html?id=${show.id}`,
      source: 'TMDB',
      rating: show.vote_average,
      certification
    },
    className: 'movie-card',
    badgeClassName: 'source-badge-overlay',
    metaClassName: 'card-meta',
    titleClassName: 'card-title',
    subtitleClassName: 'card-subtitle'
  });
  categoryGrid.appendChild(card);
}

function appendAnimeShowCard(show) {
  const card = window.BilmMediaCard.createMediaCard({
    item: {
      tmdbId: show.id,
      title: show.title?.english || show.title?.romaji || 'Untitled',
      type: 'tv',
      year: show.startDate?.year || 'N/A',
      img: show.coverImage?.large || show.coverImage?.medium || 'https://via.placeholder.com/140x210?text=No+Image',
      link: `${BASE_URL}/tv/show.html?anime=1&aid=${show.id}&type=tv`,
      source: 'AniList',
      rating: Number.isFinite(Number(show.averageScore)) ? Number(show.averageScore) / 10 : null,
      certification: 'N/A'
    },
    className: 'movie-card',
    badgeClassName: 'source-badge-overlay',
    metaClassName: 'card-meta',
    titleClassName: 'card-title',
    subtitleClassName: 'card-subtitle'
  });
  categoryGrid.appendChild(card);
}

async function appendRegularUniqueResults(unique, itemsToLoad, appendedSoFar, needsAgePostFilter) {
  let appended = appendedSoFar;
  if (!needsAgePostFilter) {
    unique.forEach((show) => {
      if (appended >= itemsToLoad) return;
      seenIds.add(show.id);
      appendShowCard(show);
      appended += 1;
    });
    return appended;
  }

  const checks = await mapWithConcurrency(unique, TV_CERTIFICATION_MAX_CONCURRENCY, async (show) => {
    const certification = await fetchTvCertification(show.id);
    return { show, certification };
  });

  checks.forEach(({ show, certification }) => {
    if (appended >= itemsToLoad) return;
    if (!matchesTvAge(certification)) return;
    seenIds.add(show.id);
    appendShowCard(show, certification);
    appended += 1;
  });
  return appended;
}

async function loadMoreRegular(itemsToLoad = TMDB_PAGE_SIZE) {
  if (loading || ended) return;
  loading = true;
  categoryStatus.textContent = 'Loading more...';

  const { endpoint, needsAgePostFilter } = await getRegularConfig();
  const join = endpoint.includes('?') ? '&' : '?';
  let appended = 0;
  let sourcePagesLoaded = 0;

  while (appended < itemsToLoad && !ended && sourcePagesLoaded < REGULAR_SOURCE_PAGES_PER_BATCH) {
    sourcePagesLoaded += 1;
    const data = await fetchJSON(`https://storage-api.watchbilm.org/media/tmdb${endpoint}${join}page=${page}`);
    const results = data?.results || [];
    if (!results.length) {
      ended = true;
      observer?.disconnect();
      break;
    }

    const unique = results.filter((item) => item.id && !seenIds.has(item.id));
    appended = await appendRegularUniqueResults(unique, itemsToLoad, appended, needsAgePostFilter);
    page += 1;
  }

  if (ended) {
    categoryStatus.textContent = categoryGrid.children.length ? 'No more results.' : 'No results found for these filters.';
  } else {
    categoryStatus.textContent = '';
  }

  loading = false;
}

async function fetchAnimeShowsPage(sourcePage) {
  const animeGenreLabel = resolveAnimeGenreLabel();
  const hasGenre = Boolean(animeGenreLabel);
  const query = `
    query ($page: Int!, $perPage: Int!${hasGenre ? ', $genre: String!' : ''}) {
      Page(page: $page, perPage: $perPage) {
        media(
          type: ANIME,
          format_in: [TV, TV_SHORT]${hasGenre ? ', genre_in: [$genre]' : ''},
          sort: [POPULARITY_DESC, SCORE_DESC]
        ) {
          id
          title {
            romaji
            english
          }
          averageScore
          isAdult
          startDate {
            year
          }
          coverImage {
            large
            medium
          }
        }
      }
    }
  `;
  const variables = hasGenre
    ? { page: sourcePage, perPage: TMDB_PAGE_SIZE, genre: animeGenreLabel }
    : { page: sourcePage, perPage: TMDB_PAGE_SIZE };
  const data = await postAniList('https://storage-api.watchbilm.org/media/anilist', { query, variables });
  return data?.data?.Page?.media || [];
}

async function loadMoreAnime(itemsToLoad = TMDB_PAGE_SIZE) {
  if (loading || ended) return;
  loading = true;
  categoryStatus.textContent = 'Loading more...';

  let appended = 0;
  let sourcePagesLoaded = 0;

  while (appended < itemsToLoad && !ended && sourcePagesLoaded < ANIME_SOURCE_PAGES_PER_BATCH) {
    sourcePagesLoaded += 1;
    const sourceItems = await fetchAnimeShowsPage(animeSourcePage);
    animeSourcePage += 1;
    if (!sourceItems.length) {
      ended = true;
      observer?.disconnect();
      break;
    }

    sourceItems
      .filter((item) => item?.id && !seenIds.has(item.id))
      .filter(matchesAnimeShowFilters)
      .forEach((item) => {
        if (appended >= itemsToLoad) return;
        seenIds.add(item.id);
        appendAnimeShowCard(item);
        appended += 1;
      });
  }

  if (ended) {
    categoryStatus.textContent = categoryGrid.children.length ? 'No more results.' : 'No results found for these filters.';
  } else {
    categoryStatus.textContent = '';
  }

  loading = false;
}

function setupInfiniteScroll(loadMoreFn) {
  if (!categoryStatus) return;
  observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      loadMoreFn(TMDB_PAGE_SIZE);
    }
  }, {
    root: null,
    rootMargin: '0px 0px 600px 0px'
  });
  observer.observe(categoryStatus);
}

async function init() {
  if (mode === 'anime') {
    setHeading(resolveAnimeGenreLabel() || 'Anime');
    setupInfiniteScroll(loadMoreAnime);
    await loadMoreAnime(INITIAL_LOAD_COUNT);
    return;
  }

  const regularConfig = await getRegularConfig();
  setHeading(regularConfig.heading || staticLabelMap[section] || 'TV Shows');
  setupInfiniteScroll(loadMoreRegular);
  await loadMoreRegular(INITIAL_LOAD_COUNT);
}

init();
