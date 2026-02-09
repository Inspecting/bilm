const TMDB_API_KEY = '3ade810499876bb5672f40e54960e6a2';
const BASE_URL = 'https://inspecting.github.io/bilm';
const DEFAULT_PER_LOAD = 15;
const DEFAULT_PRIORITY_COUNT = 4;

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
  const card = document.createElement('div');
  card.className = 'movie-card';
  card.dataset.tmdbId = show.tmdbId;

  const img = document.createElement('img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.src = show.img || 'https://via.placeholder.com/140x210?text=No+Image';
  img.alt = show.title;
  img.onerror = () => {
    img.onerror = null;
    img.src = 'https://via.placeholder.com/140x210?text=No+Image';
  };

  const p = document.createElement('p');
  p.textContent = `${show.title} (${show.year || 'N/A'})`;

  card.appendChild(img);
  card.appendChild(p);

  card.onclick = () => {
    window.location.href = show.link || '#';
  };

  return card;
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

function getThemeSettings() {
  return window.bilmTheme?.getSettings?.() || {};
}

function getLoadConfig(settings) {
  const dataSaver = settings.dataSaver === true;
  const imageQuality = settings.imageQuality || 'high';
  return {
    perLoad: dataSaver ? 8 : DEFAULT_PER_LOAD,
    priorityCount: dataSaver ? 2 : DEFAULT_PRIORITY_COUNT,
    imageSize: imageQuality === 'low' ? 'w342' : 'w500'
  };
}

function createNavButton(section, container) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = section.title;
  button.addEventListener('click', () => {
    const target = document.getElementById(`section-${section.title.replace(/\s/g, '')}`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  container.appendChild(button);
}

async function loadShowsForSection(section, config) {
  loadedCounts[section.title] ??= 0;
  loadedShowIds[section.title] ??= new Set();

  const page = Math.floor(loadedCounts[section.title] / config.perLoad) + 1;
  const shows = await fetchShows(section.endpoint, page);
  if (!shows.length) return false;

  const rowEl = document.getElementById(`row-${section.title.replace(/\s/g, '')}`);

  const uniqueShows = shows.filter(s => !loadedShowIds[section.title].has(s.id));

  for (const show of uniqueShows.slice(0, config.perLoad)) {
    loadedShowIds[section.title].add(show.id);

    const poster = show.poster_path
      ? `https://image.tmdb.org/t/p/${config.imageSize}${show.poster_path}`
      : 'https://via.placeholder.com/140x210?text=No+Image';

    const showData = {
      tmdbId: show.id,
      title: show.name,
      year: show.first_air_date?.slice(0, 4) || 'N/A',
      img: poster,
      link: `${BASE_URL}/tv/viewer.html?id=${show.id}`
    };

    const card = createShowCard(showData);
    rowEl.appendChild(card);
  }

  loadedCounts[section.title] += config.perLoad;
  return true;
}

function setupInfiniteScroll(section, config) {
  const rowEl = document.getElementById(`row-${section.title.replace(/\s/g, '')}`);
  if (!rowEl) return;

  let loading = false;
  rowEl.addEventListener('scroll', async () => {
    if (loading) return;
    if (rowEl.scrollLeft + rowEl.clientWidth >= rowEl.scrollWidth - 300) {
      loading = true;
      await loadShowsForSection(section, config);
      loading = false;
    }
  }, { passive: true });
}

document.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('tvSections');
  const statusEl = document.getElementById('tvStatus');
  const navEl = document.getElementById('tvNav');
  if (!container) {
    console.error('Missing container with id "tvSections" in HTML');
    return;
  }

  const settings = getThemeSettings();
  const config = getLoadConfig(settings);

  await fetchGenres();

  const sections = getSections();

  sections.forEach(section => createSectionSkeleton(section, container));
  if (navEl) {
    navEl.innerHTML = '';
    sections.slice(0, 10).forEach(section => createNavButton(section, navEl));
  }

  const prioritySections = sections.slice(0, config.priorityCount);
  const deferredSections = sections.slice(config.priorityCount);
  await Promise.all(prioritySections.map(section => loadShowsForSection(section, config)));
  if (statusEl) {
    statusEl.textContent = `Loaded ${prioritySections.length} sections`;
  }

  const loadDeferredSections = async () => {
    await Promise.all(deferredSections.map(section => loadShowsForSection(section, config)));
    if (statusEl) {
      statusEl.textContent = `Loaded ${sections.length} sections`;
    }
  };

  if ('requestIdleCallback' in window) {
    requestIdleCallback(loadDeferredSections, { timeout: 1200 });
  } else {
    setTimeout(loadDeferredSections, 0);
  }

  sections.forEach(section => setupInfiniteScroll(section, config));
});
