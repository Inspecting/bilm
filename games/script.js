const catalogUrl = 'https://www.onlinegames.io/media/plugins/genGames/embed.json';
const fallbackCatalogUrl = 'catalog.json';
const placeholderSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="300" height="200" fill="#1f1f28"/><text x="50%" y="50%" font-size="22" font-family="Poppins, sans-serif" fill="#9ca3af" text-anchor="middle" dominant-baseline="middle">Game</text></svg>`;
const placeholderImage = `data:image/svg+xml,${encodeURIComponent(placeholderSvg)}`;

const elements = {
  status: document.getElementById('gameStatus'),
  sections: document.getElementById('gameSections'),
  empty: document.getElementById('gameEmpty')
};

const normalizeGames = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.games)) return data.games;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items;
  if (data && typeof data === 'object') {
    const values = Object.values(data).filter((value) => Array.isArray(value));
    if (values.length === 1) return values[0];
  }
  return [];
};

const buildEmbedMarkup = (embed, title) => {
  if (!embed || typeof embed !== 'string') return '';
  const trimmed = embed.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('<')) return trimmed;
  const safeTitle = title?.replace(/"/g, '') || 'Game';
  return `<iframe src="${trimmed}" title="${safeTitle}" loading="lazy" allowfullscreen></iframe>`;
};

const extractEmbedSrc = (embedMarkup) => {
  if (!embedMarkup) return '';
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(embedMarkup, 'text/html');
    const iframe = doc.querySelector('iframe');
    if (iframe?.src) return iframe.src;
  } catch (error) {
    console.warn('Unable to parse embed HTML', error);
  }
  return '';
};

const normalizeEntry = (entry, index) => {
  const title = entry?.title || entry?.name || entry?.game || entry?.label || `Game ${index + 1}`;
  const image = entry?.image || entry?.thumb || entry?.thumbnail || entry?.imageUrl || entry?.thumbUrl || entry?.cover || placeholderImage;
  const embedMarkup = buildEmbedMarkup(entry?.embed || entry?.iframe || entry?.embedHtml || entry?.embedCode, title);
  const embedSrc = extractEmbedSrc(embedMarkup);
  const url = entry?.url || entry?.link || entry?.playUrl || entry?.gameUrl || entry?.embedUrl || entry?.href || embedSrc || '';
  const category = entry?.category || entry?.genre || entry?.group || (Array.isArray(entry?.tags) ? entry.tags[0] : null);
  const description = entry?.description || entry?.about || entry?.summary || '';
  return {
    title,
    image,
    url,
    embedMarkup,
    category: category ? String(category) : null,
    description: description ? String(description) : ''
  };
};

const gameStoreKey = 'bilm:games:selection';

const getStoredGames = () => {
  try {
    const stored = sessionStorage.getItem(gameStoreKey);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.warn('Unable to read stored games', error);
    return {};
  }
};

const setStoredGames = (games) => {
  try {
    sessionStorage.setItem(gameStoreKey, JSON.stringify(games));
  } catch (error) {
    console.warn('Unable to save game', error);
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

const createCard = (game) => {
  const playable = Boolean(game.embedMarkup || game.url);
  const card = document.createElement('button');
  card.className = 'game-card';
  card.type = 'button';
  if (playable) {
    card.addEventListener('click', () => {
      const id = saveGameSelection(game);
      window.location.href = `./play.html?game=${encodeURIComponent(id)}`;
    });
  } else {
    card.classList.add('is-disabled');
    card.setAttribute('aria-disabled', 'true');
    card.disabled = true;
  }

  const image = document.createElement('img');
  image.src = game.image || placeholderImage;
  image.alt = game.title;
  image.loading = 'lazy';

  const title = document.createElement('p');
  title.textContent = game.title;

  card.append(image, title);
  return card;
};

const renderSections = (games) => {
  elements.sections.innerHTML = '';
  if (!games.length) {
    elements.empty.hidden = false;
    return;
  }

  elements.empty.hidden = true;
  const hasCategories = games.some((game) => Boolean(game.category));
  const grouped = new Map();

  games.forEach((game) => {
    const key = hasCategories && game.category ? game.category : 'All Games';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(game);
  });

  for (const [category, items] of grouped.entries()) {
    const section = document.createElement('section');
    section.className = 'section';

    const title = document.createElement('h2');
    title.className = 'section-title';
    title.textContent = category;

    const grid = document.createElement('div');
    grid.className = 'section-grid';

    items.forEach((game) => grid.appendChild(createCard(game)));

    section.append(title, grid);
    elements.sections.appendChild(section);
  }
};

const setStatus = (text) => {
  if (elements.status) elements.status.textContent = text;
};

const fetchCatalog = async (url) => {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to load catalog: ${url}`);
  return response.json();
};

const loadGames = async () => {
  const sources = [catalogUrl, fallbackCatalogUrl];
  let lastError = null;

  for (const source of sources) {
    try {
      const data = await fetchCatalog(source);
      const entries = normalizeGames(data).map(normalizeEntry).filter((game) => game.title);
      if (entries.length) {
        const label = source === catalogUrl ? 'Live catalog' : 'Backup catalog';
        setStatus(`${entries.length} games loaded · ${label}`);
        renderSections(entries);
        return;
      }
      lastError = new Error(`Catalog ${source} returned no games`);
    } catch (error) {
      lastError = error;
      console.warn(error);
    }
  }

  console.error(lastError);
  setStatus('Unable to load games right now');
  elements.empty.hidden = false;
};

loadGames();
