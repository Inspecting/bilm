(() => {
const app = window.TestMovieApp;

const params = new URLSearchParams(window.location.search);
const idInput = document.getElementById('idInput');
const idType = document.getElementById('idType');
const serverSelect = document.getElementById('server');
const status = document.getElementById('status');
const player = document.getElementById('player');
const detailsLink = document.getElementById('detailsLink');
const customServerList = document.getElementById('customServerList');

function refreshServerOptions(selectedKey = '') {
  const servers = app.getServerCatalog();
  serverSelect.innerHTML = '';
  servers.forEach((server) => {
    const option = document.createElement('option');
    option.value = server.key;
    option.textContent = server.label;
    serverSelect.appendChild(option);
  });
  if (selectedKey && servers.some((item) => item.key === selectedKey)) {
    serverSelect.value = selectedKey;
  }
  if (!serverSelect.value && servers.length) {
    serverSelect.value = servers[0].key;
  }
}

function renderCustomServerChips() {
  const servers = app.getServerCatalog().filter((item) => item.key.startsWith('custom-'));
  customServerList.innerHTML = '';
  if (!servers.length) return;
  servers.forEach((server) => {
    const chip = document.createElement('div');
    chip.className = 'custom-chip';
    chip.innerHTML = `<span>${app.esc(server.label)}</span><button type="button" data-remove="${app.esc(server.key)}">✕</button>`;
    customServerList.appendChild(chip);
  });
}

async function loadPlayer(rawId) {
  try {
    status.textContent = 'Resolving ID...';
    const ids = await app.resolveMovieId(rawId, idType.value);
    const server = serverSelect.value;
    const src = app.buildServerUrl(server, ids);
    if (!src || src.endsWith('/')) throw new Error('Server URL could not be built.');

    player.src = src;
    detailsLink.href = `../?id=${encodeURIComponent(rawId)}&type=${encodeURIComponent(idType.value)}`;
    history.replaceState({}, '', `?id=${encodeURIComponent(rawId)}&type=${encodeURIComponent(idType.value)}&tmdb=${ids.tmdbId}${ids.imdbId ? `&imdb=${encodeURIComponent(ids.imdbId)}` : ''}&server=${encodeURIComponent(server)}`);
    status.textContent = `Playing with ${serverSelect.options[serverSelect.selectedIndex]?.textContent || server}.`;
  } catch (error) {
    status.textContent = error.message || 'Failed to load player.';
  }
}

document.getElementById('loadBtn').addEventListener('click', () => loadPlayer(idInput.value));

document.getElementById('addCustomBtn').addEventListener('click', () => {
  const nameInput = document.getElementById('customName');
  const templateInput = document.getElementById('customTemplate');

  try {
    const created = app.upsertCustomServer(nameInput.value, templateInput.value);
    refreshServerOptions(created.key);
    renderCustomServerChips();
    nameInput.value = '';
    templateInput.value = '';
    status.textContent = `Custom server "${created.label}" added.`;
  } catch (error) {
    status.textContent = error.message || 'Could not add custom embed.';
  }
});

customServerList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-remove]');
  if (!button) return;
  const key = button.dataset.remove;
  app.removeCustomServer(key);
  refreshServerOptions();
  renderCustomServerChips();
  status.textContent = 'Custom server removed.';
});

refreshServerOptions(params.get('server') || '');
renderCustomServerChips();

const initialId = params.get('id');
const initialType = params.get('type') || 'auto';
if (['auto', 'tmdb', 'imdb'].includes(initialType)) idType.value = initialType;
if (initialId) {
  idInput.value = initialId;
  loadPlayer(initialId);
}
})();
