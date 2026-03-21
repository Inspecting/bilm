const catalogUrl = 'https://www.onlinegames.io/media/plugins/genGames/embed.json';
const fallbackCatalogUrl = 'catalog.json';
const gameStoreKey = 'bilm:games:selection';
const favoritesStorageKey = 'bilm:games:favorites:v1';
const recentStorageKey = 'bilm:games:recent:v1';
const maxRecentItems = 30;
const initialRenderLimit = 120;

const placeholderSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200"><rect width="320" height="200" fill="#1f1f28"/><text x="50%" y="50%" font-size="22" font-family="Poppins, sans-serif" fill="#9ca3af" text-anchor="middle" dominant-baseline="middle">Game</text></svg>`;
const placeholderImage = `data:image/svg+xml,${encodeURIComponent(placeholderSvg)}`;

const ignoredCategoryTags = new Set([
  '1-player',
  '2-player',
  '3d',
  '2d',
  'mobile',
  'mouse',
  'free',
  'fun',
  'html5',
  'unity',
  'crazy'
]);

const elements = {
  status: document.getElementById('gameStatus'),
  results: document.getElementById('gameSections'),
  empty: document.getElementById('gameEmpty'),
  search: document.getElementById('gameSearchInput'),
  clearSearch: document.getElementById('clearSearchBtn'),
  resultsMeta: document.getElementById('resultsMeta'),
  sort: document.getElementById('sortSelect'),
  favoritesToggle: document.getElementById('favoritesToggleBtn'),
  randomPlay: document.getElementById('randomPlayBtn'),
  chips: document.getElementById('categoryChips'),
  favoriteRailWrap: document.getElementById('favoriteRailWrap'),
  favoriteRail: document.getElementById('favoriteRail'),
  recentRailWrap: document.getElementById('recentRailWrap'),
  recentRail: document.getElementById('recentRail'),
  loadMore: document.getElementById('loadMoreBtn'),
  resultsTitle: document.getElementById('resultsTitle'),
  statTotal: document.getElementById('statTotal'),
  statCategories: document.getElementById('statCategories'),
  statFavorites: document.getElementById('statFavorites'),
  statRecent: document.getElementById('statRecent')
};

const state = {
  games: [],
  query: '',
  sort: 'featured',
  activeCategory: 'all',
  favoritesOnly: false,
  favorites: new Set(),
  recent: [],
  filtered: [],
  renderLimit: initialRenderLimit
};

const safeJsonParse = (raw, fallback) => {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const readLocalArray = (key) => {
  try {
    const parsed = safeJsonParse(localStorage.getItem(key) || '[]', []);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeLocalArray = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Unable to write ${key}`, error);
  }
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

const formatToken = (value) => {
  const source = String(value || '').trim();
  if (!source) return '';
  return source
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const normalizeTags = (rawTags) => {
  if (Array.isArray(rawTags)) {
    return rawTags
      .map((tag) => formatToken(tag))
      .filter(Boolean)
      .slice(0, 12);
  }

  if (typeof rawTags === 'string') {
    return rawTags
      .split(',')
      .map((tag) => formatToken(tag))
      .filter(Boolean)
      .slice(0, 12);
  }

  return [];
};

const inferCategory = (entry, tags) => {
  const directCategory = formatToken(entry?.category || entry?.genre || entry?.group || '');
  if (directCategory) return directCategory;

  const inferredTag = tags.find((tag) => !ignoredCategoryTags.has(tag.toLowerCase().replace(/\s+/g, '-')));
  return inferredTag || 'General';
};

const createGameId = (entry, index) => {
  const title = String(entry?.title || entry?.name || entry?.game || `game-${index + 1}`);
  const sourceBase = [title, entry?.url || entry?.link || '', entry?.embed || entry?.iframe || ''].join('|');
  const source = sourceBase.trim() ? sourceBase : `game-${index + 1}`;
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 30) || `game-${index + 1}`;
  return `${slug}-${(hash >>> 0).toString(16)}`;
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
    return iframe?.src || '';
  } catch (error) {
    console.warn('Unable to parse embed HTML', error);
    return '';
  }
};

const normalizeEntry = (entry, index) => {
  const title = String(entry?.title || entry?.name || entry?.game || `Game ${index + 1}`).trim();
  const image = String(entry?.image || entry?.thumb || entry?.thumbnail || entry?.imageUrl || entry?.cover || placeholderImage).trim() || placeholderImage;
  const embedMarkup = buildEmbedMarkup(entry?.embed || entry?.iframe || entry?.embedHtml || entry?.embedCode, title);
  const embedSrc = extractEmbedSrc(embedMarkup);
  const url = String(entry?.url || entry?.link || entry?.playUrl || entry?.gameUrl || entry?.embedUrl || embedSrc || '').trim();
  const description = String(entry?.description || entry?.about || entry?.summary || '').trim();
  const tags = normalizeTags(entry?.tags);
  const category = inferCategory(entry, tags);
  return {
    id: createGameId(entry, index),
    title,
    image,
    url,
    embedMarkup,
    description,
    category,
    tags,
    sourceIndex: index
  };
};

const dedupeGames = (entries) => {
  const seen = new Set();
  const unique = [];
  entries.forEach((entry) => {
    if (!entry?.id || seen.has(entry.id)) return;
    seen.add(entry.id);
    unique.push(entry);
  });
  return unique;
};

const playable = (game) => Boolean(game?.url || game?.embedMarkup);

const setStatus = (text) => {
  if (elements.status) elements.status.textContent = text;
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
    console.warn('Unable to save game session map', error);
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

const loadFavorites = () => {
  state.favorites = new Set(readLocalArray(favoritesStorageKey).map((id) => String(id)));
};

const saveFavorites = () => {
  writeLocalArray(favoritesStorageKey, Array.from(state.favorites));
};

const loadRecent = () => {
  const recent = readLocalArray(recentStorageKey)
    .map((item, index) => ({
      ...item,
      id: String(item?.id || createGameId(item, index)),
      title: String(item?.title || ''),
      image: String(item?.image || placeholderImage),
      url: String(item?.url || ''),
      embedMarkup: String(item?.embedMarkup || ''),
      description: String(item?.description || ''),
      category: String(item?.category || ''),
      tags: Array.isArray(item?.tags) ? item.tags.map((tag) => formatToken(tag)).filter(Boolean).slice(0, 8) : [],
      playedAt: Number(item?.playedAt || 0)
    }))
    .filter((item) => item.id && item.playedAt > 0)
    .sort((a, b) => b.playedAt - a.playedAt)
    .slice(0, maxRecentItems);
  state.recent = recent;
};

const saveRecent = () => {
  writeLocalArray(recentStorageKey, state.recent.slice(0, maxRecentItems));
};

const rememberRecentPlay = (game) => {
  const nextEntry = {
    id: game.id,
    title: game.title,
    image: game.image || placeholderImage,
    url: game.url || '',
    embedMarkup: game.embedMarkup || '',
    description: game.description || '',
    category: game.category || '',
    tags: Array.isArray(game.tags) ? game.tags.slice(0, 8) : [],
    playedAt: Date.now()
  };
  state.recent = [
    nextEntry,
    ...state.recent.filter((item) => item.id !== game.id)
  ].slice(0, maxRecentItems);
  saveRecent();
};

const openGame = (game) => {
  if (!playable(game)) return;
  rememberRecentPlay(game);
  const id = saveGameSelection(game);
  window.location.href = `./play.html?game=${encodeURIComponent(id)}`;
};

const getGameMap = () => {
  const map = new Map();
  state.games.forEach((game) => map.set(game.id, game));
  return map;
};

const toggleFavorite = (gameId) => {
  if (state.favorites.has(gameId)) {
    state.favorites.delete(gameId);
  } else {
    state.favorites.add(gameId);
  }
  saveFavorites();
  renderRails();
  renderHeaderStats();
  renderCategoryChips();
  renderResults(state.filtered);
  updateToolbarState();
};

const createMiniCard = (game) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mini-card';
  button.title = `Play ${game.title}`;
  button.addEventListener('click', () => openGame(game));

  const image = document.createElement('img');
  image.src = game.image || placeholderImage;
  image.alt = game.title;
  image.loading = 'lazy';

  const title = document.createElement('p');
  title.textContent = game.title;

  button.append(image, title);
  return button;
};

const createTagPill = (text) => {
  const span = document.createElement('span');
  span.className = 'tag-pill';
  span.textContent = text;
  return span;
};

const createGameCard = (game) => {
  const card = document.createElement('article');
  card.className = 'game-card';

  const thumbButton = document.createElement('button');
  thumbButton.type = 'button';
  thumbButton.className = 'game-thumb';
  thumbButton.title = playable(game) ? `Play ${game.title}` : `${game.title} is unavailable`;
  thumbButton.addEventListener('click', () => openGame(game));
  if (!playable(game)) thumbButton.disabled = true;

  const image = document.createElement('img');
  image.src = game.image || placeholderImage;
  image.alt = game.title;
  image.loading = 'lazy';
  thumbButton.appendChild(image);

  const favoriteBtn = document.createElement('button');
  favoriteBtn.type = 'button';
  favoriteBtn.className = 'favorite-btn';
  favoriteBtn.setAttribute('aria-label', state.favorites.has(game.id) ? `Remove ${game.title} from favorites` : `Add ${game.title} to favorites`);
  favoriteBtn.dataset.active = String(state.favorites.has(game.id));
  favoriteBtn.textContent = state.favorites.has(game.id) ? '★' : '☆';
  favoriteBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleFavorite(game.id);
  });
  thumbButton.appendChild(favoriteBtn);

  const body = document.createElement('div');
  body.className = 'game-card-body';

  const metaRow = document.createElement('div');
  metaRow.className = 'game-meta-row';
  const category = document.createElement('p');
  category.className = 'game-category';
  category.textContent = game.category || 'General';
  const dot = document.createElement('span');
  dot.className = playable(game) ? 'playable-dot' : 'playable-dot is-off';
  dot.title = playable(game) ? 'Playable' : 'Unavailable';
  metaRow.append(category, dot);

  const title = document.createElement('h3');
  title.className = 'game-title';
  title.textContent = game.title;

  const tags = document.createElement('div');
  tags.className = 'game-tags';
  (game.tags || []).slice(0, 3).forEach((tag) => tags.appendChild(createTagPill(tag)));

  const actions = document.createElement('div');
  actions.className = 'game-actions';

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'play-btn';
  playBtn.textContent = playable(game) ? 'Play now' : 'Unavailable';
  playBtn.disabled = !playable(game);
  playBtn.addEventListener('click', () => openGame(game));

  const sourceBtn = document.createElement('button');
  sourceBtn.type = 'button';
  sourceBtn.className = 'source-btn';
  sourceBtn.textContent = 'Source';
  if (game.url) {
    sourceBtn.addEventListener('click', () => {
      window.open(game.url, '_blank', 'noopener');
    });
  } else {
    sourceBtn.disabled = true;
  }

  actions.append(playBtn, sourceBtn);
  body.append(metaRow, title, tags, actions);
  card.append(thumbButton, body);

  return card;
};

const setResultMeta = (shown, total) => {
  if (!elements.resultsMeta) return;
  const descriptors = [];
  if (state.query.trim()) descriptors.push(`query: "${state.query.trim()}"`);
  if (state.activeCategory !== 'all') descriptors.push(`category: ${state.activeCategory}`);
  if (state.favoritesOnly) descriptors.push('favorites only');

  const descriptorText = descriptors.length ? ` · ${descriptors.join(' · ')}` : '';
  elements.resultsMeta.hidden = false;
  elements.resultsMeta.textContent = `Showing ${shown} of ${total} games${descriptorText}.`;
};

const updateToolbarState = () => {
  if (elements.clearSearch) elements.clearSearch.hidden = !state.query.trim();
  if (elements.favoritesToggle) {
    elements.favoritesToggle.classList.toggle('is-active', state.favoritesOnly);
    elements.favoritesToggle.setAttribute('aria-pressed', String(state.favoritesOnly));
  }
  if (elements.randomPlay) elements.randomPlay.disabled = state.filtered.length === 0;
};

const renderHeaderStats = () => {
  if (elements.statTotal) elements.statTotal.textContent = String(state.games.length);
  if (elements.statCategories) {
    const categories = new Set(state.games.map((game) => game.category).filter(Boolean));
    elements.statCategories.textContent = String(categories.size);
  }
  if (elements.statFavorites) elements.statFavorites.textContent = String(state.favorites.size);
  if (elements.statRecent) elements.statRecent.textContent = String(state.recent.length);
};

const getCategoryCountMap = () => {
  const map = new Map();
  state.games.forEach((game) => {
    const key = game.category || 'General';
    map.set(key, (map.get(key) || 0) + 1);
  });
  return map;
};

const renderCategoryChips = () => {
  if (!elements.chips) return;
  const countMap = getCategoryCountMap();
  const categories = Array.from(countMap.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 14)
    .map(([category]) => category);

  if (state.activeCategory !== 'all' && !categories.includes(state.activeCategory)) {
    categories.unshift(state.activeCategory);
  }

  elements.chips.innerHTML = '';
  const entries = ['all', ...categories];
  entries.forEach((categoryKey) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    const isAll = categoryKey === 'all';
    const count = isAll ? state.games.length : (countMap.get(categoryKey) || 0);
    const label = isAll ? 'All' : categoryKey;
    button.textContent = `${label} (${count})`;
    button.classList.toggle('is-active', state.activeCategory === categoryKey);
    button.setAttribute('aria-pressed', String(state.activeCategory === categoryKey));
    button.addEventListener('click', () => {
      state.activeCategory = categoryKey;
      applySearch(true);
    });
    elements.chips.appendChild(button);
  });
};

const renderRails = () => {
  const gameMap = getGameMap();
  const favoriteGames = Array.from(state.favorites)
    .map((id) => gameMap.get(id))
    .filter(Boolean)
    .slice(0, 8);
  const recentGames = state.recent
    .map((item) => gameMap.get(item.id) || item)
    .filter((item) => item?.title)
    .slice(0, 8);

  if (elements.favoriteRailWrap && elements.favoriteRail) {
    elements.favoriteRailWrap.hidden = favoriteGames.length === 0;
    elements.favoriteRail.innerHTML = '';
    favoriteGames.forEach((game) => elements.favoriteRail.appendChild(createMiniCard(game)));
  }

  if (elements.recentRailWrap && elements.recentRail) {
    elements.recentRailWrap.hidden = recentGames.length === 0;
    elements.recentRail.innerHTML = '';
    recentGames.forEach((game) => elements.recentRail.appendChild(createMiniCard(game)));
  }
};

const filterGames = () => {
  const query = state.query.trim().toLowerCase();
  return state.games.filter((game) => {
    if (state.activeCategory !== 'all' && game.category !== state.activeCategory) return false;
    if (state.favoritesOnly && !state.favorites.has(game.id)) return false;
    if (!query) return true;
    return [
      game.title,
      game.category,
      game.description,
      ...(game.tags || [])
    ]
      .join(' ')
      .toLowerCase()
      .includes(query);
  });
};

const sortGames = (games) => {
  const copy = [...games];
  if (state.sort === 'name') {
    return copy.sort((a, b) => a.title.localeCompare(b.title));
  }
  if (state.sort === 'category') {
    return copy.sort((a, b) => {
      const categoryOrder = (a.category || '').localeCompare(b.category || '');
      if (categoryOrder !== 0) return categoryOrder;
      return a.title.localeCompare(b.title);
    });
  }
  if (state.sort === 'recent') {
    const recentMap = new Map(state.recent.map((entry, index) => [entry.id, index]));
    return copy.sort((a, b) => {
      const aRecent = recentMap.has(a.id);
      const bRecent = recentMap.has(b.id);
      if (aRecent && bRecent) return recentMap.get(a.id) - recentMap.get(b.id);
      if (aRecent) return -1;
      if (bRecent) return 1;
      return a.title.localeCompare(b.title);
    });
  }
  return copy.sort((a, b) => a.sourceIndex - b.sourceIndex);
};

const renderResults = (games) => {
  if (!elements.results || !elements.empty || !elements.loadMore) return;
  elements.results.innerHTML = '';

  if (!games.length) {
    elements.empty.hidden = false;
    elements.loadMore.hidden = true;
    setResultMeta(0, 0);
    return;
  }

  elements.empty.hidden = true;

  const visibleGames = games.slice(0, state.renderLimit);
  visibleGames.forEach((game) => {
    elements.results.appendChild(createGameCard(game));
  });

  elements.loadMore.hidden = visibleGames.length >= games.length;
  setResultMeta(visibleGames.length, games.length);
};

const updateResultsTitle = () => {
  if (!elements.resultsTitle) return;
  if (state.activeCategory !== 'all') {
    elements.resultsTitle.textContent = `${state.activeCategory} games`;
    return;
  }
  if (state.favoritesOnly) {
    elements.resultsTitle.textContent = 'Favorite games';
    return;
  }
  elements.resultsTitle.textContent = 'All games';
};

const applySearch = (resetLimit = false) => {
  if (resetLimit) state.renderLimit = initialRenderLimit;
  const filtered = filterGames();
  state.filtered = sortGames(filtered);
  renderResults(state.filtered);
  renderRails();
  renderHeaderStats();
  renderCategoryChips();
  updateResultsTitle();
  updateToolbarState();
  setStatus(`${state.filtered.length} game${state.filtered.length === 1 ? '' : 's'} ready to play`);
};

const wireControls = () => {
  if (elements.search) {
    elements.search.addEventListener('input', () => {
      state.query = elements.search.value;
      applySearch(true);
    });
  }

  if (elements.clearSearch) {
    elements.clearSearch.addEventListener('click', () => {
      state.query = '';
      if (elements.search) elements.search.value = '';
      applySearch(true);
      elements.search?.focus();
    });
  }

  if (elements.sort) {
    elements.sort.addEventListener('change', () => {
      state.sort = elements.sort.value;
      applySearch(true);
    });
  }

  if (elements.favoritesToggle) {
    elements.favoritesToggle.addEventListener('click', () => {
      state.favoritesOnly = !state.favoritesOnly;
      applySearch(true);
    });
  }

  if (elements.randomPlay) {
    elements.randomPlay.addEventListener('click', () => {
      if (!state.filtered.length) return;
      const index = Math.floor(Math.random() * state.filtered.length);
      openGame(state.filtered[index]);
    });
  }

  if (elements.loadMore) {
    elements.loadMore.addEventListener('click', () => {
      state.renderLimit += initialRenderLimit;
      renderResults(state.filtered);
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    const activeTag = document.activeElement?.tagName;
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return;
    event.preventDefault();
    elements.search?.focus();
  });
};

const fetchCatalog = async (url) => {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load catalog from ${url} (${response.status})`);
  }
  return response.json();
};

const loadGames = async () => {
  const sources = [catalogUrl, fallbackCatalogUrl];
  let lastError = null;

  for (const source of sources) {
    try {
      const data = await fetchCatalog(source);
      const entries = dedupeGames(normalizeGames(data).map(normalizeEntry).filter((game) => game.title));
      if (!entries.length) {
        lastError = new Error(`Catalog ${source} returned no games`);
        continue;
      }
      state.games = entries;
      setStatus(`${entries.length} games loaded`);
      applySearch(true);
      return;
    } catch (error) {
      lastError = error;
      console.warn(error);
    }
  }

  console.error(lastError);
  setStatus('Unable to load games right now');
  state.games = [];
  state.filtered = [];
  renderResults([]);
  renderHeaderStats();
  updateToolbarState();
};

const boot = () => {
  loadFavorites();
  loadRecent();
  wireControls();
  renderHeaderStats();
  updateToolbarState();
  loadGames();
};

boot();
