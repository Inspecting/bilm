const TMDB_API_KEY = '3ade810499876bb5672f40e54960e6a2';
const CUSTOM_SERVERS_KEY = 'bilm-test-custom-servers';

function detectBasePath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const appRoots = new Set(['home', 'movies', 'tv', 'games', 'search', 'settings', 'random', 'test', 'shared', 'index.html']);
  if (!parts.length || appRoots.has(parts[0])) return '';
  if (parts.length > 1 && appRoots.has(parts[1])) return `/${parts[0]}`;
  return '';
}

function withBase(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${detectBasePath()}${normalized}`;
}

async function tmdb(path, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  url.searchParams.set('api_key', TMDB_API_KEY);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`TMDB error: ${response.status}`);
  return response.json();
}

async function resolveMovieId(rawId, preferredType = 'auto') {
  const id = String(rawId || '').trim();
  if (!id) throw new Error('Enter a TMDB or IMDb id.');

  if ((preferredType === 'tmdb' || preferredType === 'auto') && /^\d+$/.test(id)) {
    const details = await tmdb(`/movie/${id}`);
    return {
      tmdbId: Number(id),
      imdbId: details.imdb_id || '',
      inputType: 'tmdb'
    };
  }

  if ((preferredType === 'imdb' || preferredType === 'auto') && /^tt\d+$/i.test(id)) {
    const imdbId = id.toLowerCase();
    const data = await tmdb(`/find/${imdbId}`, { external_source: 'imdb_id' });
    const found = data?.movie_results?.[0];
    if (!found?.id) throw new Error('IMDb ID not found on TMDB.');
    return {
      tmdbId: found.id,
      imdbId,
      inputType: 'imdb'
    };
  }

  throw new Error('ID format not recognized. Use TMDB numeric ID or IMDb ID like tt0133093.');
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (match) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[match]));
}

const builtInServers = [
  {
    key: 'viking',
    label: 'Viking',
    template: 'https://vembed.stream/play/{id}'
  },
  {
    key: 'embedmaster',
    label: 'EmbedMaster',
    template: 'https://embedmaster.link/movie/{id}'
  },
  {
    key: 'vidsrc',
    label: 'VidSrc',
    template: 'https://vidsrc-embed.ru/embed/movie/{imdbOrId}'
  }
];

function loadCustomServers() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_SERVERS_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && item.key && item.label && item.template);
  } catch {
    return [];
  }
}

function saveCustomServers(servers) {
  localStorage.setItem(CUSTOM_SERVERS_KEY, JSON.stringify(servers));
}

function getServerCatalog() {
  return [...builtInServers, ...loadCustomServers()];
}

function upsertCustomServer(name, template) {
  const cleanName = String(name || '').trim();
  const cleanTemplate = String(template || '').trim();
  if (!cleanName) throw new Error('Provide a server name.');
  if (!cleanTemplate || !/^https?:\/\//i.test(cleanTemplate)) {
    throw new Error('Embed URL template must start with http:// or https://');
  }
  if (!cleanTemplate.includes('{id}') && !cleanTemplate.includes('{imdb}') && !cleanTemplate.includes('{imdbOrId}')) {
    throw new Error('Template must include {id}, {imdb}, or {imdbOrId}.');
  }

  const key = `custom-${cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || Date.now()}`;
  const current = loadCustomServers().filter((item) => item.key !== key);
  const nextItem = { key, label: cleanName, template: cleanTemplate };
  const deduped = current.filter((item) => item.label.toLowerCase() !== cleanName.toLowerCase());
  deduped.unshift(nextItem);
  saveCustomServers(deduped.slice(0, 12));
  return nextItem;
}

function removeCustomServer(key) {
  const current = loadCustomServers();
  const filtered = current.filter((item) => item.key !== key);
  saveCustomServers(filtered);
}

function buildServerUrl(serverKey, ids) {
  const { tmdbId, imdbId } = ids;
  const server = getServerCatalog().find((item) => item.key === serverKey) || builtInServers[0];
  return server.template
    .replaceAll('{id}', encodeURIComponent(String(tmdbId || '')))
    .replaceAll('{imdb}', encodeURIComponent(String(imdbId || '')))
    .replaceAll('{imdbOrId}', encodeURIComponent(String(imdbId || tmdbId || '')));
}

window.TestMovieApp = {
  withBase,
  tmdb,
  resolveMovieId,
  esc,
  getServerCatalog,
  upsertCustomServer,
  removeCustomServer,
  buildServerUrl
};
