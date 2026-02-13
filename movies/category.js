function detectBasePath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const appRoots = new Set(['home', 'movies', 'tv', 'games', 'search', 'settings', 'random', 'test', 'shared', 'index.html']);
  if (!parts.length || appRoots.has(parts[0])) return '';
  return `/${parts[0]}`;
}

const TMDB_API_KEY = '3ade810499876bb5672f40e54960e6a2';
const BASE_URL = detectBasePath();
const params = new URLSearchParams(window.location.search);
const section = params.get('section') || 'trending';
const heading = params.get('title') || section.replace(/-/g, ' ');

const categoryTitle = document.getElementById('categoryTitle');
const categoryGrid = document.getElementById('categoryGrid');
const categoryStatus = document.getElementById('categoryStatus');

let page = 1;
let loading = false;
let ended = false;
let resolvedEndpoint = null;
const seenIds = new Set();

const staticMap = {
  trending: '/trending/movie/week',
  popular: '/movie/popular',
  'top-rated': '/movie/top_rated',
  'now-playing': '/movie/now_playing'
};

async function fetchJSON(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Request failed');
    return await response.json();
  } catch {
    return null;
  }
}

async function resolveEndpoint() {
  if (resolvedEndpoint) return resolvedEndpoint;
  if (staticMap[section]) {
    resolvedEndpoint = staticMap[section];
    return resolvedEndpoint;
  }

  const genresData = await fetchJSON(`https://api.themoviedb.org/3/genre/movie/list?api_key=${TMDB_API_KEY}&language=en-US`);
  const genres = genresData?.genres || [];
  const genre = genres.find((item) => {
    const slug = item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return slug === section;
  });

  resolvedEndpoint = genre ? `/discover/movie?with_genres=${genre.id}` : '/trending/movie/week';
  return resolvedEndpoint;
}

async function loadMore() {
  if (loading || ended) return;

  loading = true;
  categoryStatus.textContent = 'Loading more...';

  const endpoint = await resolveEndpoint();
  const join = endpoint.includes('?') ? '&' : '?';
  const data = await fetchJSON(`https://api.themoviedb.org/3${endpoint}${join}api_key=${TMDB_API_KEY}&page=${page}`);
  const results = data?.results || [];
  const unique = results.filter((item) => item.id && !seenIds.has(item.id));

  unique.forEach((movie) => {
    seenIds.add(movie.id);
    const card = window.BilmMediaCard.createMediaCard({
      item: {
        tmdbId: movie.id,
        title: movie.title,
        type: 'movie',
        year: movie.release_date?.slice(0, 4) || 'N/A',
        img: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : 'https://via.placeholder.com/140x210?text=No+Image',
        link: `${BASE_URL}/movies/viewer.html?id=${movie.id}`,
        source: 'TMDB'
      },
      className: 'movie-card',
      badgeClassName: 'source-badge-overlay'
    });
    categoryGrid.appendChild(card);
  });

  if (!results.length) {
    ended = true;
    categoryStatus.textContent = 'No more results.';
  } else {
    page += 1;
    categoryStatus.textContent = '';
  }

  loading = false;
}

async function ensureScrollablePage() {
  while (!ended && document.documentElement.scrollHeight <= window.innerHeight + 120) {
    await loadMore();
  }
}

function setupInfiniteScroll() {
  const sentinel = document.createElement('div');
  sentinel.id = 'categoryScrollSentinel';
  sentinel.setAttribute('aria-hidden', 'true');
  categoryStatus.insertAdjacentElement('beforebegin', sentinel);

  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      loadMore();
    }
  }, { rootMargin: '600px 0px' });

  observer.observe(sentinel);
}

categoryTitle.textContent = `${heading} Movies`;
setupInfiniteScroll();
loadMore().then(ensureScrollablePage);
