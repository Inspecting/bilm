const appWithBase = window.bilmTheme?.withBase || ((path) => path);

function sanitizeNumericId(value) {
  const normalized = String(value || '').trim();
  if (!/^\d{1,12}$/.test(normalized)) return '';
  return normalized.replace(/^0+(?=\d)/, '');
}

function sanitizeImdbId(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^tt\d{5,12}$/.test(normalized) ? normalized : '';
}

const params = new URLSearchParams(window.location.search);
const tmdbId = sanitizeNumericId(params.get('id'));
const isAnime = params.get('anime') === '1';
const animeId = sanitizeNumericId(params.get('aid') || tmdbId);

const iframe = document.getElementById('videoPlayer');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const refreshBtn = document.getElementById('refreshBtn');
const closeBtn = document.getElementById('closeBtn');
const playerContainer = document.getElementById('playerContainer');
const playerWithControls = document.getElementById('playerWithControls');
const navbarContainer = document.getElementById('navbarContainer');
const mediaTitle = document.getElementById('mediaTitle');
const mediaMeta = document.getElementById('mediaMeta');
const playerStatus = document.getElementById('playerStatus');
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
const languageBtn = document.getElementById('languageBtn');
const languageDropdown = document.getElementById('languageDropdown');
const languageItems = languageDropdown ? [...languageDropdown.querySelectorAll('[data-language]')] : [];
const subtitleBtn = document.getElementById('subtitleBtn');
const subtitleDropdown = document.getElementById('subtitleDropdown');
const subtitleItems = subtitleDropdown ? [...subtitleDropdown.querySelectorAll('[data-subtitle]')] : [];

let currentSeason = 1;
let currentEpisode = 1;
const initialSettings = window.bilmTheme?.getSettings?.();
const supportedServers = ['embedmaster', 'multiembed', 'vidking', 'vidsrc'];
const animeSupportedServers = ['vidnest'];
const visibleServerItems = serverItems.filter((item) => {
  const server = item.getAttribute('data-server');
  const supported = isAnime ? animeSupportedServers.includes(server) : supportedServers.includes(server);
  item.style.display = supported ? '' : 'none';
  return supported;
});
const normalizeServer = (server) => {
  if (isAnime) return animeSupportedServers.includes(server) ? server : 'vidnest';
  return supportedServers.includes(server) ? server : 'embedmaster';
};
let currentServer = normalizeServer(isAnime ? (initialSettings?.animeDefaultServer || 'vidnest') : (initialSettings?.defaultServer || 'embedmaster'));
let currentLanguage = params.get('lang') === 'dub' ? 'dub' : 'sub';
let currentSubtitle = 'off';
let totalSeasons = 1;
let episodesPerSeason = {};
let seasonEpisodeMemory = {};
let continueWatchingEnabled = initialSettings?.continueWatching !== false;
let mediaDetails = null;
const API_COOLDOWN_MS = 250;
const METADATA_FETCH_TIMEOUT_MS = 6500;
const apiCooldownByHost = new Map();
const PROVIDER_HEALTH_KEY = 'bilm-player-provider-health-v1';
const PROVIDER_HEALTH_TTL_MS = 6 * 60 * 1000;

function toSlug(value) {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'trending';
}

function getCurrentAccentColor() {
  const settings = window.bilmTheme?.getSettings?.() || {};
  const accent = String(settings?.accent || '#a855f7').trim();
  return /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#a855f7';
}

function getCurrentAccentHexWithoutHash() {
  return getCurrentAccentColor().replace(/^#/, '');
}

function normalizeEmbedUrlForCompare(rawUrl) {
  const normalized = String(rawUrl || '').trim();
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized, window.location.href);
    parsed.searchParams.delete('bilm_refresh');
    return parsed.toString();
  } catch {
    return normalized;
  }
}

function getEmbedMessageTargetOrigin() {
  const src = String(iframe?.getAttribute('src') || '').trim();
  if (!src) return '';
  try {
    const parsed = new URL(src, window.location.href);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

function readIframeLocationHref() {
  try {
    return String(iframe?.contentWindow?.location?.href || '').trim();
  } catch {
    // Cross-origin iframe locations are unreadable.
    return null;
  }
}

function isKnownBlankIframeLocation(locationHref) {
  if (locationHref == null) return false;
  const normalized = String(locationHref || '').trim().toLowerCase();
  return !normalized || normalized === 'about:blank' || normalized === 'about:srcdoc';
}

function appendVidsrcSubtitleParam(url) {
  const normalized = String(url || '').trim();
  if (!normalized || isAnime || currentSubtitle === 'off') return normalized;
  try {
    const parsed = new URL(normalized);
    parsed.searchParams.set('ds_lang', currentSubtitle);
    return parsed.toString();
  } catch {
    return normalized;
  }
}

function appendVidKingParams(url, { includeEpisodeControls = false } = {}) {
  const normalized = String(url || '').trim();
  if (!normalized) return normalized;
  try {
    const parsed = new URL(normalized);
    parsed.searchParams.set('color', getCurrentAccentHexWithoutHash());
    if (includeEpisodeControls) {
      parsed.searchParams.set('nextEpisode', 'true');
      parsed.searchParams.set('episodeSelector', 'true');
    }
    return parsed.toString();
  } catch {
    return normalized;
  }
}

function readProviderHealthState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROVIDER_HEALTH_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeProviderHealthState(state = {}) {
  try {
    localStorage.setItem(PROVIDER_HEALTH_KEY, JSON.stringify(state));
  } catch {
    // Best effort health cache.
  }
}

function markServerHealth(server, ok, reason = '') {
  const key = String(server || '').trim();
  if (!key || isAnime) return;
  const state = readProviderHealthState();
  const now = Date.now();
  if (ok) {
    delete state[key];
  } else {
    state[key] = {
      failedAtMs: now,
      reason: String(reason || 'unknown').trim() || 'unknown'
    };
  }
  writeProviderHealthState(state);
}

function isServerTemporarilyUnhealthy(server) {
  const key = String(server || '').trim();
  if (!key || isAnime) return false;
  const state = readProviderHealthState();
  const failedAtMs = Number(state?.[key]?.failedAtMs || 0);
  if (!failedAtMs) return false;
  if (Date.now() - failedAtMs > PROVIDER_HEALTH_TTL_MS) {
    delete state[key];
    writeProviderHealthState(state);
    return false;
  }
  return true;
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
const mediaIdentity = window.BilmMediaIdentity || {
  createStoredMediaItem: (item) => item,
  canonicalizeStoredItem: (item) => item,
  findIndexByIdentity: (list, item) => list.findIndex((entry) => entry?.key && entry.key === item?.key),
  hasIdentity: (list, item) => list.some((entry) => entry?.key && entry.key === item?.key),
  dedupeCanonicalItems: (list) => list
};
mediaIdentity.migrateLocalListsOnce?.();

const CONTINUE_WATCHING_DELAY = 15000;
let continueWatchingReady = false;
let continueWatchingTimer = null;
let continueWatchingInterval = null;

let seasonCooldownActive = false;
let episodeCooldownActive = false;
let seasonCooldownTimer = null;
let episodeCooldownTimer = null;

let imdbId = null;
let iframeLoadRequestId = 0;
let lastIframeLoadAtMs = 0;
let lastIframeLoadedSrc = '';
const EMBED_LOAD_TIMEOUTS_MS = [12000];
const EMBED_LOAD_TIMEOUT_GRACE_MS = 700;
const EMBED_LOAD_LATE_WINDOW_MS = 700;
const EMBED_MASTER_COLOR_RETRY_SCHEDULE_MS = [100, 320, 800, 1700, 2800, 4200];
const EMBEDMASTER_ALLOWED_COMMANDS = new Set(['color1', 'fullscreen']);
let embedMasterLastColorSent = '';
let similarPage = 1;
let similarLoading = false;
let similarEnded = false;
let similarActive = false;
const similarShowIds = new Set();
const watchHistorySessionId = `whs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const watchHistorySessionFingerprints = new Set();


async function waitForApiCooldown(url) {
  let host = 'default';
  try {
    host = new URL(url, window.location.origin).host || 'default';
  } catch {
    host = 'default';
  }
  const now = Date.now();
  const nextAllowedAt = apiCooldownByHost.get(host) || 0;
  const waitMs = nextAllowedAt - now;
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  apiCooldownByHost.set(host, Date.now() + API_COOLDOWN_MS);
}

async function fetchWithTimeout(url, { timeoutMs = 0, ...fetchOptions } = {}) {
  const safeTimeoutMs = Math.max(0, Number(timeoutMs) || 0);
  if (!safeTimeoutMs) {
    return fetch(url, fetchOptions);
  }
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, safeTimeoutMs);
  try {
    return await fetch(url, { ...fetchOptions, signal: controller.signal });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function fetchJSON(url, options = {}) {
  const { timeoutMs = 0, ...fetchOptions } = options;
  try {
    await waitForApiCooldown(url);
    const res = await fetchWithTimeout(url, { timeoutMs, ...fetchOptions });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
    return null;
  }
}

async function postJSON(url, body, options = {}) {
  const { timeoutMs = 0 } = options;
  try {
    await waitForApiCooldown(url);
    const isAniList = /graphql\.anilist\.co/i.test(url);
    const res = await fetchWithTimeout(url, {
      timeoutMs,
      method: 'POST',
      headers: isAniList
        ? { 'Content-Type': 'text/plain;charset=UTF-8' }
        : { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
    return null;
  }
}

function pickShowCertification(items) {
  const list = Array.isArray(items) ? items : [];
  const us = list.find((entry) => entry?.iso_3166_1 === 'US' && String(entry?.rating || '').trim());
  if (us) return String(us.rating).trim();

  const fallback = list.find((entry) => String(entry?.rating || '').trim());
  return fallback ? String(fallback.rating).trim() : '';
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
  if (!Array.isArray(list)) return [];
  return list.map((item) => mediaIdentity.canonicalizeStoredItem(item) || item).filter(Boolean);
}

function saveList(key, items) {
  const list = Array.isArray(items) ? items : [];
  const normalized = list
    .map((item) => mediaIdentity.canonicalizeStoredItem(item) || item)
    .filter(Boolean);
  const shouldDedupe = key !== WATCH_HISTORY_KEY;
  storage.setJSON(key, shouldDedupe ? mediaIdentity.dedupeCanonicalItems(normalized) : normalized);
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
    rating: show.vote_average,
    link: `${appWithBase('/tv/show.html')}?id=${show.id}`
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
  const url = `https://storage-api.watchbilm.org/media/tmdb/tv/${tmdbId}/similar?page=${page}`;
  const data = await fetchJSON(url);
  return data?.results || [];
}

async function fetchRecommendedShows(page = 1) {
  if (!tmdbId) return [];
  const url = `https://storage-api.watchbilm.org/media/tmdb/tv/${tmdbId}/recommendations?page=${page}`;
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

function buildCurrentMediaItem(options = {}) {
  const includePlaybackNote = options?.includePlaybackNote !== false;
  if (!mediaDetails) return null;
  const provider = isAnime ? 'anilist' : 'tmdb';
  const id = Number(mediaDetails.id || 0) || 0;
  if (!id) return null;
  const item = mediaIdentity.createStoredMediaItem({
    provider,
    id,
    anilistId: provider === 'anilist' ? id : undefined,
    tmdbId: provider === 'tmdb' ? id : undefined,
    type: 'tv',
    title: mediaDetails.title,
    date: mediaDetails.firstAirDate || '',
    year: mediaDetails.year,
    poster: mediaDetails.poster,
    link: mediaDetails.link,
    updatedAt: Date.now(),
    season: currentSeason,
    episode: currentEpisode,
    source: provider === 'anilist' ? 'AniList' : 'TMDB',
    rating: mediaDetails.rating,
    certification: mediaDetails.certification || ''
  });
  if (!item) return null;
  if (includePlaybackNote) {
    const playbackNoteKey = getPlaybackNoteStorageKey(item.key, currentSeason, currentEpisode);
    const playbackNote = getPlaybackNoteValueByKey(playbackNoteKey);
    if (playbackNote) {
      item.playbackNote = playbackNote;
      item.playbackNoteUpdatedAt = Date.now();
    }
  }
  return item;
}

function syncFavoriteAndWatchLaterButtons() {
  const entry = buildCurrentMediaItem();
  if (!entry) {
    updateFavoriteButton(false);
    updateWatchLaterButton(false);
    return;
  }
  const favorites = loadList(FAVORITES_KEY);
  const watchLater = loadList(WATCH_LATER_KEY);
  updateFavoriteButton(mediaIdentity.hasIdentity(favorites, entry));
  updateWatchLaterButton(mediaIdentity.hasIdentity(watchLater, entry));
}

function toggleFavorite() {
  const entry = buildCurrentMediaItem();
  if (!entry) return;
  const items = loadList(FAVORITES_KEY);
  const existingIndex = mediaIdentity.findIndexByIdentity(items, entry);
  if (existingIndex >= 0) {
    items.splice(existingIndex, 1);
    saveList(FAVORITES_KEY, items);
    updateFavoriteButton(false);
    return;
  }
  items.unshift(entry);
  saveList(FAVORITES_KEY, items.slice(0, 60));
  updateFavoriteButton(true);
}

function toggleWatchLater() {
  const entry = buildCurrentMediaItem();
  if (!entry) return;
  const items = loadList(WATCH_LATER_KEY);
  const existingIndex = mediaIdentity.findIndexByIdentity(items, entry);
  if (existingIndex >= 0) {
    items.splice(existingIndex, 1);
    saveList(WATCH_LATER_KEY, items);
    updateWatchLaterButton(false);
    return;
  }
  items.unshift(entry);
  saveList(WATCH_LATER_KEY, items.slice(0, 60));
  updateWatchLaterButton(true);
}

function upsertContinueWatchingItem(payload) {
  const items = loadList(CONTINUE_KEY);
  const existingIndex = items.findIndex(item => item.key === payload.key);
  if (existingIndex >= 0) {
    items.splice(existingIndex, 1);
  }
  items.unshift(payload);
  saveList(CONTINUE_KEY, items);
}

function createWatchHistoryEntryId(fingerprint) {
  const seed = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const safeFingerprint = String(fingerprint || '').replace(/[^a-z0-9:_-]/gi, '-');
  return `${watchHistorySessionId}-${safeFingerprint}-${seed}`;
}

function buildWatchHistoryFingerprint(payload) {
  const key = String(payload?.key || '').trim();
  const season = Number(payload?.season || 0) || 0;
  const episode = Number(payload?.episode || 0) || 0;
  if (key) return `${key}:s${season}e${episode}`;
  const fallbackType = String(payload?.type || 'tv').trim().toLowerCase() || 'tv';
  const fallbackTitle = String(payload?.title || 'unknown').trim().toLowerCase() || 'unknown';
  return `${fallbackType}:${fallbackTitle}:s${season}e${episode}`;
}

function appendWatchHistorySessionEntry(payload) {
  const fingerprint = buildWatchHistoryFingerprint(payload);
  if (!fingerprint || watchHistorySessionFingerprints.has(fingerprint)) return;
  const items = loadList(WATCH_HISTORY_KEY);
  items.unshift({
    ...payload,
    historyEntryId: createWatchHistoryEntryId(fingerprint),
    updatedAt: Date.now()
  });
  saveList(WATCH_HISTORY_KEY, items);
  watchHistorySessionFingerprints.add(fingerprint);
}

function updateContinueWatching() {
  const settings = window.bilmTheme?.getSettings?.() || {};
  if (!continueWatchingEnabled || !mediaDetails || settings.incognito === true) return;
  const payload = buildCurrentMediaItem();
  if (!payload) return;
  payload.season = currentSeason;
  payload.episode = currentEpisode;

  upsertContinueWatchingItem(payload);
  appendWatchHistorySessionEntry(payload);
}

function loadPlaybackNotes() {
  try {
    const raw = storage.getItem(PLAYBACK_NOTE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function savePlaybackNotes(notes) {
  storage.setItem(PLAYBACK_NOTE_KEY, JSON.stringify(notes));
}

function getPlaybackNoteStorageKey(itemKey, season = currentSeason, episode = currentEpisode) {
  const normalizedItemKey = String(itemKey || '').trim();
  if (!normalizedItemKey) return '';
  const safeSeason = Math.max(1, Number.parseInt(season, 10) || 1);
  const safeEpisode = Math.max(1, Number.parseInt(episode, 10) || 1);
  return `${normalizedItemKey}-s${safeSeason}-e${safeEpisode}`;
}

function getPlaybackNoteValueByKey(key) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) return '';
  const notes = loadPlaybackNotes();
  return String(notes[normalizedKey] || '').trim();
}

function getPlaybackNoteKey() {
  const item = buildCurrentMediaItem({ includePlaybackNote: false });
  if (!item?.key) return null;
  return getPlaybackNoteStorageKey(item.key, currentSeason, currentEpisode) || null;
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
  const previousValue = String(notes[key] || '');
  const rawHours = normalizeTimeDigits(playbackNoteHoursInput.value, 3);
  const rawMinutes = normalizeTimeDigits(playbackNoteMinutesInput.value, 2);
  const minutes = rawMinutes ? String(Math.min(Number(rawMinutes), 59)).padStart(2, '0') : '';
  playbackNoteHoursInput.value = rawHours;
  playbackNoteMinutesInput.value = rawMinutes;
  const nextValue = rawHours || minutes
    ? `${rawHours || '0'}:${minutes || '00'}`
    : '';
  if (previousValue === nextValue) return;
  if (rawHours || minutes) {
    notes[key] = nextValue;
  } else {
    delete notes[key];
  }
  savePlaybackNotes(notes);
  updateContinueWatching();
  window.bilmAuth?.noteUserActivity?.('playback-note');
}

function tryEmbedMasterFullscreenCommand() {
  if (currentServer !== 'embedmaster') return;
  dispatchEmbedMasterCommand('fullscreen');
}

function getActiveFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null;
}

function doesFullscreenMatch(element) {
  if (!element) return false;
  const activeElement = getActiveFullscreenElement();
  if (!activeElement) return false;
  if (activeElement === element || element === activeElement) return true;
  if (typeof activeElement.contains === 'function' && activeElement.contains(element)) return true;
  if (typeof element.contains === 'function' && element.contains(activeElement)) return true;
  return false;
}

async function waitForFullscreenMatch(element, timeoutMs = 450) {
  const endAt = Date.now() + timeoutMs;
  while (Date.now() < endAt) {
    if (doesFullscreenMatch(element)) return true;
    await new Promise((resolve) => window.setTimeout(resolve, 32));
  }
  return doesFullscreenMatch(element);
}

async function requestElementFullscreen(element) {
  if (!element) return false;
  const requestMethod = element.requestFullscreen || element.webkitRequestFullscreen || element.msRequestFullscreen;
  if (typeof requestMethod !== 'function') return false;
  try {
    const result = requestMethod.call(element);
    if (result && typeof result.then === 'function') {
      await result;
    }
  } catch {
    return false;
  }
  if (doesFullscreenMatch(element)) return true;
  return waitForFullscreenMatch(element);
}

function setOverlayUiState(active) {
  if (closeBtn) {
    closeBtn.style.display = active ? 'block' : 'none';
  }
  navbarContainer?.classList.toggle('hide-navbar', active);
}

function enterSimulatedFullscreen() {
  if (!playerWithControls) return;
  playerWithControls.classList.add('simulated-fullscreen');
  document.body.classList.add('simulated-fullscreen-active');
  setOverlayUiState(true);
}

function exitSimulatedFullscreen() {
  playerWithControls?.classList.remove('simulated-fullscreen');
  document.body.classList.remove('simulated-fullscreen-active');
}

async function tryStartNativeFullscreen() {
  const targets = [iframe, playerContainer, playerWithControls];
  for (const target of targets) {
    if (await requestElementFullscreen(target)) {
      return true;
    }
  }
  return false;
}

async function exitNativeFullscreen() {
  try {
    if (document.exitFullscreen) {
      await document.exitFullscreen();
      return true;
    }
    if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
      return true;
    }
    if (document.msExitFullscreen) {
      document.msExitFullscreen();
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function handleFullscreenStateChange() {
  if (getActiveFullscreenElement()) {
    setOverlayUiState(true);
    return;
  }
  exitSimulatedFullscreen();
  setOverlayUiState(false);
}

fullscreenBtn.onclick = async () => {
  tryEmbedMasterFullscreenCommand();
  const fullscreenStarted = await tryStartNativeFullscreen();
  if (!fullscreenStarted) {
    enterSimulatedFullscreen();
    return;
  }
  exitSimulatedFullscreen();
  setOverlayUiState(true);
};

if (closeBtn) {
  closeBtn.onclick = async () => {
    if (getActiveFullscreenElement()) {
      await exitNativeFullscreen();
    }
    exitSimulatedFullscreen();
    if (!getActiveFullscreenElement()) {
      setOverlayUiState(false);
    } else {
      setOverlayUiState(true);
    }
  };
}

document.addEventListener('fullscreenchange', handleFullscreenStateChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenStateChange);

if (iframe) {
  iframe.addEventListener('load', () => {
    const src = String(iframe.getAttribute('src') || '').trim();
    const locationHref = readIframeLocationHref();
    const knownBlankLocation = isKnownBlankIframeLocation(locationHref);
    if (src && src !== 'about:blank' && !knownBlankLocation) {
      lastIframeLoadAtMs = Date.now();
      lastIframeLoadedSrc = src;
    }
    if (src && src !== 'about:blank' && !knownBlankLocation && playerStatus?.classList.contains('is-error')) {
      setPlayerStatus('');
    }
    if (currentServer === 'embedmaster') {
      scheduleEmbedMasterAccentSync();
    }
  });
}

const dropdownRegistry = [
  { name: 'server', button: serverBtn, dropdown: serverDropdown },
  { name: 'language', button: languageBtn, dropdown: languageDropdown },
  { name: 'subtitle', button: subtitleBtn, dropdown: subtitleDropdown }
].filter((entry) => entry?.button && entry?.dropdown);

function setDropdownOpenState(name, open) {
  const target = dropdownRegistry.find((entry) => entry.name === name);
  if (!target) return;
  target.dropdown.style.display = open ? 'flex' : 'none';
  target.button.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function closeAllDropdowns(exceptName = '') {
  dropdownRegistry.forEach((entry) => {
    if (exceptName && entry.name === exceptName) return;
    setDropdownOpenState(entry.name, false);
  });
}

function toggleDropdown(name) {
  const target = dropdownRegistry.find((entry) => entry.name === name);
  if (!target) return;
  const isOpen = target.dropdown.style.display === 'flex';
  closeAllDropdowns(isOpen ? '' : name);
  setDropdownOpenState(name, !isOpen);
}

if (serverBtn) {
  serverBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleDropdown('server');
  });
}

if (refreshBtn) {
  refreshBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    refreshCurrentServer();
  });
}

if (subtitleBtn && subtitleDropdown) {
  subtitleBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleDropdown('subtitle');
  });
}

[serverDropdown, languageDropdown, subtitleDropdown].forEach((dropdown) => {
  dropdown?.addEventListener('click', (event) => {
    event.stopPropagation();
  });
});

document.addEventListener('click', () => {
  closeAllDropdowns();
});

function setActiveServer(server) {
  visibleServerItems.forEach((i) => i.classList.toggle('active', i.getAttribute('data-server') === server));
  currentServer = server;
  if (server !== 'embedmaster') {
    embedMasterLastColorSent = '';
  }
}

// Server selection
visibleServerItems.forEach((item) => {
  item.addEventListener('click', (event) => {
    event.stopPropagation();
    if (item.classList.contains('active')) return;

    setActiveServer(item.getAttribute('data-server'));
    updateIframe();

    closeAllDropdowns();
  });
});

if (currentServer) {
  setActiveServer(normalizeServer(currentServer));
}

window.addEventListener('bilm:theme-changed', (event) => {
  const newServer = normalizeServer(isAnime ? event.detail?.animeDefaultServer : event.detail?.defaultServer);
  let shouldRefresh = false;

  if (newServer && newServer !== currentServer) {
    setActiveServer(newServer);
    shouldRefresh = true;
  }

  if (!isAnime && currentServer === 'vidking') {
    shouldRefresh = true;
  }

  if (shouldRefresh) {
    updateIframe();
  } else if (currentServer === 'embedmaster') {
    embedMasterLastColorSent = '';
    scheduleEmbedMasterAccentSync();
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

window.addEventListener('bilm:sync-applied', (event) => {
  const listKeys = Array.isArray(event?.detail?.listKeys) ? event.detail.listKeys : [];
  const storageKeys = Array.isArray(event?.detail?.storageKeys) ? event.detail.storageKeys : [];
  const relevantListKeyUpdated = listKeys.some((key) => {
    const normalized = String(key || '').trim();
    return normalized === FAVORITES_KEY
      || normalized === WATCH_LATER_KEY
      || normalized === CONTINUE_KEY
      || normalized === WATCH_HISTORY_KEY;
  });
  if (relevantListKeyUpdated) {
    syncFavoriteAndWatchLaterButtons();
  }
  if (storageKeys.some((key) => String(key || '').trim() === PLAYBACK_NOTE_KEY)) {
    loadPlaybackNote();
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


function normalizeSeasonEpisodeState() {
  currentSeason = Number.parseInt(currentSeason, 10) || 1;
  if (currentSeason < 1) currentSeason = 1;
  if (currentSeason > totalSeasons) currentSeason = totalSeasons;
  const maxEpisodes = episodesPerSeason[currentSeason] || 1;
  currentEpisode = Number.parseInt(currentEpisode, 10) || 1;
  if (currentEpisode < 1) currentEpisode = 1;
  if (currentEpisode > maxEpisodes) currentEpisode = maxEpisodes;
}

function getProgressStorageKey() {
  if (isAnime) {
    const animeNumericId = Number(animeId || 0) || 0;
    if (!animeNumericId) return '';
    return `bilm-tv-progress-anilist-${animeNumericId}`;
  }
  const tmdbNumericId = Number(tmdbId || 0) || 0;
  if (!tmdbNumericId) return '';
  return `bilm-tv-progress-tmdb-${tmdbNumericId}`;
}

function saveProgress() {
  const progressKey = getProgressStorageKey();
  if (!progressKey) return;
  normalizeSeasonEpisodeState();
  seasonEpisodeMemory[currentSeason] = currentEpisode;
  storage.setItem(progressKey, JSON.stringify({
    season: currentSeason,
    episode: currentEpisode,
    seasonEpisodes: seasonEpisodeMemory
  }));
}

function loadProgress() {
  const progressKey = getProgressStorageKey();
  if (!progressKey) return;
  const saved = storage.getItem(progressKey);
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
  normalizeSeasonEpisodeState();
  const season = currentSeason;
  const episode = currentEpisode;
  const safeLanguage = currentLanguage === 'dub' ? 'dub' : 'sub';
  if (isAnime) {
    if (!animeId) return '';
    return `https://vidnest.fun/anime/${encodeURIComponent(animeId)}/${encodeURIComponent(episode)}/${safeLanguage}`;
  }
  const safeImdbId = sanitizeImdbId(imdbId);
  if (!tmdbId && !safeImdbId) return '';
  switch (server) {
    case 'vidsrc': {
      const id = safeImdbId || tmdbId;
      return appendVidsrcSubtitleParam(`https://vidsrc-embed.ru/embed/tv/${encodeURIComponent(id)}/${encodeURIComponent(season)}-${encodeURIComponent(episode)}`);
    }
    case 'multiembed':
      return safeImdbId
        ? `https://multiembed.mov/directstream.php?video_id=${encodeURIComponent(safeImdbId)}&s=${encodeURIComponent(season)}&e=${encodeURIComponent(episode)}`
        : `https://multiembed.mov/directstream.php?video_id=${encodeURIComponent(tmdbId)}&tmdb=1&s=${encodeURIComponent(season)}&e=${encodeURIComponent(episode)}`;
    case 'vidking':
      return tmdbId
        ? appendVidKingParams(`https://www.vidking.net/embed/tv/${encodeURIComponent(tmdbId)}/${encodeURIComponent(season)}/${encodeURIComponent(episode)}`, { includeEpisodeControls: true })
        : '';
    case 'embedmaster':
      return tmdbId
        ? `https://embedmaster.link/830gqxyfskjlsnbq/tv/${encodeURIComponent(tmdbId)}/${encodeURIComponent(season)}/${encodeURIComponent(episode)}`
        : '';
    default:
      return '';
  }
}

function setPlayerStatus(message = '', tone = 'info') {
  if (!playerStatus) return;
  playerStatus.textContent = message;
  playerStatus.classList.remove('is-warning', 'is-error');
  if (tone === 'warning') playerStatus.classList.add('is-warning');
  if (tone === 'error') playerStatus.classList.add('is-error');
}

function getServerLabel(server) {
  const item = visibleServerItems.find((entry) => entry.getAttribute('data-server') === server);
  return String(item?.textContent || server || 'server').trim();
}

function resolveTvEmbedRequest() {
  const server = currentServer;
  const url = buildTvUrl(server);
  return { server, url };
}

async function loadTvEmbedUrlWithRetry({ requestId, url, server }) {
  const requestStartedAtMs = Date.now();
  const loader = window.BilmIframeLoader;
  if (!loader?.loadWithRetry) {
    iframe.removeAttribute('sandbox');
    iframe.src = url;
    if (server === 'embedmaster') {
      scheduleEmbedMasterAccentSync();
    }
    return;
  }

  const serverLabel = getServerLabel(server);
  const result = await loader.loadWithRetry({
    iframe,
    url,
    timeoutScheduleMs: EMBED_LOAD_TIMEOUTS_MS,
    timeoutGraceMs: EMBED_LOAD_TIMEOUT_GRACE_MS,
    lateLoadWindowMs: EMBED_LOAD_LATE_WINDOW_MS,
    isCancelled: () => requestId !== iframeLoadRequestId,
    onAttempt: ({ attempt, timeoutMs }) => {
      console.info('[player] load attempt', {
        context: 'tv',
        server,
        attempt,
        timeoutMs
      });
      setPlayerStatus(`Loading ${serverLabel} (attempt ${attempt}/${EMBED_LOAD_TIMEOUTS_MS.length})…`);
    },
    onSuccess: ({ attempt }) => {
      markServerHealth(server, true, 'success');
      console.info('[player] load success', {
        context: 'tv',
        server,
        attempt
      });
    },
    onLateSuccess: ({ attempt }) => {
      markServerHealth(server, true, 'late-success');
      console.info('[player] late load recovered', {
        context: 'tv',
        server,
        attempt
      });
    },
    onFailure: ({ attempt, reason, timeoutMs }) => {
      markServerHealth(server, false, reason);
      console.warn('[player] load failure', {
        context: 'tv',
        server,
        attempt,
        reason,
        timeoutMs
      });
    }
  });

  if (requestId !== iframeLoadRequestId || result?.cancelled) return;
  if (result?.ok) {
    setPlayerStatus('');
    if (server === 'embedmaster') {
      scheduleEmbedMasterAccentSync();
    }
    return;
  }

  const reconciledFromLoadEvent = lastIframeLoadAtMs >= requestStartedAtMs
    && normalizeEmbedUrlForCompare(lastIframeLoadedSrc || iframe?.getAttribute('src') || '')
      .startsWith(normalizeEmbedUrlForCompare(url));
  if (reconciledFromLoadEvent) {
    markServerHealth(server, true, 'reconciled-load');
    setPlayerStatus('');
    if (server === 'embedmaster') {
      scheduleEmbedMasterAccentSync();
    }
    return;
  }

  setPlayerStatus(`We couldn't load ${serverLabel}. Tap refresh or choose another server.`, 'error');
  console.error('[player] load exhausted', {
    context: 'tv',
    server,
    attempts: EMBED_LOAD_TIMEOUTS_MS.length
  });
}

function dispatchEmbedMasterCommand(command, value = null) {
  const embedWindow = iframe?.contentWindow;
  if (!embedWindow) return;
  const safeCommand = String(command || '').trim();
  if (!safeCommand || !EMBEDMASTER_ALLOWED_COMMANDS.has(safeCommand)) return;
  const safeValue = value == null ? '' : String(value);
  const hasValue = safeValue.length > 0;
  const targetOrigin = getEmbedMessageTargetOrigin();
  if (!targetOrigin) return;

  try {
    if (typeof embedWindow.sendCommand === 'function') {
      if (hasValue) {
        embedWindow.sendCommand(safeCommand, safeValue);
      } else {
        embedWindow.sendCommand(safeCommand);
      }
    }
  } catch {
    // Cross-origin iframe access can fail.
  }

  const commandPayload = safeValue
    ? { command: safeCommand, value: safeValue }
    : { command: safeCommand };
  const apiCommandPayload = safeValue
    ? { api: 'command', cmd: safeCommand, val: safeValue }
    : { api: 'command', cmd: safeCommand };
  const shortPayload = safeValue
    ? { cmd: safeCommand, val: safeValue }
    : { cmd: safeCommand };
  [commandPayload, apiCommandPayload, shortPayload].forEach((payload) => {
    embedWindow.postMessage(payload, targetOrigin);
    embedWindow.postMessage(JSON.stringify(payload), targetOrigin);
  });
  if (hasValue) {
    embedWindow.postMessage(`${safeCommand}:${safeValue}`, targetOrigin);
    embedWindow.postMessage(`sendCommand('${safeCommand}','${safeValue}')`, targetOrigin);
  } else {
    embedWindow.postMessage(safeCommand, targetOrigin);
    embedWindow.postMessage(`sendCommand('${safeCommand}')`, targetOrigin);
  }
}

function scheduleEmbedMasterAccentSync() {
  if (currentServer !== 'embedmaster') return;
  embedMasterLastColorSent = '';
  EMBED_MASTER_COLOR_RETRY_SCHEDULE_MS.forEach((delayMs) => {
    window.setTimeout(() => {
      applyEmbedMasterAccentColor();
    }, delayMs);
  });
}

function applyEmbedMasterAccentColor() {
  if (currentServer !== 'embedmaster') return;
  const accentHexWithoutHash = getCurrentAccentHexWithoutHash();
  if (!accentHexWithoutHash) return;
  if (embedMasterLastColorSent === accentHexWithoutHash) return;
  embedMasterLastColorSent = accentHexWithoutHash;
  dispatchEmbedMasterCommand('color1', accentHexWithoutHash);
  window.setTimeout(() => {
    dispatchEmbedMasterCommand('color1', `#${accentHexWithoutHash}`);
  }, 120);
}

function updateIframe() {
  normalizeSeasonEpisodeState();
  saveProgress();

  const idToUse = isAnime ? animeId : (imdbId || tmdbId);
  if (!idToUse) {
    console.warn('No valid ID for embed URL.');
    iframe.removeAttribute('sandbox');
    iframe.src = '';
    setPlayerStatus('Missing episode ID. Open this show again from the catalog.', 'error');
    return;
  }

  const { server, url } = resolveTvEmbedRequest();
  if (!url) {
    iframe.removeAttribute('sandbox');
    iframe.src = '';
    setPlayerStatus('No playable URL for this episode on the selected server.', 'error');
    return;
  }

  const requestId = ++iframeLoadRequestId;
  void loadTvEmbedUrlWithRetry({ requestId, url, server });

  if (continueWatchingReady) {
    updateContinueWatching();
  }

  loadPlaybackNote();
}

function refreshCurrentServer() {
  if (!currentServer) {
    setPlayerStatus('Select a server before refreshing.', 'warning');
    return;
  }
  markServerHealth(currentServer, true, 'manual-refresh');
  setPlayerStatus(`Refreshing ${getServerLabel(currentServer)}…`);
  closeAllDropdowns();
  updateIframe();
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
  normalizeSeasonEpisodeState();
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
  updateSeasonSelection(parseInt(seasonSelect.value, 10) || 1);
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
  currentEpisode = parseInt(episodeSelect.value, 10) || 1;
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
  if (isAnime) {
    if (!animeId) {
      mediaTitle.textContent = 'Unknown anime';
      mediaMeta.textContent = 'Anime id unavailable';
      updateIframe();
      return;
    }

    const query = `
      query ($id: Int!) {
        Media(id: $id, type: ANIME) {
          id
          title { romaji english }
          coverImage { large medium }
          startDate { year month day }
          averageScore
          episodes
        }
      }
    `;

    const payload = await postJSON(
      'https://storage-api.watchbilm.org/media/anilist',
      { query, variables: { id: Number(animeId) } },
      { timeoutMs: METADATA_FETCH_TIMEOUT_MS }
    );
    const details = payload?.data?.Media;
    const title = details?.title?.english || details?.title?.romaji || 'Unknown anime';
    const year = details?.startDate?.year || 'N/A';
    mediaTitle.textContent = title;
    mediaMeta.textContent = `${year} • Anime`;
    document.title = `Bilm 💜 - ${title}`;

    totalSeasons = 1;
    const episodeCount = Math.max(1, Number(details?.episodes) || Number(params.get('episodes')) || 1);
    episodesPerSeason = { 1: episodeCount };
    currentSeason = 1;
    currentEpisode = Math.max(1, Number(params.get('episode')) || 1);
    if (currentEpisode > episodeCount) currentEpisode = episodeCount;

    populateSeasons(totalSeasons);
    populateEpisodes(episodeCount);
    updateControls();
    loadProgress();

    mediaDetails = {
      id: Number(animeId || 0) || 0,
      title,
      firstAirDate: '',
      year,
      poster: details?.coverImage?.large || details?.coverImage?.medium || 'https://via.placeholder.com/140x210?text=No+Image',
      link: `${appWithBase('/tv/show.html')}?anime=1&aid=${encodeURIComponent(animeId)}&type=tv`,
      rating: details?.averageScore ? details.averageScore / 10 : null,
      certification: 'N/A',
      genreIds: [],
      genreSlugs: [],
      provider: 'anilist'
    };

    syncFavoriteAndWatchLaterButtons();
    loadPlaybackNote();
    updateIframe();
    startContinueWatchingTimer();
    if (moreLikeBox) moreLikeBox.style.display = 'none';
    return;
  }

  if (!tmdbId) {
    mediaTitle.textContent = 'Unknown title';
    mediaMeta.textContent = 'Release date unavailable';
    updateIframe();
    return;
  }

  try {
    // First get external IDs (like imdb_id)
    const [externalResult, contentRatingsResult] = await Promise.allSettled([
      fetchJSON(`https://storage-api.watchbilm.org/media/tmdb/tv/${tmdbId}/external_ids`, { timeoutMs: METADATA_FETCH_TIMEOUT_MS }),
      fetchJSON(`https://storage-api.watchbilm.org/media/tmdb/tv/${tmdbId}/content_ratings`, { timeoutMs: METADATA_FETCH_TIMEOUT_MS })
    ]);
    const externalData = externalResult.status === 'fulfilled' ? externalResult.value : null;
    const contentRatings = contentRatingsResult.status === 'fulfilled' ? contentRatingsResult.value : null;
    imdbId = sanitizeImdbId(externalData?.imdb_id) || null;
    const certification = pickShowCertification(contentRatings?.results);

    // Get season info
    const details = await fetchJSON(`https://storage-api.watchbilm.org/media/tmdb/tv/${tmdbId}`, { timeoutMs: METADATA_FETCH_TIMEOUT_MS });
    if (!details) {
      mediaTitle.textContent = 'Unknown title';
      mediaMeta.textContent = 'Release date unavailable';
      totalSeasons = 1;
      episodesPerSeason = { 1: 1 };
      populateSeasons(totalSeasons);
      populateEpisodes(episodesPerSeason[1]);
      updateControls();
      updateIframe();
      startContinueWatchingTimer();
      return;
    }

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
      id: Number(tmdbId || 0) || 0,
      tmdbId: Number(tmdbId || 0) || 0,
      title: showTitle,
      firstAirDate,
      year,
      poster,
      rating: details.vote_average,
      genreIds: details.genres?.map(genre => genre.id) || [],
      genreSlugs: details.genres?.map(genre => toSlug(genre.name)) || [],
      link: `${appWithBase('/tv/show.html')}?id=${encodeURIComponent(tmdbId)}`,
      certification,
      provider: 'tmdb'
    };

    syncFavoriteAndWatchLaterButtons();
    mediaTitle.textContent = showTitle;
    mediaMeta.textContent = displayDate;
    document.title = `Bilm 💜 - ${showTitle}`;

    episodesPerSeason = {};
    (details.seasons || []).forEach(season => {
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
    mediaTitle.textContent = 'Unknown title';
    mediaMeta.textContent = 'Release date unavailable';
    totalSeasons = 1;
    episodesPerSeason = { 1: 1 };
    currentSeason = 1;
    currentEpisode = 1;
    seasonEpisodeMemory = { 1: 1 };
    populateSeasons(totalSeasons);
    populateEpisodes(episodesPerSeason[1]);
    updateControls();
    mediaDetails = {
      id: Number(tmdbId || 0) || 0,
      tmdbId: Number(tmdbId || 0) || 0,
      title: 'Unknown title',
      firstAirDate: '',
      year: 'N/A',
      poster: 'https://via.placeholder.com/140x210?text=No+Image',
      rating: null,
      genreIds: [],
      genreSlugs: [],
      link: `${appWithBase('/tv/show.html')}?id=${encodeURIComponent(tmdbId)}`,
      certification: '',
      provider: 'tmdb'
    };
    syncFavoriteAndWatchLaterButtons();
    loadPlaybackNote();
    updateIframe();
    startContinueWatchingTimer();
    if (moreLikeStatus) {
      setMoreLikeStatus('Recommendations unavailable right now.');
    }
  }
}

fetchTMDBData();

function setActiveLanguage(language) {
  currentLanguage = language === 'dub' ? 'dub' : 'sub';
  languageItems.forEach(i => i.classList.toggle('active', i.getAttribute('data-language') === currentLanguage));
}

function setActiveSubtitle(subtitle) {
  if (isAnime) {
    currentSubtitle = 'off';
    subtitleItems.forEach((item) => {
      item.classList.toggle('active', item.getAttribute('data-subtitle') === 'off');
    });
    return;
  }
  const normalized = String(subtitle || '').trim().toLowerCase();
  currentSubtitle = ['off', 'en', 'es', 'fr'].includes(normalized) ? normalized : 'off';
  subtitleItems.forEach((item) => {
    item.classList.toggle('active', item.getAttribute('data-subtitle') === currentSubtitle);
  });
}

if (languageBtn && languageDropdown) {
  languageBtn.style.display = isAnime ? 'flex' : 'none';
  languageBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleDropdown('language');
  });
  languageItems.forEach((item) => {
    item.addEventListener('click', (event) => {
      event.stopPropagation();
      setActiveLanguage(item.getAttribute('data-language'));
      updateIframe();
      closeAllDropdowns();
    });
  });
  setActiveLanguage(currentLanguage);
}

if (subtitleBtn && subtitleDropdown) {
  subtitleBtn.style.display = isAnime ? 'none' : 'flex';
  subtitleItems.forEach((item) => {
    item.addEventListener('click', (event) => {
      event.stopPropagation();
      const previousSubtitle = currentSubtitle;
      setActiveSubtitle(item.getAttribute('data-subtitle'));
      if (!isAnime && currentServer === 'vidsrc' && currentSubtitle !== previousSubtitle) {
        updateIframe();
      }
      closeAllDropdowns();
    });
  });
  setActiveSubtitle('off');
}
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
