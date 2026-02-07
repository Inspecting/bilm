const catalogUrl = 'https://www.onlinegames.io/media/plugins/genGames/embed.json';
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
  return [];
};

const normalizeEntry = (entry, index) => {
  const title = entry?.title || entry?.name || entry?.game || entry?.label || `Game ${index + 1}`;
  const image = entry?.image || entry?.thumb || entry?.thumbnail || entry?.imageUrl || entry?.thumbUrl || entry?.cover || placeholderImage;
  const url = entry?.url || entry?.link || entry?.playUrl || entry?.gameUrl || entry?.embedUrl || entry?.href || '';
  const category = entry?.category || entry?.genre || entry?.group || (Array.isArray(entry?.tags) ? entry.tags[0] : null);
  return {
    title,
    image,
    url,
    category: category ? String(category) : null
  };
};

const createCard = (game) => {
  const card = document.createElement('a');
  card.className = 'game-card';
  if (game.url) {
    card.href = game.url;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
  } else {
    card.classList.add('is-disabled');
    card.href = '#';
    card.setAttribute('aria-disabled', 'true');
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

    const row = document.createElement('div');
    row.className = 'scroll-row';

    items.forEach((game) => row.appendChild(createCard(game)));

    section.append(title, row);
    elements.sections.appendChild(section);
  }
};

const setStatus = (text) => {
  if (elements.status) elements.status.textContent = text;
};

const loadGames = async () => {
  try {
    const response = await fetch(catalogUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error('Failed to load game catalog');
    const data = await response.json();
    const entries = normalizeGames(data).map(normalizeEntry);
    setStatus(`${entries.length} games loaded`);
    renderSections(entries);
  } catch (error) {
    console.error(error);
    setStatus('Unable to load games right now');
    elements.empty.hidden = false;
  }
};

loadGames();
