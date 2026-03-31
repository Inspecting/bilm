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

const MOVIE_AGE_VALUES = new Set(['G', 'PG', 'PG-13', 'R', 'NC-17']);
const ANIME_AGE_VALUES = new Set(['adult', 'not_adult', 'unknown']);
const age = (() => {
  const value = String(params.get('age') || '').trim();
  if (!value) return '';
  if (mode === 'anime') {
    return ANIME_AGE_VALUES.has(value) ? value : '';
  }
  const upper = value.toUpperCase();
  return MOVIE_AGE_VALUES.has(upper) ? upper : '';
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

const staticMap = {
  trending: '/trending/movie/week',
  popular: '/movie/popular',
  'top-rated': '/movie/top_rated',
  'now-playing': '/movie/now_playing'
};
const staticLabelMap = {
  trending: 'Trending',
  popular: 'Popular',
  'top-rated': 'Top Rated',
  'now-playing': 'Now Playing'
};
const ANIME_MOVIE_GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Romance', 'Sci-Fi'];
const animeGenreBySlug = new Map(ANIME_MOVIE_GENRES.map((label) => [toSlug(label), label]));

let regularConfigPromise = null;
let movieGenresPromise = null;

async function fetchJSON(url) {
  const rawUrl = String(url || '').trim();
  const backupUrl = (() => {
    try {
      const parsed = new URL(rawUrl, window.location.href);
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
  })();

  try {
    const response = await fetch(rawUrl);
    if (!response.ok) throw new Error('Request failed');
    return await response.json();
  } catch (error) {
    if (!backupUrl) return null;
    try {
      console.info('[api-fallback] movies category using backup provider', {
        primaryUrl: rawUrl,
        backupUrl
      });
      const backupResponse = await fetch(backupUrl);
      if (!backupResponse.ok) throw new Error('Backup request failed');
      return await backupResponse.json();
    } catch {
      console.warn('Movies category fallback failed:', error);
      return null;
    }
  }
}

async function postAniList(url, body) {
  const payload = JSON.stringify(body || {});
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: /graphql\.anilist\.co/i.test(url)
        ? { 'Content-Type': 'text/plain;charset=UTF-8' }
        : { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: payload
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (/graphql\.anilist\.co/i.test(url)) {
      console.warn('AniList fallback failed:', error);
      return null;
    }
    try {
      console.info('[api-fallback] movies category anime using backup provider');
      const response = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: payload
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (fallbackError) {
      console.warn('AniList backup failed:', fallbackError);
      return null;
    }
  }
}

async function fetchMovieGenres() {
  if (!movieGenresPromise) {
    movieGenresPromise = fetchJSON('https://storage-api.watchbilm.org/media/tmdb/genre/movie/list?language=en-US')
      .then((data) => Array.isArray(data?.genres) ? data.genres : [])
      .catch(() => []);
  }
  return movieGenresPromise;
}

async function resolveMovieGenreBySlug(slug) {
  if (!slug) return null;
  const list = await fetchMovieGenres();
  return list.find((item) => toSlug(item?.name) === slug) || null;
}

async function resolveRegularConfig() {
  const hasAdvancedFilters = yearMin !== '' || yearMax !== '' || ratingMin !== '' || Boolean(age);
  let genreInfo = await resolveMovieGenreBySlug(genre);
  if (!genreInfo && !staticMap[section]) {
    genreInfo = await resolveMovieGenreBySlug(section);
  }

  if (!hasAdvancedFilters && !genreInfo && staticMap[section]) {
    return {
      endpoint: staticMap[section],
      heading: staticLabelMap[section] || 'Movies'
    };
  }

  const discoverParams = new URLSearchParams();
  discoverParams.set('include_adult', 'false');
  discoverParams.set('sort_by', 'popularity.desc');
  if (genreInfo?.id) discoverParams.set('with_genres', String(genreInfo.id));
  if (yearMin !== '') discoverParams.set('primary_release_date.gte', `${yearMin}-01-01`);
  if (yearMax !== '') discoverParams.set('primary_release_date.lte', `${yearMax}-12-31`);
  if (ratingMin !== '') {
    discoverParams.set('vote_average.gte', String(ratingMin));
    discoverParams.set('vote_count.gte', '50');
  }
  if (age) {
    discoverParams.set('certification_country', 'US');
    discoverParams.set('certification', age);
  }

  return {
    endpoint: `/discover/movie?${discoverParams.toString()}`,
    heading: headingParam || genreInfo?.name || 'Filtered'
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
  return 'Movies';
}

function setHeading(base) {
  if (!categoryTitleText) return;
  const heading = getHeadingText(base);
  if (mode === 'anime') {
    categoryTitleText.textContent = heading.includes('Movie') ? heading : `${heading} Movies`;
  } else {
    categoryTitleText.textContent = heading.includes('Movie') ? heading : `${heading} Movies`;
  }
}

function matchesAnimeMovieFilters(movie) {
  const year = Number(movie?.startDate?.year || 0) || 0;
  const rating = Number.isFinite(Number(movie?.averageScore)) ? Number(movie.averageScore) / 10 : null;
  const isAdult = typeof movie?.isAdult === 'boolean' ? movie.isAdult : null;

  if (yearMin !== '' && (!year || year < yearMin)) return false;
  if (yearMax !== '' && (!year || year > yearMax)) return false;
  if (ratingMin !== '' && (rating == null || rating < ratingMin)) return false;

  if (age === 'adult' && isAdult !== true) return false;
  if (age === 'not_adult' && isAdult !== false) return false;
  if (age === 'unknown' && typeof isAdult === 'boolean') return false;

  return true;
}

function appendMovieCard(movie) {
  const card = window.BilmMediaCard.createMediaCard({
    item: {
      tmdbId: movie.id,
      title: movie.title,
      type: 'movie',
      year: movie.release_date?.slice(0, 4) || 'N/A',
      img: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : 'https://via.placeholder.com/140x210?text=No+Image',
      link: `${BASE_URL}/movies/show.html?id=${movie.id}`,
      source: 'TMDB',
      rating: movie.vote_average
    },
    className: 'movie-card',
    badgeClassName: 'source-badge-overlay',
    metaClassName: 'card-meta',
    titleClassName: 'card-title',
    subtitleClassName: 'card-subtitle'
  });
  categoryGrid.appendChild(card);
}

function appendAnimeMovieCard(movie) {
  const card = window.BilmMediaCard.createMediaCard({
    item: {
      tmdbId: movie.id,
      title: movie.title?.english || movie.title?.romaji || 'Untitled',
      type: 'movie',
      year: movie.startDate?.year || 'N/A',
      img: movie.coverImage?.large || movie.coverImage?.medium || 'https://via.placeholder.com/140x210?text=No+Image',
      link: `${BASE_URL}/movies/show.html?anime=1&aid=${movie.id}&type=movie`,
      source: 'AniList',
      rating: Number.isFinite(Number(movie.averageScore)) ? Number(movie.averageScore) / 10 : null,
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

async function loadMoreRegular(itemsToLoad = TMDB_PAGE_SIZE) {
  if (loading || ended) return;
  loading = true;
  categoryStatus.textContent = 'Loading more...';

  const { endpoint } = await getRegularConfig();
  const join = endpoint.includes('?') ? '&' : '?';
  let appended = 0;
  let safety = 0;

  while (appended < itemsToLoad && !ended && safety < 10) {
    safety += 1;
    const data = await fetchJSON(`https://storage-api.watchbilm.org/media/tmdb${endpoint}${join}page=${page}`);
    const results = data?.results || [];
    if (!results.length) {
      ended = true;
      observer?.disconnect();
      break;
    }

    const unique = results.filter((item) => item.id && !seenIds.has(item.id));
    unique.forEach((movie) => {
      if (appended >= itemsToLoad) return;
      seenIds.add(movie.id);
      appendMovieCard(movie);
      appended += 1;
    });
    page += 1;
  }

  if (ended) {
    categoryStatus.textContent = categoryGrid.children.length ? 'No more results.' : 'No results found for these filters.';
  } else {
    categoryStatus.textContent = '';
  }

  loading = false;
}

async function fetchAnimeMoviesPage(sourcePage) {
  const animeGenreLabel = resolveAnimeGenreLabel();
  const hasGenre = Boolean(animeGenreLabel);
  const query = `
    query ($page: Int!, $perPage: Int!${hasGenre ? ', $genre: String!' : ''}) {
      Page(page: $page, perPage: $perPage) {
        media(
          type: ANIME,
          format: MOVIE${hasGenre ? ', genre_in: [$genre]' : ''},
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
    const sourceItems = await fetchAnimeMoviesPage(animeSourcePage);
    animeSourcePage += 1;
    if (!sourceItems.length) {
      ended = true;
      observer?.disconnect();
      break;
    }

    sourceItems
      .filter((item) => item?.id && !seenIds.has(item.id))
      .filter(matchesAnimeMovieFilters)
      .forEach((item) => {
        if (appended >= itemsToLoad) return;
        seenIds.add(item.id);
        appendAnimeMovieCard(item);
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
  setHeading(regularConfig.heading || staticLabelMap[section] || 'Movies');
  setupInfiniteScroll(loadMoreRegular);
  await loadMoreRegular(INITIAL_LOAD_COUNT);
}

init();
