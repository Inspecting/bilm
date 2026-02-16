function detectBasePath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const appRoots = new Set(['home', 'movies', 'tv', 'games', 'search', 'settings', 'random', 'test', 'shared', 'index.html']);
  if (!parts.length || appRoots.has(parts[0])) return '';
  return `/${parts[0]}`;
}

function withBase(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${detectBasePath()}${normalized}`;
}

const navbarScript = document.createElement('script');
navbarScript.src = withBase('/shared/navbar.js');
navbarScript.defer = true;
document.body.appendChild(navbarScript);

const TMDB_API_KEY = '3ade810499876bb5672f40e54960e6a2';
const params = new URLSearchParams(window.location.search);
const contentId = params.get('id'); // movie or TV id

const iframe = document.getElementById('videoPlayer');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const playerContainer = document.getElementById('playerContainer');
const navbarContainer = document.getElementById('navbarContainer');
const closeBtn = document.getElementById('closeBtn');
const mediaTitle = document.getElementById('mediaTitle');
const mediaMeta = document.getElementById('mediaMeta');
const favoriteBtn = document.getElementById('favoriteBtn');
const watchLaterBtn = document.getElementById('watchLaterBtn');
const playbackNoteHoursInput = document.getElementById('playbackNoteHours');
const playbackNoteMinutesInput = document.getElementById('playbackNoteMinutes');

const moreLikeBox = document.getElementById('moreLikeBox');
const moreLikeGrid = document.getElementById('moreLikeGrid');
const moreLikeStatus = document.getElementById('moreLikeStatus');

const serverBtn = document.getElementById('serverBtn');
const serverDropdown = document.getElementById('serverDropdown');
const serverItems = [...serverDropdown.querySelectorAll('.serverDropdownItem')];

const initialSettings = window.bilmTheme?.getSettings?.();
const supportedServers = ['vidsrc', 'godrive', 'multiembed'];
const normalizeServer = (server) => (supportedServers.includes(server) ? server : 'vidsrc');
let currentServer = normalizeServer(initialSettings?.defaultServer || 'vidsrc');
let continueWatchingEnabled = initialSettings?.continueWatching !== false;
let mediaDetails = null;

function toSlug(value) {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'trending';
}

let imdbId = null;
let iframeRefreshToken = 0;
const CONTINUE_KEY = 'bilm-continue-watching';
const WATCH_HISTORY_KEY = 'bilm-watch-history';
const FAVORITES_KEY = 'bilm-favorites';
const WATCH_LATER_KEY = 'bilm-watch-later';
const PLAYBACK_NOTE_KEY = 'bilm-playback-note';
const storage = window.bilmTheme?.storage || {
  getJSON: (key, fallback = []) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  },
  setJSON: (key, value) => {
    localStorage.setItem(key, JSON.stringify(value));
  }
};

const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
const CONTINUE_WATCHING_DELAY = 15000;
let continueWatchingReady = false;
let continueWatchingTimer = null;
let continueWatchingInterval = null;
let similarPage = 1;
let similarLoading = false;
let similarEnded = false;
let similarActive = false;
const similarMovieIds = new Set();

async function fetchJSON(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
    return null;
  }
}

function startContinueWatchingTimer() {
  if (!continueWatchingEnabled || continueWatchingTimer || continueWatchingReady) return;
  continueWatchingTimer = setTimeout(() => {
    continueWatchingReady = true;
    continueWatchingTimer = null;
    updateContinueWatching();
    continueWatchingInterval = setInterval(() => {
      if (continueWatchingEnabled) {
        updateContinueWatching();
      }
    }, 30000);
  }, CONTINUE_WATCHING_DELAY);
}

function stopContinueWatchingTimer() {
  if (continueWatchingTimer) {
    clearTimeout(continueWatchingTimer);
    continueWatchingTimer = null;
  }
  if (continueWatchingInterval) {
    clearInterval(continueWatchingInterval);
    continueWatchingInterval = null;
  }
  continueWatchingReady = false;
}

function buildMovieUrl(server) {
  if (!contentId) return '';
  switch (server) {
    case 'vidsrc':
      return `https://vidsrc-embed.ru/embed/movie/${tmdbId || imdbId}`;
    case 'godrive':
      return imdbId ? `https://godriveplayer.com/player.php?imdb=${imdbId}` : '';
    case 'multiembed':
      return imdbId
        ? `https://multiembed.mov/directstream.php?video_id=${imdbId}`
        : `https://multiembed.mov/directstream.php?video_id=${contentId}&tmdb=1`;
    default:
      return '';
  }
}

function buildReloadableUrl(url) {
  try {
    const parsed = new URL(url, window.location.href);
    parsed.searchParams.set('bilm_refresh', Date.now().toString());
    return parsed.toString();
  } catch {
    return `${url}${url.includes('?') ? '&' : '?'}bilm_refresh=${Date.now()}`;
  }
}

function refreshIframe(url) {
  const token = ++iframeRefreshToken;
  iframe.src = 'about:blank';
  window.setTimeout(() => {
    if (token !== iframeRefreshToken) return;
    iframe.src = buildReloadableUrl(url);
  }, 60);
}

function updateIframe() {
  if (!contentId) {
    console.warn('No id parameter provided.');
    iframe.src = '';
    return;
  }
  let url = buildMovieUrl(currentServer);
  if (!url) {
    if (currentServer === 'godrive' && !imdbId) {
      return;
    }
    const fallbackServer = normalizeServer('vidsrc');
    setActiveServer(fallbackServer);
    url = buildMovieUrl(fallbackServer);
  }
  refreshIframe(url);
  if (continueWatchingReady) {
    updateContinueWatching();
  }
}

function loadList(key) {
  const list = storage.getJSON(key, []);
  return Array.isArray(list) ? list : [];
}

function saveList(key, items) {
  storage.setJSON(key, items);
}

function updateFavoriteButton(isFavorite) {
  if (!favoriteBtn) return;
  favoriteBtn.classList.toggle('is-active', isFavorite);
  favoriteBtn.setAttribute('aria-pressed', isFavorite ? 'true' : 'false');
  favoriteBtn.title = isFavorite ? 'Remove from favorites' : 'Add to favorites';
  favoriteBtn.setAttribute('aria-label', favoriteBtn.title);
}

function updateWatchLaterButton(isWatchLater) {
  if (!watchLaterBtn) return;
  watchLaterBtn.classList.toggle('is-active', isWatchLater);
  watchLaterBtn.setAttribute('aria-pressed', isWatchLater ? 'true' : 'false');
  watchLaterBtn.title = isWatchLater ? 'Remove from watch later' : 'Add to watch later';
  watchLaterBtn.setAttribute('aria-label', watchLaterBtn.title);
}

function setMoreLikeStatus(message) {
  if (moreLikeStatus) {
    moreLikeStatus.textContent = message;
  }
}

function createMoreLikeCard(movie) {
  const cardItem = {
    tmdbId: movie.id,
    title: movie.title,
    year: movie.release_date?.slice(0, 4) || 'N/A',
    type: 'movie',
    img: movie.poster_path
      ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
      : 'https://via.placeholder.com/140x210?text=No+Image',
    source: 'TMDB',
    link: `${withBase('/movies/viewer.html')}?id=${movie.id}`
  };

  return window.BilmMediaCard.createMediaCard({
    item: cardItem,
    className: 'more-like-card',
    badgeClassName: 'source-badge-overlay',
    metaClassName: 'card-meta',
    titleClassName: 'card-title',
    subtitleClassName: 'card-subtitle',
    dataset: { tmdbId: movie.id }
  });
}

async function fetchSimilarMovies(page = 1) {
  if (!contentId) return [];
  const url = `https://api.themoviedb.org/3/movie/${contentId}/similar?api_key=${TMDB_API_KEY}&page=${page}`;
  const data = await fetchJSON(url);
  return data?.results || [];
}

async function fetchRecommendedMovies(page = 1) {
  if (!contentId) return [];
  const url = `https://api.themoviedb.org/3/movie/${contentId}/recommendations?api_key=${TMDB_API_KEY}&page=${page}`;
  const data = await fetchJSON(url);
  return data?.results || [];
}

function getMovieRelevanceScore(movie) {
  const targetGenres = new Set(mediaDetails?.genreIds || []);
  const movieGenres = movie.genre_ids || [];
  const overlap = movieGenres.filter(id => targetGenres.has(id)).length;
  const targetYear = Number.parseInt(mediaDetails?.year, 10);
  const movieYear = Number.parseInt(movie.release_date?.slice(0, 4), 10);
  const yearGap = Number.isFinite(targetYear) && Number.isFinite(movieYear)
    ? Math.abs(targetYear - movieYear)
    : 5;
  const popularity = Number.isFinite(movie.popularity) ? movie.popularity : 0;
  const voteAverage = Number.isFinite(movie.vote_average) ? movie.vote_average : 0;
  const voteCount = Number.isFinite(movie.vote_count) ? movie.vote_count : 0;
  return (overlap * 40)
    - (yearGap * 3)
    + (voteAverage * 5)
    + Math.min(voteCount / 150, 10)
    + Math.min(popularity / 50, 8);
}

async function fetchMoreLikeCandidates(page = 1) {
  const [similar, recommended] = await Promise.all([
    fetchSimilarMovies(page),
    fetchRecommendedMovies(page)
  ]);
  const merged = [...similar, ...recommended];
  const deduped = [];
  const seen = new Set();
  merged.forEach(movie => {
    if (!movie?.id || seen.has(movie.id) || movie.id === Number(contentId)) return;
    seen.add(movie.id);
    deduped.push(movie);
  });
  return deduped.sort((a, b) => getMovieRelevanceScore(b) - getMovieRelevanceScore(a));
}

async function loadMoreLikeMovies() {
  if (!moreLikeGrid || similarLoading || similarEnded) return;
  if (!mediaDetails) {
    setMoreLikeStatus('Loading recommendations…');
    return;
  }
  similarLoading = true;
  setMoreLikeStatus('Loading more titles…');

  const movies = await fetchMoreLikeCandidates(similarPage);
  if (!movies.length) {
    similarEnded = true;
    setMoreLikeStatus('No more recommendations right now.');
    similarLoading = false;
    return;
  }

  const uniqueMovies = movies.filter(movie => movie.id && movie.id !== Number(contentId) && !similarMovieIds.has(movie.id));
  uniqueMovies.forEach(movie => {
    similarMovieIds.add(movie.id);
    moreLikeGrid.appendChild(createMoreLikeCard(movie));
  });

  similarPage += 1;
  setMoreLikeStatus('');
  similarLoading = false;
}

function toggleFavorite() {
  if (!mediaDetails) return;
  const items = loadList(FAVORITES_KEY);
  const key = `movie-${mediaDetails.id}`;
  const existingIndex = items.findIndex(item => item.key === key);
  if (existingIndex >= 0) {
    items.splice(existingIndex, 1);
    saveList(FAVORITES_KEY, items);
    updateFavoriteButton(false);
    return;
  }

  items.unshift({
    key,
    id: mediaDetails.id,
    type: 'movie',
    title: mediaDetails.title,
    date: mediaDetails.releaseDate,
    year: mediaDetails.year,
    poster: mediaDetails.poster,
    link: mediaDetails.link,
    updatedAt: Date.now(),
    source: 'TMDB'
  });
  saveList(FAVORITES_KEY, items);
  updateFavoriteButton(true);
}

function toggleWatchLater() {
  if (!mediaDetails) return;
  const items = loadList(WATCH_LATER_KEY);
  const key = `movie-${mediaDetails.id}`;
  const existingIndex = items.findIndex(item => item.key === key);
  if (existingIndex >= 0) {
    items.splice(existingIndex, 1);
    saveList(WATCH_LATER_KEY, items);
    updateWatchLaterButton(false);
    return;
  }

  items.unshift({
    key,
    id: mediaDetails.id,
    type: 'movie',
    title: mediaDetails.title,
    date: mediaDetails.releaseDate,
    year: mediaDetails.year,
    poster: mediaDetails.poster,
    link: mediaDetails.link,
    updatedAt: Date.now(),
    source: 'TMDB'
  });
  saveList(WATCH_LATER_KEY, items);
  updateWatchLaterButton(true);
}

function upsertHistoryItem(key, payload) {
  const items = loadList(key);
  const existingIndex = items.findIndex(item => item.key === payload.key);
  if (existingIndex >= 0) {
    items.splice(existingIndex, 1);
  }
  items.unshift(payload);
  saveList(key, items);
}

function updateContinueWatching() {
  const settings = window.bilmTheme?.getSettings?.() || {};
  if (!continueWatchingEnabled || !mediaDetails || settings.incognito === true) return;
  const payload = {
    key: `movie-${mediaDetails.id}`,
    id: mediaDetails.id,
    type: 'movie',
    title: mediaDetails.title,
    date: mediaDetails.releaseDate,
    year: mediaDetails.year,
    poster: mediaDetails.poster,
    link: mediaDetails.link,
    updatedAt: Date.now(),
    source: 'TMDB'
  };

  upsertHistoryItem(CONTINUE_KEY, payload);
  upsertHistoryItem(WATCH_HISTORY_KEY, payload);
}

function loadPlaybackNotes() {
  try {
    const raw = localStorage.getItem(PLAYBACK_NOTE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function savePlaybackNotes(notes) {
  localStorage.setItem(PLAYBACK_NOTE_KEY, JSON.stringify(notes));
}

function getPlaybackNoteKey() {
  return mediaDetails ? `movie-${mediaDetails.id}` : null;
}

function normalizeTimeDigits(value, maxLength) {
  if (!value) return '';
  return value.replace(/\D/g, '').slice(0, maxLength);
}

function parsePlaybackNoteValue(value) {
  if (!value) return { hours: '', minutes: '' };
  const parts = value.split(':').map(part => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { hours: parts[0], minutes: parts[1] };
  }
  if (parts.length === 1) {
    return { hours: parts[0], minutes: '' };
  }
  return { hours: '', minutes: '' };
}

function loadPlaybackNote() {
  if (!playbackNoteHoursInput || !playbackNoteMinutesInput) return;
  const key = getPlaybackNoteKey();
  if (!key) return;
  const notes = loadPlaybackNotes();
  const { hours, minutes } = parsePlaybackNoteValue(notes[key]);
  const normalizedHours = normalizeTimeDigits(hours, 3);
  const normalizedMinutes = normalizeTimeDigits(minutes, 2);
  playbackNoteHoursInput.value = normalizedHours || '00';
  playbackNoteMinutesInput.value = normalizedMinutes || '00';
  playbackNoteHoursInput.value = normalizeTimeDigits(hours, 3);
  playbackNoteMinutesInput.value = normalizeTimeDigits(minutes, 2);
}

function savePlaybackNote() {
  if (!playbackNoteHoursInput || !playbackNoteMinutesInput) return;
  const key = getPlaybackNoteKey();
  if (!key) return;
  const notes = loadPlaybackNotes();
  const rawHours = normalizeTimeDigits(playbackNoteHoursInput.value, 3);
  const rawMinutes = normalizeTimeDigits(playbackNoteMinutesInput.value, 2);
  const minutes = rawMinutes ? String(Math.min(Number(rawMinutes), 59)).padStart(2, '0') : '';
  playbackNoteHoursInput.value = rawHours;
  playbackNoteMinutesInput.value = rawMinutes;
  if (rawHours || minutes) {
    const hours = rawHours || '0';
    notes[key] = `${hours}:${minutes || '00'}`;
  } else {
    delete notes[key];
  }
  savePlaybackNotes(notes);
}

async function loadMovieDetails() {
  if (!contentId) {
    mediaTitle.textContent = 'Unknown title';
    mediaMeta.textContent = 'Release date unavailable';
    return;
  }

  try {
    const [response, externalResponse] = await Promise.all([
      fetch(`https://api.themoviedb.org/3/movie/${contentId}?api_key=${TMDB_API_KEY}`),
      fetch(`https://api.themoviedb.org/3/movie/${contentId}/external_ids?api_key=${TMDB_API_KEY}`)
    ]);
    if (!response.ok) {
      throw new Error('Failed to load movie details');
    }
    const details = await response.json();
    const external = externalResponse.ok ? await externalResponse.json() : {};
    imdbId = external.imdb_id || null;
    const title = details.title || details.original_title || 'Unknown title';
    const releaseDate = details.release_date || '';
    const displayDate = releaseDate ? new Date(releaseDate).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : 'Release date unavailable';
    const year = releaseDate ? releaseDate.slice(0, 4) : 'N/A';
    const poster = details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : 'https://via.placeholder.com/140x210?text=No+Image';

    mediaTitle.textContent = title;
    mediaMeta.textContent = displayDate;
    document.title = `Bilm 💜 - ${title}`;

    mediaDetails = {
      id: contentId,
      title,
      releaseDate,
      year,
      poster,
      genreIds: details.genres?.map(genre => genre.id) || [],
      genreSlugs: details.genres?.map(genre => toSlug(genre.name)) || [],
      link: `${withBase('/movies/viewer.html')}?id=${contentId}`
    };

    const favorites = loadList(FAVORITES_KEY);
    updateFavoriteButton(favorites.some(item => item.key === `movie-${contentId}`));
    const watchLater = loadList(WATCH_LATER_KEY);
    updateWatchLaterButton(watchLater.some(item => item.key === `movie-${contentId}`));
    loadPlaybackNote();
    updateIframe();
    startContinueWatchingTimer();
    if (moreLikeGrid) {
      moreLikeGrid.innerHTML = '';
      similarMovieIds.clear();
      similarPage = 1;
      similarEnded = false;
      loadMoreLikeMovies();
    }
  } catch (error) {
    console.error('Error fetching movie details:', error);
    mediaTitle.textContent = 'Unknown title';
    mediaMeta.textContent = 'Release date unavailable';
  }
}

serverBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = serverDropdown.style.display === 'flex';
  if (isOpen) {
    serverDropdown.style.display = 'none';
    serverBtn.setAttribute('aria-expanded', 'false');
  } else {
    serverDropdown.style.display = 'flex';
    serverBtn.setAttribute('aria-expanded', 'true');
  }
});

document.addEventListener('click', () => {
  serverDropdown.style.display = 'none';
  serverBtn.setAttribute('aria-expanded', 'false');
});

function setActiveServer(server) {
  serverItems.forEach(i => i.classList.toggle('active', i.getAttribute('data-server') === server));
  currentServer = server;
}

serverItems.forEach(item => {
  item.addEventListener('click', () => {
    if (item.classList.contains('active')) return;
    setActiveServer(item.getAttribute('data-server'));
    updateIframe();
    serverDropdown.style.display = 'none';
    serverBtn.setAttribute('aria-expanded', 'false');
  });
});

if (currentServer) {
  setActiveServer(normalizeServer(currentServer));
}

window.addEventListener('bilm:theme-changed', (event) => {
  const newServer = normalizeServer(event.detail?.defaultServer);
  if (newServer && newServer !== currentServer) {
    setActiveServer(newServer);
    updateIframe();
  }
  const nextContinueWatching = event.detail?.continueWatching !== false;
  if (nextContinueWatching !== continueWatchingEnabled) {
    continueWatchingEnabled = nextContinueWatching;
    if (continueWatchingEnabled) {
      startContinueWatchingTimer();
    } else {
      stopContinueWatchingTimer();
    }
  }
});

if (favoriteBtn) {
  favoriteBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleFavorite();
  });
}

if (watchLaterBtn) {
  watchLaterBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleWatchLater();
  });
}

if (playbackNoteHoursInput && playbackNoteMinutesInput) {
  [playbackNoteHoursInput, playbackNoteMinutesInput].forEach((input, index) => {
    input.addEventListener('input', () => {
      if (input === playbackNoteMinutesInput) {
        input.value = normalizeTimeDigits(input.value, 2);
      } else {
        input.value = normalizeTimeDigits(input.value, 3);
      }
      savePlaybackNote();
    });

    input.addEventListener('keydown', (event) => {
      if (event.key !== ':' || input !== playbackNoteHoursInput) return;
      event.preventDefault();
      playbackNoteMinutesInput.focus();
      playbackNoteMinutesInput.select();
    });

    input.addEventListener('blur', () => {
      if (input === playbackNoteMinutesInput && input.value) {
        const minutesValue = normalizeTimeDigits(input.value, 2);
        input.value = String(Math.min(Number(minutesValue), 59)).padStart(2, '0');
        savePlaybackNote();
      }
    });

    input.addEventListener('focus', () => {
      if (index === 1 && playbackNoteMinutesInput.value.length === 1) {
        playbackNoteMinutesInput.select();
      }
    });
  });
}

if (moreLikeBox) {
  if (!contentId) {
    setMoreLikeStatus('Recommendations unavailable.');
  } else {
    similarActive = true;
    setMoreLikeStatus('Loading recommendations…');
  }
  moreLikeBox.addEventListener('scroll', () => {
    if (!similarActive || similarLoading || similarEnded) return;
    if (moreLikeBox.scrollTop + moreLikeBox.clientHeight >= moreLikeBox.scrollHeight - 200) {
      loadMoreLikeMovies();
    }
  }, { passive: true });
}

fullscreenBtn.onclick = () => {
  if (!isMobile) {
    if (playerContainer.requestFullscreen) {
      playerContainer.requestFullscreen();
    } else if (playerContainer.webkitRequestFullscreen) {
      playerContainer.webkitRequestFullscreen();
    } else if (playerContainer.msRequestFullscreen) {
      playerContainer.msRequestFullscreen();
    }
  } else {
    playerContainer.classList.add('simulated-fullscreen');
  }
  if (closeBtn) {
    closeBtn.style.display = 'block';
  }
  navbarContainer.classList.add('hide-navbar');
};

if (closeBtn) {
  closeBtn.onclick = () => {
    if (isMobile) {
      playerContainer.classList.remove('simulated-fullscreen');
    } else if (document.fullscreenElement || document.webkitFullscreenElement) {
      document.exitFullscreen?.() || document.webkitExitFullscreen?.();
    }
    closeBtn.style.display = 'none';
    navbarContainer.classList.remove('hide-navbar');
  };
}

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) {
    if (closeBtn) {
      closeBtn.style.display = 'none';
    }
    navbarContainer.classList.remove('hide-navbar');
  }
});

// Initial load
updateIframe();
loadMovieDetails();
startContinueWatchingTimer();
