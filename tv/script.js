function detectBasePath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const appRoots = new Set(['home', 'movies', 'tv', 'games', 'search', 'settings', 'random', 'test', 'shared', 'index.html']);
  if (!parts.length || appRoots.has(parts[0])) return '';
  return `/${parts[0]}`;
}

const TMDB_API_KEY = '3ade810499876bb5672f40e54960e6a2';
const BASE_URL = detectBasePath();
const showsPerLoad = 15;
const PRIORITY_SECTION_COUNT = 4;

let allGenres = [];
const loadedCounts = {};
const loadedShowIds = {};

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

function getSections() {
  const staticSections = [
    { title: 'Trending', endpoint: '/trending/tv/week' },
    { title: 'Popular', endpoint: '/tv/popular' },
    { title: 'Top Rated', endpoint: '/tv/top_rated' },
    { title: 'Airing Today', endpoint: '/tv/airing_today' }
  ];

  const genreSections = allGenres.map(genre => ({
    title: genre.name,
    endpoint: `/discover/tv?with_genres=${genre.id}`
  }));

  return [...staticSections, ...genreSections];
}

async function fetchShows(endpoint, page = 1) {
  const url = endpoint.includes('?')
    ? `https://api.themoviedb.org/3${endpoint}&api_key=${TMDB_API_KEY}&page=${page}`
    : `https://api.themoviedb.org/3${endpoint}?api_key=${TMDB_API_KEY}&page=${page}`;
  const data = await fetchJSON(url);
  return data?.results || [];
}

function createShowCard(show) {
  return window.BilmMediaCard.createMediaCard({
    item: show,
    className: 'movie-card',
    badgeClassName: 'source-badge-overlay',
    dataset: { tmdbId: show.tmdbId }
  });
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

async function loadShowsForSection(section) {
  loadedCounts[section.title] ??= 0;
  loadedShowIds[section.title] ??= new Set();

  const page = Math.floor(loadedCounts[section.title] / showsPerLoad) + 1;
  const shows = await fetchShows(section.endpoint, page);
  if (!shows.length) return false;

  const rowEl = document.getElementById(`row-${section.title.replace(/\s/g, '')}`);

  const uniqueShows = shows.filter(s => !loadedShowIds[section.title].has(s.id));

  for (const show of uniqueShows.slice(0, showsPerLoad)) {
    loadedShowIds[section.title].add(show.id);

    const poster = show.poster_path
      ? `https://image.tmdb.org/t/p/w500${show.poster_path}`
      : 'https://via.placeholder.com/140x210?text=No+Image';

    const showData = {
      tmdbId: show.id,
      title: show.name,
      type: 'tv',
      year: show.first_air_date?.slice(0, 4) || 'N/A',
      img: poster,
      link: `./viewer.html?id=${show.id}`,
      source: 'TMDB'
    };

    const card = createShowCard(showData);
    rowEl.appendChild(card);
  }

  loadedCounts[section.title] += showsPerLoad;
  return true;
}

function setupInfiniteScroll(section) {
  const rowEl = document.getElementById(`row-${section.title.replace(/\s/g, '')}`);
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

document.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('tvSections');
  if (!container) {
    console.error('Missing container with id "tvSections" in HTML');
    return;
  }

  await fetchGenres();

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
});
