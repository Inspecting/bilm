const gameStoreKey = 'bilm:games:selection';
const placeholderSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="300" height="200" fill="#1f1f28"/><text x="50%" y="50%" font-size="22" font-family="Poppins, sans-serif" fill="#9ca3af" text-anchor="middle" dominant-baseline="middle">Game</text></svg>`;
const placeholderImage = `data:image/svg+xml,${encodeURIComponent(placeholderSvg)}`;

const elements = {
  title: document.getElementById('gameTitle'),
  description: document.getElementById('gameDescription'),
  frame: document.getElementById('gameFrame'),
  poster: document.getElementById('gamePoster'),
  openSource: document.getElementById('openSource'),
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

const loadGame = () => {
  const params = getQueryParams();
  const gameId = params.get('game');
  const stored = getStoredGames();
  const game = (gameId && stored[gameId]) || buildGameFromParams();

  if (!game) {
    elements.empty.hidden = false;
    if (elements.content) elements.content.hidden = true;
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

  const embedMarkup = game.embedMarkup || (game.url ? `<iframe src="${game.url}" title="${game.title}" loading="lazy" allowfullscreen></iframe>` : '');
  if (elements.frame) {
    elements.frame.innerHTML = embedMarkup || '<p>Game unavailable.</p>';
  }

  const openUrl = extractEmbedSrc(embedMarkup) || game.url;
  if (elements.openSource) {
    if (openUrl) {
      elements.openSource.addEventListener('click', () => {
        window.open(openUrl, '_blank', 'noopener');
      });
    } else {
      elements.openSource.disabled = true;
    }
  }
};

loadGame();
