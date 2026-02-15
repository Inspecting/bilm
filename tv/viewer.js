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
const tmdbId = params.get('id');

const iframe = document.getElementById('videoPlayer');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const closeBtn = document.getElementById('closeBtn');
const playerContainer = document.getElementById('playerContainer');
const navbarContainer = document.getElementById('navbarContainer');
const mediaTitle = document.getElementById('mediaTitle');
const mediaMeta = document.getElementById('mediaMeta');
const favoriteBtn = document.getElementById('favoriteBtn');
const watchLaterBtn = document.getElementById('watchLaterBtn');
const playbackNoteHoursInput = document.getElementById('playbackNoteHours');
const playbackNoteMinutesInput = document.getElementById('playbackNoteMinutes');
const seasonSelect = document.getElementById('seasonSelect');
const episodeSelect = document.getElementById('episodeSelect');
const prevSeasonBtn = document.getElementById('prevSeason');
const nextSeasonBtn = document.getElementById('nextSeason');
const prevEpisodeBtn = document.getElementById('prevEpisode');
const nextEpisodeBtn = document.getElementById('nextEpisode');
const moreLikeBox = document.getElementById('moreLikeBox');
const moreLikeGrid = document.getElementById('moreLikeGrid');
const moreLikeStatus = document.getElementById('moreLikeStatus');

const serverBtn = document.getElementById('serverBtn');
const serverDropdown = document.getElementById('serverDropdown');
const serverItems = [...serverDropdown.querySelectorAll('.serverDropdownItem')];

let currentSeason = 1;
let currentEpisode = 1;
const initialSettings = window.bilmTheme?.getSettings?.();
const supportedServers = ['vidsrc', 'godrive', 'multiembed'];
const normalizeServer = (server) => (supportedServers.includes(server) ? server : 'vidsrc');
let currentServer = normalizeServer(initialSettings?.defaultServer || 'vidsrc');
let totalSeasons = 1;
let episodesPerSeason = {};
let seasonEpisodeMemory = {};
let continueWatchingEnabled = initialSettings?.continueWatching !== false;
let mediaDetails = null;

function toSlug(value) {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'trending';
}

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
  },
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value)
};

const isMobile = window.matchMedia('(max-width: 768px)').matches
  || window.matchMedia('(pointer: coarse)').matches
  || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
const CONTINUE_WATCHING_DELAY = 15000;
let continueWatchingReady = false;
let continueWatchingTimer = null;
let continueWatchingInterval = null;

let seasonCooldownActive = false;
let episodeCooldownActive = false;
let seasonCooldownTimer = null;
let episodeCooldownTimer = null;

let imdbId = null;
let similarPage = 1;
let similarLoading = false;
let similarEnded = false;
let similarActive = false;
const similarShowIds = new Set();

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

function createMoreLikeCard(show) {
  const cardItem = {
    tmdbId: show.id,
    title: show.name,
    year: show.first_air_date?.slice(0, 4) || 'N/A',
    type: 'tv',
    img: show.poster_path
      ? `https://image.tmdb.org/t/p/w500${show.poster_path}`
      : 'https://via.placeholder.com/140x210?text=No+Image',
    source: 'TMDB',
    link: `${withBase('/tv/viewer.html')}?id=${show.id}`
  };

  return window.BilmMediaCard.createMediaCard({
    item: cardItem,
    className: 'more-like-card',
    badgeClassName: 'source-badge-overlay',
    metaClassName: 'card-meta',
    titleClassName: 'card-title',
    subtitleClassName: 'card-subtitle',
    dataset: { tmdbId: show.id }
  });
}

async function fetchSimilarShows(page = 1) {
  if (!tmdbId) return [];
  const url = `https://api.themoviedb.org/3/tv/${tmdbId}/similar?api_key=${TMDB_API_KEY}&page=${page}`;
  const data = await fetchJSON(url);
  return data?.results || [];
}

async function fetchRecommendedShows(page = 1) {
  if (!tmdbId) return [];
  const url = `https://api.themoviedb.org/3/tv/${tmdbId}/recommendations?api_key=${TMDB_API_KEY}&page=${page}`;
  const data = await fetchJSON(url);
  return data?.results || [];
}

function getShowRelevanceScore(show) {
  const targetGenres = new Set(mediaDetails?.genreIds || []);
  const showGenres = show.genre_ids || [];
  const overlap = showGenres.filter(id => targetGenres.has(id)).length;
  const targetYear = Number.parseInt(mediaDetails?.year, 10);
  const showYear = Number.parseInt(show.first_air_date?.slice(0, 4), 10);
  const yearGap = Number.isFinite(targetYear) && Number.isFinite(showYear)
    ? Math.abs(targetYear - showYear)
    : 5;
  const popularity = Number.isFinite(show.popularity) ? show.popularity : 0;
  const voteAverage = Number.isFinite(show.vote_average) ? show.vote_average : 0;
  const voteCount = Number.isFinite(show.vote_count) ? show.vote_count : 0;
  return (overlap * 40)
    - (yearGap * 3)
    + (voteAverage * 5)
    + Math.min(voteCount / 150, 10)
    + Math.min(popularity / 50, 8);
}

async function fetchMoreLikeCandidates(page = 1) {
  const [similar, recommended] = await Promise.all([
    fetchSimilarShows(page),
    fetchRecommendedShows(page)
  ]);
  const merged = [...similar, ...recommended];
  const deduped = [];
  const seen = new Set();
  merged.forEach(show => {
    if (!show?.id || seen.has(show.id) || show.id === Number(tmdbId)) return;
    seen.add(show.id);
    deduped.push(show);
  });
  return deduped.sort((a, b) => getShowRelevanceScore(b) - getShowRelevanceScore(a));
}

async function loadMoreLikeShows() {
  if (!moreLikeGrid || similarLoading || similarEnded) return;
  if (!mediaDetails) {
    setMoreLikeStatus('Loading recommendations…');
    return;
  }
  similarLoading = true;
  setMoreLikeStatus('Loading more titles…');

  const shows = await fetchMoreLikeCandidates(similarPage);
  if (!shows.length) {
    similarEnded = true;
    setMoreLikeStatus('No more recommendations right now.');
    similarLoading = false;
    return;
  }

  const uniqueShows = shows.filter(show => show.id && show.id !== Number(tmdbId) && !similarShowIds.has(show.id));
  uniqueShows.forEach(show => {
    similarShowIds.add(show.id);
    moreLikeGrid.appendChild(createMoreLikeCard(show));
  });

  similarPage += 1;
  setMoreLikeStatus('');
  similarLoading = false;
}

function toggleFavorite() {
  if (!mediaDetails) return;
  const items = loadList(FAVORITES_KEY);
  const key = `tv-${mediaDetails.id}`;
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
    type: 'tv',
    title: mediaDetails.title,
    date: mediaDetails.firstAirDate,
    year: mediaDetails.year,
    poster: mediaDetails.poster,
    link: mediaDetails.link,
    updatedAt: Date.now(),
    season: currentSeason,
    episode: currentEpisode,
    source: 'TMDB'
  });
  saveList(FAVORITES_KEY, items);
  updateFavoriteButton(true);
}

function toggleWatchLater() {
  if (!mediaDetails) return;
  const items = loadList(WATCH_LATER_KEY);
  const key = `tv-${mediaDetails.id}`;
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
    type: 'tv',
    title: mediaDetails.title,
    date: mediaDetails.firstAirDate,
    year: mediaDetails.year,
    poster: mediaDetails.poster,
    link: mediaDetails.link,
    updatedAt: Date.now(),
    season: currentSeason,
    episode: currentEpisode,
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
    key: `tv-${mediaDetails.id}`,
    id: mediaDetails.id,
    type: 'tv',
    title: mediaDetails.title,
    date: mediaDetails.firstAirDate,
    year: mediaDetails.year,
    poster: mediaDetails.poster,
    link: mediaDetails.link,
    updatedAt: Date.now(),
    season: currentSeason,
    episode: currentEpisode,
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
  if (!tmdbId) return null;
  return `tv-${tmdbId}-s${currentSeason}-e${currentEpisode}`;
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
  if (closeBtn) closeBtn.style.display = 'block';
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
    if (closeBtn) closeBtn.style.display = 'none';
    navbarContainer.classList.remove('hide-navbar');
  }
});

// Server dropdown toggle
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

// Close server dropdown on outside click
document.addEventListener('click', () => {
  serverDropdown.style.display = 'none';
  serverBtn.setAttribute('aria-expanded', 'false');
});

function setActiveServer(server) {
  serverItems.forEach(i => i.classList.toggle('active', i.getAttribute('data-server') === server));
  currentServer = server;
}

// Server selection
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

if (moreLikeBox) {
  if (!tmdbId) {
    setMoreLikeStatus('Recommendations unavailable.');
  } else {
    similarActive = true;
    setMoreLikeStatus('Loading recommendations…');
  }
  moreLikeBox.addEventListener('scroll', () => {
    if (!similarActive || similarLoading || similarEnded) return;
    if (moreLikeBox.scrollTop + moreLikeBox.clientHeight >= moreLikeBox.scrollHeight - 200) {
      loadMoreLikeShows();
    }
  }, { passive: true });
}

function saveProgress() {
  if (!tmdbId) return;
  seasonEpisodeMemory[currentSeason] = currentEpisode;
  storage.setItem(`bilm-tv-progress-${tmdbId}`, JSON.stringify({
    season: currentSeason,
    episode: currentEpisode,
    seasonEpisodes: seasonEpisodeMemory
  }));
}

function loadProgress() {
  if (!tmdbId) return;
  const saved = storage.getItem(`bilm-tv-progress-${tmdbId}`);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      currentSeason = parsed.season || 1;
      seasonEpisodeMemory = parsed.seasonEpisodes || {};
      currentEpisode = parsed.episode || seasonEpisodeMemory[currentSeason] || 1;
    } catch {
      currentSeason = 1;
      currentEpisode = 1;
      seasonEpisodeMemory = {};
    }
  }
}

function buildTvUrl(server) {
  if (!tmdbId && !imdbId) return '';
  const season = currentSeason;
  const episode = currentEpisode;
  switch (server) {
    case 'vidsrc':
      return `https://vsrc.su/embed/${imdbId || tmdbId}/${season}-${episode}`;
    case 'godrive':
      return tmdbId
        ? `https://godriveplayer.com/player.php?type=series&tmdb=${tmdbId}&season=${season}&episode=${episode}`
        : '';
    case 'multiembed':
      return imdbId
        ? `https://multiembed.mov/directstream.php?video_id=${imdbId}&s=${season}&e=${episode}`
        : `https://multiembed.mov/directstream.php?video_id=${tmdbId}&tmdb=1&s=${season}&e=${episode}`;
    default:
      return '';
  }
}

function updateIframe() {
  saveProgress();

  const idToUse = imdbId || tmdbId;
  if (!idToUse) {
    console.warn('No valid ID for embed URL.');
    iframe.src = '';
    return;
  }

  let url = buildTvUrl(currentServer);
  if (!url) {
    setActiveServer('vidsrc');
    url = buildTvUrl('vidsrc');
  }
  iframe.src = url;

  if (continueWatchingReady) {
    updateContinueWatching();
  }

  loadPlaybackNote();
}

function populateSeasons(total) {
  seasonSelect.innerHTML = '';
  for (let i = 1; i <= total; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `Season ${i}`;
    seasonSelect.appendChild(opt);
  }
}

function populateEpisodes(count) {
  episodeSelect.innerHTML = '';
  for (let i = 1; i <= count; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `Episode ${i}`;
    episodeSelect.appendChild(opt);
  }
}

function rememberEpisode() {
  seasonEpisodeMemory[currentSeason] = currentEpisode;
}

function getEpisodeForSeason(season) {
  const maxEpisodes = episodesPerSeason[season] || 1;
  const stored = seasonEpisodeMemory[season] || 1;
  return Math.min(Math.max(stored, 1), maxEpisodes);
}

function updateSeasonSelection(newSeason) {
  rememberEpisode();
  currentSeason = newSeason;
  if (!episodesPerSeason[currentSeason]) {
    episodesPerSeason[currentSeason] = 1;
  }
  currentEpisode = getEpisodeForSeason(currentSeason);
  populateEpisodes(episodesPerSeason[currentSeason]);
}

// Helper to disable or enable season controls
function setSeasonControlsDisabled(disabled) {
  prevSeasonBtn.disabled = disabled || currentSeason <= 1;
  nextSeasonBtn.disabled = disabled || currentSeason >= totalSeasons;
  seasonSelect.disabled = disabled;
}

// Helper to disable or enable episode controls
function setEpisodeControlsDisabled(disabled) {
  prevEpisodeBtn.disabled = disabled || currentEpisode <= 1;
  nextEpisodeBtn.disabled = disabled || currentEpisode >= (episodesPerSeason[currentSeason] || 1);
  episodeSelect.disabled = disabled;
}

function updateControls() {
  // Update selects values
  seasonSelect.value = currentSeason;
  episodeSelect.value = currentEpisode;

  // Disable buttons if at limits and not in cooldown
  if (!seasonCooldownActive) {
    prevSeasonBtn.disabled = currentSeason <= 1;
    nextSeasonBtn.disabled = currentSeason >= totalSeasons;
    seasonSelect.disabled = false;
  }

  if (!episodeCooldownActive) {
    prevEpisodeBtn.disabled = currentEpisode <= 1;
    nextEpisodeBtn.disabled = currentEpisode >= (episodesPerSeason[currentSeason] || 1);
    episodeSelect.disabled = false;
  }
}

// Season buttons
prevSeasonBtn.addEventListener('click', () => {
  if (seasonCooldownActive) return;
  if (currentSeason > 1) {
    updateSeasonSelection(currentSeason - 1);
    updateIframe();
    seasonCooldownActive = true;

    // Disable all season controls
    setSeasonControlsDisabled(true);
    setEpisodeControlsDisabled(false);

    updateControls();

    clearTimeout(seasonCooldownTimer);
    seasonCooldownTimer = setTimeout(() => {
      seasonCooldownActive = false;
      setSeasonControlsDisabled(false);
      updateControls();
    }, 500);
  }
});

nextSeasonBtn.addEventListener('click', () => {
  if (seasonCooldownActive) return;
  if (currentSeason < totalSeasons) {
    updateSeasonSelection(currentSeason + 1);
    updateIframe();
    seasonCooldownActive = true;

    setSeasonControlsDisabled(true);
    setEpisodeControlsDisabled(false);

    updateControls();

    clearTimeout(seasonCooldownTimer);
    seasonCooldownTimer = setTimeout(() => {
      seasonCooldownActive = false;
      setSeasonControlsDisabled(false);
      updateControls();
    }, 500);
  }
});

seasonSelect.addEventListener('change', () => {
  if (seasonCooldownActive) return;
  updateSeasonSelection(parseInt(seasonSelect.value));
  updateIframe();
  seasonCooldownActive = true;

  setSeasonControlsDisabled(true);
  setEpisodeControlsDisabled(false);

  updateControls();

  clearTimeout(seasonCooldownTimer);
  seasonCooldownTimer = setTimeout(() => {
    seasonCooldownActive = false;
    setSeasonControlsDisabled(false);
    updateControls();
  }, 500);
});

// Episode buttons
prevEpisodeBtn.addEventListener('click', () => {
  if (episodeCooldownActive) return;
  if (currentEpisode > 1) {
    currentEpisode--;
    rememberEpisode();
    updateIframe();
    episodeCooldownActive = true;

    setEpisodeControlsDisabled(true);
    setSeasonControlsDisabled(false);

    updateControls();

    clearTimeout(episodeCooldownTimer);
    episodeCooldownTimer = setTimeout(() => {
      episodeCooldownActive = false;
      setEpisodeControlsDisabled(false);
      updateControls();
    }, 500);
  }
});

nextEpisodeBtn.addEventListener('click', () => {
  if (episodeCooldownActive) return;
  if (currentEpisode < (episodesPerSeason[currentSeason] || 1)) {
    currentEpisode++;
    rememberEpisode();
    updateIframe();
    episodeCooldownActive = true;

    setEpisodeControlsDisabled(true);
    setSeasonControlsDisabled(false);

    updateControls();

    clearTimeout(episodeCooldownTimer);
    episodeCooldownTimer = setTimeout(() => {
      episodeCooldownActive = false;
      setEpisodeControlsDisabled(false);
      updateControls();
    }, 500);
  }
});

episodeSelect.addEventListener('change', () => {
  if (episodeCooldownActive) return;
  currentEpisode = parseInt(episodeSelect.value);
  rememberEpisode();
  updateIframe();
  episodeCooldownActive = true;

  setEpisodeControlsDisabled(true);
  setSeasonControlsDisabled(false);

  updateControls();

  clearTimeout(episodeCooldownTimer);
  episodeCooldownTimer = setTimeout(() => {
    episodeCooldownActive = false;
    setEpisodeControlsDisabled(false);
    updateControls();
  }, 500);
});

// Fetch TMDB data for season/episode info
async function fetchTMDBData() {
  if (!tmdbId) {
    mediaTitle.textContent = 'Unknown title';
    mediaMeta.textContent = 'Release date unavailable';
    return;
  }

  try {
    // First get external IDs (like imdb_id)
    const externalRes = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`);
    const externalData = await externalRes.json();
    imdbId = externalData.imdb_id || null;

    // Get season info
    const detailsRes = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`);
    const details = await detailsRes.json();

    totalSeasons = details.number_of_seasons || 1;
    const showTitle = details.name || details.original_name || 'Unknown title';
    const firstAirDate = details.first_air_date || '';
    const displayDate = firstAirDate
      ? new Date(firstAirDate).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
      : 'Release date unavailable';
    const year = firstAirDate ? firstAirDate.slice(0, 4) : 'N/A';
    const poster = details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : 'https://via.placeholder.com/140x210?text=No+Image';
    mediaTitle.textContent = showTitle;
    mediaMeta.textContent = displayDate;
    document.title = `Bilm 💜 - ${showTitle}`;

    mediaDetails = {
      id: tmdbId,
      title: showTitle,
      firstAirDate,
      year,
      poster,
      genreIds: details.genres?.map(genre => genre.id) || [],
      genreSlugs: details.genres?.map(genre => toSlug(genre.name)) || [],
      link: `${withBase('/tv/viewer.html')}?id=${tmdbId}`
    };

    const favorites = loadList(FAVORITES_KEY);
    updateFavoriteButton(favorites.some(item => item.key === `tv-${tmdbId}`));
    const watchLater = loadList(WATCH_LATER_KEY);
    updateWatchLaterButton(watchLater.some(item => item.key === `tv-${tmdbId}`));
    mediaTitle.textContent = showTitle;
    mediaMeta.textContent = displayDate;
    document.title = `Bilm 💜 - ${showTitle}`;

    episodesPerSeason = {};
    details.seasons.forEach(season => {
      episodesPerSeason[season.season_number] = season.episode_count || 1;
    });

    loadProgress();

    populateSeasons(totalSeasons);
    if (!episodesPerSeason[currentSeason]) {
      episodesPerSeason[currentSeason] = 1;
    }
    currentEpisode = getEpisodeForSeason(currentSeason);
    seasonEpisodeMemory[currentSeason] = currentEpisode;
    populateEpisodes(episodesPerSeason[currentSeason]);

    updateControls();
    updateIframe();
    startContinueWatchingTimer();
    if (moreLikeGrid) {
      moreLikeGrid.innerHTML = '';
      similarShowIds.clear();
      similarPage = 1;
      similarEnded = false;
      loadMoreLikeShows();
    }
  } catch (e) {
    console.error('Error fetching TMDB data:', e);
  }
}

fetchTMDBData();
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

startContinueWatchingTimer();
