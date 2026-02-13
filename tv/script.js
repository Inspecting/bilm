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

  return [...staticSections, ...genreSections].map((section) => ({
    ...section,
    slug: slugifySectionTitle(section.title)
  }));
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
  const sectionEl = document.createElement('section');
  sectionEl.className = 'section';
  sectionEl.id = `section-${section.slug}`;

  const headerEl = document.createElement('div');
  headerEl.className = 'section-header';

  const titleEl = document.createElement('h2');
  titleEl.className = 'section-title';
  titleEl.textContent = section.title;

  const viewMoreLink = document.createElement('a');
  viewMoreLink.className = 'view-more-button';
  viewMoreLink.href = `${BASE_URL}/tv/category.html?section=${encodeURIComponent(section.slug)}&title=${encodeURIComponent(section.title)}`;
  viewMoreLink.textContent = 'View more';
  viewMoreLink.setAttribute('aria-label', `View more ${section.title} TV shows`);

  headerEl.appendChild(titleEl);
  headerEl.appendChild(viewMoreLink);

  const rowEl = document.createElement('div');
  rowEl.className = 'scroll-row';
  rowEl.id = `row-${section.slug}`;

  sectionEl.appendChild(headerEl);
  sectionEl.appendChild(rowEl);
  container.appendChild(sectionEl);
}

function setupFiltersDrawer() {
  const toggle = document.getElementById('filterToggle');
  const drawer = document.getElementById('filtersDrawer');
  const backdrop = document.getElementById('filtersBackdrop');
  const closeBtn = document.getElementById('filtersClose');
  if (!toggle || !drawer || !backdrop || !closeBtn) {
    return { closeDrawer: () => {} };
  }

  const closeDrawer = () => {
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    backdrop.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  };

  const openDrawer = () => {
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    backdrop.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  };

  toggle.addEventListener('click', () => {
    if (drawer.classList.contains('is-open')) closeDrawer();
    else openDrawer();
  });
  closeBtn.addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);

  return { closeDrawer };
}

function renderQuickFilters(sections, closeDrawer) {
function renderQuickFilters(sections) {
  const filtersContainer = document.getElementById('quickFilters');
  if (!filtersContainer) return;

  filtersContainer.innerHTML = '';
  sections.forEach((section) => {
    const item = document.createElement('button');
    item.className = 'filter-item';
    item.type = 'button';
    item.textContent = section.title;
    item.addEventListener('click', () => {
    const chip = document.createElement('a');
    chip.className = 'filter-chip';
    chip.href = `#section-${section.slug}`;
    chip.textContent = section.title;
    chip.addEventListener('click', (event) => {
      event.preventDefault();
      const target = document.getElementById(`section-${section.slug}`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      closeDrawer?.();
    });
    filtersContainer.appendChild(item);
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

  const uniqueShows = shows.filter(s => !loadedShowIds[section.slug].has(s.id));

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
      link: `./viewer.html?id=${show.id}`,
      source: 'TMDB'
    };

    const card = createShowCard(showData);
    rowEl.appendChild(card);
  }

  loadedCounts[section.slug] += showsPerLoad;
  return true;
}

function setupInfiniteScroll(section) {
  const rowEl = document.getElementById(`row-${section.slug}`);
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
  const { closeDrawer } = setupFiltersDrawer();

  renderQuickFilters(sections, closeDrawer);
  renderQuickFilters(sections);
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
