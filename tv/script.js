function detectBasePath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const appRoots = new Set(['home', 'movies', 'tv', 'games', 'search', 'settings', 'random', 'test', 'shared', 'index.html']);
  if (!parts.length || appRoots.has(parts[0])) return '';
  return `/${parts[0]}`;
}

const TMDB_API_KEY = '3ade810499876bb5672f40e54960e6a2';
const ANILIST_GRAPHQL_URL = 'https://graphql.anilist.co';
const BASE_URL = detectBasePath();
const showsPerLoad = 15;
const PRIORITY_SECTION_COUNT = 4;
const animeShowsPerLoad = 15;
const ANIME_TV_GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Mystery', 'Romance', 'Sci-Fi'];

let allGenres = [];
const loadedCounts = {};
const loadedShowIds = {};
const animeLoadedCounts = {};
const animeLoadedIds = {};

const modeState = { current: 'regular' };

function setContentMode(mode) {
  const normalizedMode = mode === 'anime' ? 'anime' : 'regular';
  modeState.current = normalizedMode;

  const regularButton = document.getElementById('regularModeButton');
  const animeButton = document.getElementById('animeModeButton');
  const quickFilters = document.getElementById('quickFilters');
  const tvSections = document.getElementById('tvSections');
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
  if (tvSections) tvSections.classList.toggle('is-hidden', isAnime);
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

async function fetchJSON(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
    return null;
  }
}

async function postJSON(url, body) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    });
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

  const genreSections = allGenres.map((genre) => ({
    title: genre.name,
    endpoint: `/discover/tv?with_genres=${genre.id}`
  }));

  return [...staticSections, ...genreSections].map((section) => ({
    ...section,
    slug: slugifySectionTitle(section.title)
  }));
}

function getAnimeTvSections() {
  return ANIME_TV_GENRES.map((genre) => ({
    title: genre,
    genre,
    slug: `anime-${slugifySectionTitle(genre)}`
  }));
}

async function fetchShows(endpoint, page = 1) {
  const url = endpoint.includes('?')
    ? `https://api.themoviedb.org/3${endpoint}&api_key=${TMDB_API_KEY}&page=${page}`
    : `https://api.themoviedb.org/3${endpoint}?api_key=${TMDB_API_KEY}&page=${page}`;
  const data = await fetchJSON(url);
  return data?.results || [];
}

async function fetchAnimeShowsByGenre(genre, page = 1) {
  const query = `
    query ($page: Int!, $perPage: Int!, $genre: String!) {
      Page(page: $page, perPage: $perPage) {
        media(type: ANIME, format_in: [TV, TV_SHORT], genre_in: [$genre], sort: [POPULARITY_DESC, SCORE_DESC]) {
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

  const data = await postJSON(ANILIST_GRAPHQL_URL, {
    query,
    variables: { page, perPage: animeShowsPerLoad, genre }
  });

  return data?.data?.Page?.media || [];
}

function createShowCard(show) {
  return window.BilmMediaCard.createMediaCard({
    item: show,
    className: 'movie-card',
    badgeClassName: 'source-badge-overlay',
    dataset: { tmdbId: show.tmdbId }
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
    viewMoreLink.href = `${BASE_URL}/tv/category.html?section=${encodeURIComponent(section.slug)}&title=${encodeURIComponent(section.title)}`;
    viewMoreLink.textContent = 'View more';
    viewMoreLink.setAttribute('aria-label', `View more ${section.title} TV shows`);
    headerEl.appendChild(viewMoreLink);
  }

  const rowEl = document.createElement('div');
  rowEl.className = 'scroll-row';
  rowEl.id = `${prefix}row-${section.slug}`;

  sectionEl.appendChild(headerEl);
  sectionEl.appendChild(rowEl);
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

async function loadShowsForSection(section) {
  loadedCounts[section.slug] ??= 0;
  loadedShowIds[section.slug] ??= new Set();

  const page = Math.floor(loadedCounts[section.slug] / showsPerLoad) + 1;
  const shows = await fetchShows(section.endpoint, page);
  if (!shows.length) return false;

  const rowEl = document.getElementById(`row-${section.slug}`);

  const uniqueShows = shows.filter((s) => !loadedShowIds[section.slug].has(s.id));

  for (const show of uniqueShows.slice(0, showsPerLoad)) {
    loadedShowIds[section.slug].add(show.id);

    const poster = show.poster_path
      ? `https://image.tmdb.org/t/p/w500${show.poster_path}`
      : 'https://via.placeholder.com/140x210?text=No+Image';

    const showData = {
      tmdbId: show.id,
      title: show.name,
      type: 'tv',
      year: show.first_air_date?.slice(0, 4) || 'N/A',
      img: poster,
      link: `./show.html?id=${show.id}`,
      source: 'TMDB',
      rating: show.vote_average
    };

    const card = createShowCard(showData);
    rowEl.appendChild(card);
  }

  loadedCounts[section.slug] += showsPerLoad;
  return true;
}

async function loadAnimeShowsForSection(section) {
  animeLoadedCounts[section.slug] ??= 0;
  animeLoadedIds[section.slug] ??= new Set();

  const page = Math.floor(animeLoadedCounts[section.slug] / animeShowsPerLoad) + 1;
  const animeShows = await fetchAnimeShowsByGenre(section.genre, page);
  if (!animeShows.length) return false;

  const rowEl = document.getElementById(`anime-row-${section.slug}`);

  const uniqueShows = animeShows.filter((show) => !animeLoadedIds[section.slug].has(show.id));

  for (const animeShow of uniqueShows.slice(0, animeShowsPerLoad)) {
    animeLoadedIds[section.slug].add(animeShow.id);

    const showData = {
      tmdbId: animeShow.id,
      title: animeShow.title?.english || animeShow.title?.romaji || 'Untitled',
      type: 'tv',
      year: animeShow.startDate?.year || 'N/A',
      img: animeShow.coverImage?.large || animeShow.coverImage?.medium,
      link: `https://anilist.co/anime/${animeShow.id}`,
      source: 'AniList'
    };

    const card = createShowCard(showData);
    rowEl.appendChild(card);
  }

  animeLoadedCounts[section.slug] += animeShowsPerLoad;
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
  const container = document.getElementById('tvSections');
  const animeContainer = document.getElementById('animeSections');
  if (!container || !animeContainer) {
    console.error('Missing TV section container(s) in HTML');
    return;
  }

  bindModeToggleButtons();
  setContentMode('regular');

  await fetchGenres();
  const sections = getSections();
  const animeSections = getAnimeTvSections();

  renderQuickFilters(sections, 'quickFilters');
  sections.forEach((section) => createSectionSkeleton(section, container));

  renderQuickFilters(animeSections, 'animeQuickFilters', 'anime-');
  animeSections.forEach((section) => createSectionSkeleton(section, animeContainer, 'anime-'));

  const prioritySections = sections.slice(0, PRIORITY_SECTION_COUNT);
  const deferredSections = sections.slice(PRIORITY_SECTION_COUNT);
  await Promise.all(prioritySections.map((section) => loadShowsForSection(section)));

  const priorityAnimeSections = animeSections.slice(0, PRIORITY_SECTION_COUNT);
  const deferredAnimeSections = animeSections.slice(PRIORITY_SECTION_COUNT);
  await Promise.all(priorityAnimeSections.map((section) => loadAnimeShowsForSection(section)));

  const loadDeferredSections = async () => {
    await Promise.all(deferredSections.map((section) => loadShowsForSection(section)));
    await Promise.all(deferredAnimeSections.map((section) => loadAnimeShowsForSection(section)));
  };

  if ('requestIdleCallback' in window) {
    requestIdleCallback(loadDeferredSections, { timeout: 1200 });
  } else {
    setTimeout(loadDeferredSections, 0);
  }

  sections.forEach((section) => setupInfiniteScroll(section, loadShowsForSection));
  animeSections.forEach((section) => setupInfiniteScroll(section, loadAnimeShowsForSection, 'anime-'));
});
