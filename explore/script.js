const TMDB_API_KEY = '3ade810499876bb5672f40e54960e6a2';
const BASE_URL = 'https://inspecting.github.io/bilm';
const DEFAULT_ITEMS_PER_LOAD = 12;

const moodMap = {
  fresh: { movie: 28, tv: 10759 },
  comfort: { movie: 35, tv: 35 },
  action: { movie: 28, tv: 10759 },
  romance: { movie: 10749, tv: 10749 }
};

const state = {
  type: 'all',
  mood: 'fresh',
  itemsPerLoad: DEFAULT_ITEMS_PER_LOAD
};

async function fetchJSON(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
    return null;
  }
}

function buildSections() {
  const sections = [];
  if (state.type === 'movie') {
    sections.push({ title: 'Trending movies', endpoint: '/trending/movie/week', type: 'movie' });
    sections.push({ title: 'Fresh in theaters', endpoint: '/movie/now_playing', type: 'movie' });
    sections.push({ title: 'Mood picks', endpoint: `/discover/movie?with_genres=${moodMap[state.mood].movie}`, type: 'movie' });
    sections.push({ title: 'Top rated movies', endpoint: '/movie/top_rated', type: 'movie' });
    return sections;
  }

  if (state.type === 'tv') {
    sections.push({ title: 'Trending TV', endpoint: '/trending/tv/week', type: 'tv' });
    sections.push({ title: 'Airing today', endpoint: '/tv/airing_today', type: 'tv' });
    sections.push({ title: 'Mood picks', endpoint: `/discover/tv?with_genres=${moodMap[state.mood].tv}`, type: 'tv' });
    sections.push({ title: 'Top rated TV', endpoint: '/tv/top_rated', type: 'tv' });
    return sections;
  }

  sections.push({ title: 'Trending now', endpoint: '/trending/all/week', type: 'all' });
  sections.push({ title: 'Fresh releases', endpoint: '/movie/now_playing', type: 'movie' });
  sections.push({ title: 'Airing today', endpoint: '/tv/airing_today', type: 'tv' });
  sections.push({ title: 'Mood picks', endpoint: `/discover/movie?with_genres=${moodMap[state.mood].movie}`, type: 'movie' });
  return sections;
}

async function fetchItems(endpoint, page = 1) {
  const url = endpoint.includes('?')
    ? `https://api.themoviedb.org/3${endpoint}&api_key=${TMDB_API_KEY}&page=${page}`
    : `https://api.themoviedb.org/3${endpoint}?api_key=${TMDB_API_KEY}&page=${page}`;
  const data = await fetchJSON(url);
  return data?.results || [];
}

function createCard(item, type) {
  const card = document.createElement('div');
  card.className = 'media-card';

  const img = document.createElement('img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.src = item.poster_path
    ? `https://image.tmdb.org/t/p/${state.itemsPerLoad < DEFAULT_ITEMS_PER_LOAD ? 'w342' : 'w500'}${item.poster_path}`
    : 'https://via.placeholder.com/140x210?text=No+Image';
  img.alt = item.title || item.name || 'Poster';
  img.onerror = () => {
    img.onerror = null;
    img.src = 'https://via.placeholder.com/140x210?text=No+Image';
  };

  const title = document.createElement('p');
  title.textContent = item.title || item.name || 'Untitled';

  const meta = document.createElement('span');
  const year = (item.release_date || item.first_air_date || '').slice(0, 4) || 'N/A';
  meta.textContent = `${type === 'tv' ? 'TV' : 'Movie'} • ${year}`;

  card.appendChild(img);
  card.appendChild(title);
  card.appendChild(meta);

  const linkType = type === 'tv' ? 'tv' : 'movies';
  const linkId = item.id;
  card.onclick = () => {
    window.location.href = `${BASE_URL}/${linkType}/viewer.html?id=${linkId}`;
  };

  return card;
}

async function renderSections() {
  const container = document.getElementById('exploreSections');
  if (!container) return;
  container.innerHTML = '';

  const sections = buildSections();
  for (const section of sections) {
    const sectionEl = document.createElement('div');
    sectionEl.className = 'section';

    const title = document.createElement('h2');
    title.className = 'section-title';
    title.textContent = section.title;

    const row = document.createElement('div');
    row.className = 'scroll-row';

    sectionEl.appendChild(title);
    sectionEl.appendChild(row);
    container.appendChild(sectionEl);

    const items = await fetchItems(section.endpoint);
    items
      .filter(item => item.media_type !== 'person')
      .slice(0, state.itemsPerLoad)
      .forEach(item => {
        const itemType = section.type === 'all' ? (item.media_type || 'movie') : section.type;
        row.appendChild(createCard(item, itemType));
      });
    items.slice(0, state.itemsPerLoad).forEach(item => {
      const itemType = section.type === 'all' ? (item.media_type || 'movie') : section.type;
      row.appendChild(createCard(item, itemType));
    });
  }
}

function updateChipState(containerId, key, value) {
  document.querySelectorAll(`#${containerId} .chip`).forEach(button => {
    const match = button.dataset[key] === value;
    button.classList.toggle('is-active', match);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const settings = window.bilmTheme?.getSettings?.() || {};
  if (settings.dataSaver) {
    state.itemsPerLoad = 8;
  }

  document.getElementById('exploreType')?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-type]');
    if (!button) return;
    state.type = button.dataset.type;
    updateChipState('exploreType', 'type', state.type);
    renderSections();
  });

  document.getElementById('exploreMood')?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-mood]');
    if (!button) return;
    state.mood = button.dataset.mood;
    updateChipState('exploreMood', 'mood', state.mood);
    renderSections();
  });

  updateChipState('exploreType', 'type', state.type);
  updateChipState('exploreMood', 'mood', state.mood);
  renderSections();
});
