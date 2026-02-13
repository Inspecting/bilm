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
const seenIds = new Set();

const staticMap = {
  trending: '/trending/tv/week',
  popular: '/tv/popular',
  'top-rated': '/tv/top_rated',
  'airing-today': '/tv/airing_today'
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
  if (staticMap[section]) return staticMap[section];
  const genresData = await fetchJSON(`https://api.themoviedb.org/3/genre/tv/list?api_key=${TMDB_API_KEY}&language=en-US`);
  const genres = genresData?.genres || [];
  const genre = genres.find((item) => {
    const slug = item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return slug === section;
  });
  return genre ? `/discover/tv?with_genres=${genre.id}` : '/trending/tv/week';
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

  unique.forEach((show) => {
    seenIds.add(show.id);
    const card = window.BilmMediaCard.createMediaCard({
      item: {
        tmdbId: show.id,
        title: show.name,
        type: 'tv',
        year: show.first_air_date?.slice(0, 4) || 'N/A',
        img: show.poster_path ? `https://image.tmdb.org/t/p/w500${show.poster_path}` : 'https://via.placeholder.com/140x210?text=No+Image',
        link: `${BASE_URL}/tv/viewer.html?id=${show.id}`,
        source: 'TMDB'
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
  } else {
    page += 1;
    categoryStatus.textContent = '';
  }
  loading = false;
}

window.addEventListener('scroll', () => {
  if (window.scrollY + window.innerHeight >= document.body.offsetHeight - 500) {
    loadMore();
  }
}, { passive: true });

categoryTitle.textContent = `${heading} TV Shows`;
loadMore();
