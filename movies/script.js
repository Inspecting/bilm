const TMDB_API_KEY = '3ade810499876bb5672f40e54960e6a2';
const BASE_URL = 'https://inspecting.github.io/bilm';
const moviesPerLoad = 15;
const PRIORITY_SECTION_COUNT = 4;

let allGenres = [];
const loadedCounts = {};
const loadedMovieIds = {};

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
  const url = `https://api.themoviedb.org/3/genre/movie/list?api_key=${TMDB_API_KEY}&language=en-US`;
  const data = await fetchJSON(url);
  allGenres = data?.genres || [];
  return allGenres;
}

function getSections() {
  const staticSections = [
    { title: 'Trending', endpoint: '/trending/movie/week' },
    { title: 'Popular', endpoint: '/movie/popular' },
    { title: 'Top Rated', endpoint: '/movie/top_rated' },
    { title: 'Now Playing', endpoint: '/movie/now_playing' }
  ];

  const genreSections = allGenres.map(genre => ({
    title: genre.name,
    endpoint: `/discover/movie?with_genres=${genre.id}`
  }));

  return [...staticSections, ...genreSections];
}

async function fetchMovies(endpoint, page = 1) {
  const url = endpoint.includes('?')
    ? `https://api.themoviedb.org/3${endpoint}&api_key=${TMDB_API_KEY}&page=${page}`
    : `https://api.themoviedb.org/3${endpoint}?api_key=${TMDB_API_KEY}&page=${page}`;
  const data = await fetchJSON(url);
  return data?.results || [];
}

function createMovieCard(movie) {
  const card = document.createElement('div');
  card.className = 'movie-card';
  card.dataset.tmdbId = movie.tmdbId;

  const sourceBadge = document.createElement('span');
  sourceBadge.className = 'source-badge-overlay';
  sourceBadge.textContent = String(movie.source || 'Other').toUpperCase();

  const img = document.createElement('img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.src = movie.img || 'https://via.placeholder.com/140x210?text=No+Image';
  img.alt = movie.title;
  img.onerror = () => {
    img.onerror = null;
    img.src = 'https://via.placeholder.com/140x210?text=No+Image';
  };

  const cardMeta = document.createElement('div');
  cardMeta.className = 'card-meta';

  const title = document.createElement('p');
  title.className = 'card-title';
  title.textContent = movie.title;

  const subtitle = document.createElement('p');
  subtitle.className = 'card-subtitle';
  subtitle.textContent = `${movie.year || 'N/A'}`;

  cardMeta.appendChild(title);
  cardMeta.appendChild(subtitle);

  card.appendChild(img);
  card.appendChild(sourceBadge);
  card.appendChild(cardMeta);

  card.onclick = () => {
    window.location.href = movie.link || '#';
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

async function loadMoviesForSection(section) {
  loadedCounts[section.title] ??= 0;
  loadedMovieIds[section.title] ??= new Set();

  const page = Math.floor(loadedCounts[section.title] / moviesPerLoad) + 1;
  const movies = await fetchMovies(section.endpoint, page);
  if (!movies.length) return false;

  const rowEl = document.getElementById(`row-${section.title.replace(/\s/g, '')}`);

  // Filter to unique movies
  const uniqueMovies = movies.filter(m => !loadedMovieIds[section.title].has(m.id));

  for (const movie of uniqueMovies.slice(0, moviesPerLoad)) {
    loadedMovieIds[section.title].add(movie.id);

    const poster = movie.poster_path
      ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
      : 'https://via.placeholder.com/140x210?text=No+Image';

    const movieData = {
      tmdbId: movie.id,
      title: movie.title,
      year: movie.release_date?.slice(0, 4) || 'N/A',
      img: poster,
      link: `${BASE_URL}/movies/viewer.html?id=${movie.id}`,
      source: 'TMDB'
    };

    const card = createMovieCard(movieData);
    rowEl.appendChild(card);
  }

  loadedCounts[section.title] += moviesPerLoad;
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
      await loadMoviesForSection(section);
      loading = false;
    }
  }, { passive: true });
}

document.addEventListener('DOMContentLoaded', async () => {
  const container = document.getElementById('movieSections');
  if (!container) {
    console.error('Missing container with id "movieSections" in HTML');
    return;
  }

  await fetchGenres();

  const sections = getSections();

  // Create section skeletons immediately for stable layout
  sections.forEach(section => createSectionSkeleton(section, container));

  // Prioritize above-the-fold sections first for faster perceived load
  const prioritySections = sections.slice(0, PRIORITY_SECTION_COUNT);
  const deferredSections = sections.slice(PRIORITY_SECTION_COUNT);
  await Promise.all(prioritySections.map(section => loadMoviesForSection(section)));

  const loadDeferredSections = async () => {
    await Promise.all(deferredSections.map(section => loadMoviesForSection(section)));
  };

  if ('requestIdleCallback' in window) {
    requestIdleCallback(loadDeferredSections, { timeout: 1200 });
  } else {
    setTimeout(loadDeferredSections, 0);
  }

  sections.forEach(section => setupInfiniteScroll(section));
});
