const gameStoreKey = 'bilm:games:selection';
const placeholderSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="300" height="200" fill="#1f1f28"/><text x="50%" y="50%" font-size="22" font-family="Poppins, sans-serif" fill="#9ca3af" text-anchor="middle" dominant-baseline="middle">Game</text></svg>`;
const placeholderImage = `data:image/svg+xml,${encodeURIComponent(placeholderSvg)}`;
const allowedFrameHosts = new Set([
  'www.onlinegames.io',
  'onlinegames.io'
]);

const elements = {
  title: document.getElementById('gameTitle'),
  description: document.getElementById('gameDescription'),
  frame: document.getElementById('gameFrame'),
  poster: document.getElementById('gamePoster'),
  openSource: document.getElementById('openSource'),
  reloadGame: document.getElementById('reloadGame'),
  fullscreenGame: document.getElementById('fullscreenGame'),
  empty: document.getElementById('playEmpty'),
  content: document.getElementById('playContent')
};

const getStoredGames = () => {
  try {
    const stored = sessionStorage.getItem(gameStoreKey);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.warn('Unable to read stored games', error);
    return {};
  }
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
    return url.protocol === 'https:' && allowedFrameHosts.has(url.hostname);
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
  const title = params.get('title');
  const description = params.get('description');
  const image = params.get('image');
  const embedMarkup = params.get('embed');
  const url = params.get('url');

  if (!title && !embedMarkup && !url) return null;

  return {
    title: title || 'Game',
    description: description || '',
    image: image || '',
    embedMarkup: embedMarkup ? decodeURIComponent(embedMarkup) : '',
    url: url ? decodeURIComponent(url) : ''
  };
};

const showEmpty = () => {
  elements.empty.hidden = false;
  if (elements.content) elements.content.hidden = true;
};

const attachFrameControls = (openUrl) => {
  const getFrame = () => elements.frame?.querySelector('iframe');

  if (elements.openSource) {
    if (openUrl) {
      elements.openSource.addEventListener('click', () => {
        window.open(openUrl, '_blank', 'noopener');
      });
    } else {
      elements.openSource.disabled = true;
    }
  }

  if (elements.reloadGame) {
    elements.reloadGame.addEventListener('click', () => {
      const iframe = getFrame();
      if (!iframe) return;
      iframe.src = iframe.src;
    });
  }

  if (elements.fullscreenGame) {
    elements.fullscreenGame.addEventListener('click', async () => {
      const iframe = getFrame();
      const target = iframe || elements.frame;
      if (!target?.requestFullscreen) return;
      try {
        await target.requestFullscreen();
      } catch (error) {
        console.warn('Fullscreen request failed', error);
      }
    });
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

  if (elements.title) elements.title.textContent = game.title;
  if (elements.description) {
    elements.description.textContent = game.description || 'Pick up where you left off and start playing.';
  }
  if (elements.poster) {
    elements.poster.src = game.image || placeholderImage;
    elements.poster.alt = game.title;
  }

  const embedMarkup = game.embedMarkup || '';
  const embedSrc = extractEmbedSrc(embedMarkup);
  const sourceUrl = embedSrc || game.url;
  if (elements.frame) {
    elements.frame.textContent = '';
    const safeFrame = createSafeFrame(sourceUrl, game.title);
    if (safeFrame) {
      elements.frame.appendChild(safeFrame);
    } else {
      elements.frame.textContent = 'Game unavailable.';
    }
  }

  const openUrl = isSafeFrameUrl(sourceUrl) ? sourceUrl : '';
  attachFrameControls(openUrl);
};

loadGame();
