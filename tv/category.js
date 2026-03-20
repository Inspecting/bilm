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

const BASE_URL = detectBasePath();
const params = new URLSearchParams(window.location.search);
const section = params.get('section') || 'trending';
const heading = params.get('title') || section.replace(/-/g, ' ');

function getApiOrigin() {
  return String(window.location.hostname || '').toLowerCase() === 'cdn.jsdelivr.net'
    ? 'https://watchbilm.org'
    : window.location.origin;
}

const categoryTitle = document.getElementById('categoryTitle');
const categoryGrid = document.getElementById('categoryGrid');
const categoryStatus = document.getElementById('categoryStatus');

let page = 1;
let loading = false;
let ended = false;
const seenIds = new Set();
let observer;
const TMDB_PAGE_SIZE = 20;
const INITIAL_LOAD_COUNT = 40;

const staticMap = {
  trending: '/trending/tv/week',
  popular: '/tv/popular',
  'top-rated': '/tv/top_rated',
  'airing-today': '/tv/airing_today'
};

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
      console.info('[api-fallback] tv category using backup provider', {
        primaryUrl: rawUrl,
        backupUrl
      });
      const backupResponse = await fetch(backupUrl);
      if (!backupResponse.ok) throw new Error('Backup request failed');
      return await backupResponse.json();
    } catch {
      console.warn('TV category fallback failed:', error);
      return null;
    }
  }
}

async function resolveEndpoint() {
  if (staticMap[section]) return staticMap[section];
  const genresData = await fetchJSON(`https://storage-api.watchbilm.org/media/tmdb/genre/tv/list?language=en-US`);
  const genres = genresData?.genres || [];
  const genre = genres.find((item) => {
    const slug = item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return slug === section;
  });
  return genre ? `/discover/tv?with_genres=${genre.id}` : '/trending/tv/week';
}

async function loadMore(itemsToLoad = TMDB_PAGE_SIZE) {
  if (loading || ended) return;
  loading = true;
  categoryStatus.textContent = 'Loading more...';

  const endpoint = await resolveEndpoint();
  const join = endpoint.includes('?') ? '&' : '?';
  const pagesToLoad = Math.max(1, Math.ceil(itemsToLoad / TMDB_PAGE_SIZE));

  for (let index = 0; index < pagesToLoad; index += 1) {
    if (ended) break;

    const data = await fetchJSON(`https://storage-api.watchbilm.org/media/tmdb${endpoint}${join}page=${page}`);
    const results = data?.results || [];
    const unique = results.filter((item) => item.id && !seenIds.has(item.id));

    unique.forEach((show) => {
      seenIds.add(show.id);
      const card = window.BilmMediaCard.createMediaCard({
        item: {
          tmdbId: show.id,
          title: show.name,
          type: 'tv',
          year: show.first_air_date?.slice(0, 4) || 'N/A',
          img: show.poster_path ? `https://image.tmdb.org/t/p/w500${show.poster_path}` : 'https://via.placeholder.com/140x210?text=No+Image',
          link: `${BASE_URL}/tv/show.html?id=${show.id}`,
          source: 'TMDB',
          rating: show.vote_average
        },
        className: 'movie-card',
        badgeClassName: 'source-badge-overlay',
        metaClassName: 'card-meta',
        titleClassName: 'card-title',
        subtitleClassName: 'card-subtitle'
      });
      categoryGrid.appendChild(card);
    });

    if (!results.length) {
      ended = true;
      categoryStatus.textContent = 'No more results.';
      observer?.disconnect();
    }

    page += 1;
  }

  if (!ended) {
    categoryStatus.textContent = '';
  }

  loading = false;
}

function setupInfiniteScroll() {
  if (!categoryStatus) return;
  observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      loadMore(TMDB_PAGE_SIZE);
    }
  }, {
    root: null,
    rootMargin: '0px 0px 600px 0px'
  });
  observer.observe(categoryStatus);
}

categoryTitle.textContent = `${heading} TV Shows`;
setupInfiniteScroll();
loadMore(INITIAL_LOAD_COUNT);
