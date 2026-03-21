const gameStoreKey = 'bilm:games:selection';
const favoritesStorageKey = 'bilm:games:favorites:v1';
const recentStorageKey = 'bilm:games:recent:v1';
const maxRecentItems = 30;

const placeholderSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200"><rect width="320" height="200" fill="#1f1f28"/><text x="50%" y="50%" font-size="22" font-family="Poppins, sans-serif" fill="#9ca3af" text-anchor="middle" dominant-baseline="middle">Game</text></svg>`;
const placeholderImage = `data:image/svg+xml,${encodeURIComponent(placeholderSvg)}`;
const allowedFrameDomains = ['onlinegames.io'];

const elements = {
  title: document.getElementById('gameTitle'),
  description: document.getElementById('gameDescription'),
  frame: document.getElementById('gameFrame'),
  poster: document.getElementById('gamePoster'),
  openSource: document.getElementById('openSource'),
  reloadGame: document.getElementById('reloadGame'),
  fullscreenGame: document.getElementById('fullscreenGame'),
  copyShare: document.getElementById('copyShare'),
  favoriteGame: document.getElementById('favoriteGame'),
  gameMeta: document.getElementById('gameMeta'),
  gameCategory: document.getElementById('gameCategory'),
  gameSource: document.getElementById('gameSource'),
  empty: document.getElementById('playEmpty'),
  content: document.getElementById('playContent'),
  recentWrap: document.getElementById('recentWrap'),
  recentList: document.getElementById('recentList')
};

const state = {
  activeGame: null,
  favorites: new Set()
};

const safeJsonParse = (raw, fallback) => {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const readLocalJson = (key, fallback) => {
  try {
    return safeJsonParse(localStorage.getItem(key) || '', fallback);
  } catch {
    return fallback;
  }
};

const writeLocalJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage write failures.
  }
};

const formatTag = (value) => String(value || '')
  .trim()
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .replace(/\b\w/g, (char) => char.toUpperCase());

const createGameIdFromGame = (game) => {
  const title = String(game?.title || 'game');
  const source = [title, game?.url || '', game?.embedMarkup || ''].join('|');
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 30) || 'game';
  return `${slug}-${(hash >>> 0).toString(16)}`;
};

const getStoredGames = () => {
  try {
    const stored = sessionStorage.getItem(gameStoreKey);
    return stored ? safeJsonParse(stored, {}) : {};
  } catch (error) {
    console.warn('Unable to read stored games', error);
    return {};
  }
};

const setStoredGames = (games) => {
  try {
    sessionStorage.setItem(gameStoreKey, JSON.stringify(games));
  } catch (error) {
    console.warn('Unable to save game map', error);
  }
};

const saveGameSelection = (game) => {
  const stored = getStoredGames();
  const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `game-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  stored[id] = game;
  setStoredGames(stored);
  return id;
};

const extractEmbedSrc = (embedMarkup) => {
  if (!embedMarkup) return '';
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(embedMarkup, 'text/html');
    const iframe = doc.querySelector('iframe');
    return iframe?.src || '';
  } catch (error) {
    console.warn('Unable to parse embed HTML', error);
    return '';
  }
};

const isSafeFrameUrl = (urlValue) => {
  try {
    const url = new URL(String(urlValue || ''), window.location.origin);
    if (url.protocol !== 'https:') return false;
    return allowedFrameDomains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
};

const createSafeFrame = (src, title) => {
  if (!isSafeFrameUrl(src)) return null;
  const iframe = document.createElement('iframe');
  iframe.src = src;
  iframe.title = title || 'Game';
  iframe.loading = 'lazy';
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = 'no-referrer';
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-pointer-lock');
  return iframe;
};

const getQueryParams = () => new URLSearchParams(window.location.search);

const buildGameFromParams = () => {
  const params = getQueryParams();
  const title = String(params.get('title') || '').trim();
  const description = String(params.get('description') || '').trim();
  const image = String(params.get('image') || '').trim();
  const url = String(params.get('url') || '').trim();
  const embedMarkup = String(params.get('embed') || '').trim();
  const category = String(params.get('category') || '').trim();
  const tags = String(params.get('tags') || '')
    .split(',')
    .map((tag) => formatTag(tag))
    .filter(Boolean);

  if (!title && !url && !embedMarkup) return null;

  return {
    id: createGameIdFromGame({ title, url, embedMarkup }),
    title: title || 'Game',
    description,
    image,
    url,
    embedMarkup,
    category: category || 'General',
    tags
  };
};

const showEmpty = (message) => {
  if (elements.empty) elements.empty.hidden = false;
  if (elements.content) elements.content.hidden = true;
  if (message && elements.empty) {
    const paragraph = elements.empty.querySelector('p');
    if (paragraph) paragraph.textContent = message;
  }
};

const readFavorites = () => {
  const entries = readLocalJson(favoritesStorageKey, []);
  state.favorites = new Set(Array.isArray(entries) ? entries.map((item) => String(item)) : []);
};

const writeFavorites = () => {
  writeLocalJson(favoritesStorageKey, Array.from(state.favorites));
};

const setFavoriteButton = () => {
  if (!elements.favoriteGame || !state.activeGame) return;
  const isFavorite = state.favorites.has(state.activeGame.id);
  elements.favoriteGame.textContent = isFavorite ? 'Remove favorite' : 'Add to favorites';
  elements.favoriteGame.setAttribute('aria-pressed', String(isFavorite));
};

const toggleFavorite = () => {
  if (!state.activeGame) return;
  if (state.favorites.has(state.activeGame.id)) {
    state.favorites.delete(state.activeGame.id);
  } else {
    state.favorites.add(state.activeGame.id);
  }
  writeFavorites();
  setFavoriteButton();
};

const readRecent = () => readLocalJson(recentStorageKey, [])
  .filter((item) => item && typeof item === 'object')
  .map((item) => ({
    ...item,
    id: String(item.id || createGameIdFromGame(item)),
    title: String(item.title || ''),
    image: String(item.image || placeholderImage),
    url: String(item.url || ''),
    embedMarkup: String(item.embedMarkup || ''),
    description: String(item.description || ''),
    category: String(item.category || ''),
    tags: Array.isArray(item.tags) ? item.tags.map((tag) => formatTag(tag)).filter(Boolean).slice(0, 8) : [],
    playedAt: Number(item.playedAt || 0)
  }))
  .filter((item) => item.id && item.title && item.playedAt > 0)
  .sort((a, b) => b.playedAt - a.playedAt)
  .slice(0, maxRecentItems);

const rememberRecentPlay = (game) => {
  const recent = readRecent();
  const entry = {
    id: game.id,
    title: game.title,
    image: game.image || placeholderImage,
    url: game.url || '',
    embedMarkup: game.embedMarkup || '',
    description: game.description || '',
    category: game.category || 'General',
    tags: Array.isArray(game.tags) ? game.tags.slice(0, 8) : [],
    playedAt: Date.now()
  };
  const next = [entry, ...recent.filter((item) => item.id !== game.id)].slice(0, maxRecentItems);
  writeLocalJson(recentStorageKey, next);
};

const navigateToGame = (game) => {
  const id = saveGameSelection(game);
  window.location.href = `./play.html?game=${encodeURIComponent(id)}`;
};

const renderRecent = () => {
  if (!elements.recentWrap || !elements.recentList || !state.activeGame) return;
  const recent = readRecent().filter((item) => item.id !== state.activeGame.id).slice(0, 8);
  elements.recentList.innerHTML = '';
  elements.recentWrap.hidden = recent.length === 0;
  recent.forEach((game) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'play-list-card';
    button.title = `Play ${game.title}`;
    button.addEventListener('click', () => navigateToGame(game));

    const image = document.createElement('img');
    image.src = game.image || placeholderImage;
    image.alt = game.title;
    image.loading = 'lazy';

    const title = document.createElement('p');
    title.textContent = game.title;

    button.append(image, title);
    elements.recentList.appendChild(button);
  });
};

const renderMeta = (game, sourceUrl) => {
  if (elements.gameMeta) {
    elements.gameMeta.innerHTML = '';
    const tags = [
      game.category || 'General',
      ...(Array.isArray(game.tags) ? game.tags.slice(0, 4) : [])
    ].filter(Boolean);
    tags.forEach((tag) => {
      const pill = document.createElement('span');
      pill.className = 'play-meta-pill';
      pill.textContent = tag;
      elements.gameMeta.appendChild(pill);
    });
  }

  if (elements.gameCategory) elements.gameCategory.textContent = game.category || 'General';
  if (elements.gameSource) {
    if (!sourceUrl) {
      elements.gameSource.textContent = 'Unknown';
    } else {
      try {
        elements.gameSource.textContent = new URL(sourceUrl).hostname;
      } catch {
        elements.gameSource.textContent = sourceUrl;
      }
    }
  }
};

const buildShareUrl = (game) => {
  const shareUrl = new URL(window.location.href);
  shareUrl.search = '';
  shareUrl.searchParams.set('title', game.title || 'Game');
  if (game.description) shareUrl.searchParams.set('description', game.description.slice(0, 160));
  if (game.image) shareUrl.searchParams.set('image', game.image);
  if (game.url) shareUrl.searchParams.set('url', game.url);
  if (game.category) shareUrl.searchParams.set('category', game.category);
  if (Array.isArray(game.tags) && game.tags.length) shareUrl.searchParams.set('tags', game.tags.join(','));
  return shareUrl.toString();
};

const copyText = async (text) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const temp = document.createElement('textarea');
  temp.value = text;
  temp.style.position = 'fixed';
  temp.style.opacity = '0';
  document.body.appendChild(temp);
  temp.select();
  try {
    document.execCommand('copy');
    return true;
  } catch {
    return false;
  } finally {
    temp.remove();
  }
};

const attachFrameControls = (sourceUrl) => {
  const getFrame = () => elements.frame?.querySelector('iframe');

  if (elements.openSource) {
    if (sourceUrl) {
      elements.openSource.disabled = false;
      elements.openSource.onclick = () => {
        window.open(sourceUrl, '_blank', 'noopener');
      };
    } else {
      elements.openSource.disabled = true;
      elements.openSource.onclick = null;
    }
  }

  if (elements.reloadGame) {
    elements.reloadGame.onclick = () => {
      const iframe = getFrame();
      if (!iframe) return;
      iframe.src = iframe.src;
    };
  }

  if (elements.fullscreenGame) {
    elements.fullscreenGame.onclick = async () => {
      const iframe = getFrame();
      const target = iframe || elements.frame;
      if (!target?.requestFullscreen) return;
      try {
        await target.requestFullscreen();
      } catch (error) {
        console.warn('Fullscreen request failed', error);
      }
    };
  }
};

const loadGame = () => {
  const params = getQueryParams();
  const gameId = params.get('game');
  const stored = getStoredGames();
  const game = (gameId && stored[gameId]) || buildGameFromParams();

  if (!game) {
    showEmpty();
    return;
  }

  const normalizedGame = {
    ...game,
    id: game.id || createGameIdFromGame(game),
    title: game.title || 'Game',
    description: game.description || '',
    image: game.image || placeholderImage,
    url: game.url || '',
    embedMarkup: game.embedMarkup || '',
    category: game.category || 'General',
    tags: Array.isArray(game.tags) ? game.tags.map((tag) => formatTag(tag)).filter(Boolean).slice(0, 8) : []
  };

  state.activeGame = normalizedGame;
  readFavorites();

  if (elements.title) elements.title.textContent = normalizedGame.title;
  if (elements.description) {
    elements.description.textContent = normalizedGame.description || 'Pick up where you left off and keep playing.';
  }
  if (elements.poster) {
    elements.poster.src = normalizedGame.image || placeholderImage;
    elements.poster.alt = normalizedGame.title;
  }

  const embedSrc = extractEmbedSrc(normalizedGame.embedMarkup);
  const sourceUrl = embedSrc || normalizedGame.url;
  renderMeta(normalizedGame, sourceUrl);

  if (elements.frame) {
    elements.frame.textContent = '';
    const safeFrame = createSafeFrame(sourceUrl, normalizedGame.title);
    if (safeFrame) {
      elements.frame.appendChild(safeFrame);
    } else {
      elements.frame.textContent = sourceUrl
        ? 'This game source is blocked for safety on the in-page player.'
        : 'Game unavailable.';
    }
  }

  const openUrl = isSafeFrameUrl(sourceUrl) ? sourceUrl : '';
  attachFrameControls(openUrl);
  setFavoriteButton();
  rememberRecentPlay(normalizedGame);
  renderRecent();
};

if (elements.favoriteGame) {
  elements.favoriteGame.addEventListener('click', () => {
    toggleFavorite();
  });
}

if (elements.copyShare) {
  elements.copyShare.addEventListener('click', async () => {
    if (!state.activeGame) return;
    const shareUrl = buildShareUrl(state.activeGame);
    const success = await copyText(shareUrl);
    const defaultLabel = 'Copy share link';
    elements.copyShare.textContent = success ? 'Copied!' : 'Copy failed';
    window.setTimeout(() => {
      if (elements.copyShare) elements.copyShare.textContent = defaultLabel;
    }, 1400);
  });
}

loadGame();
