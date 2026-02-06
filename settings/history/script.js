fetch('/bilm/shared/navbar.html')
  .then((res) => res.text())
  .then((html) => {
    document.getElementById('navbarContainer').innerHTML = html;

    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/bilm/shared/navbar.css';
    document.head.appendChild(css);

    const js = document.createElement('script');
    js.src = '/bilm/shared/navbar.js';
    document.body.appendChild(js);
  })
  .catch((error) => {
    console.error('Failed to load navbar:', error);
  });

const watchHistoryList = document.getElementById('watchHistoryList');
const watchHistoryEmpty = document.getElementById('watchHistoryEmpty');
const searchHistoryList = document.getElementById('searchHistoryList');
const searchHistoryEmpty = document.getElementById('searchHistoryEmpty');

const clearWatchHistoryBtn = document.getElementById('clearWatchHistoryBtn');
const clearSearchHistoryBtn = document.getElementById('clearSearchHistoryBtn');
const clearAllHistoryBtn = document.getElementById('clearAllHistoryBtn');

function formatDate(ts) {
  if (!ts) return 'Unknown time';
  return new Date(ts).toLocaleString();
}

function renderWatchHistory() {
  const watchItems = window.bilmHistory?.getWatchHistory?.() || [];
  watchHistoryList.innerHTML = '';
  watchHistoryEmpty.style.display = watchItems.length ? 'none' : 'block';

  watchItems.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'history-item';

    const info = document.createElement('div');
    const title = item.type === 'tv' && item.season && item.episode
      ? `${item.title} • S${item.season}E${item.episode}`
      : item.title;

    info.innerHTML = `
      <div>${title || 'Unknown title'}</div>
      <div class="item-meta">${item.type === 'tv' ? 'TV Show' : 'Movie'} • ${formatDate(item.updatedAt)}</div>
    `;

    const remove = document.createElement('button');
    remove.className = 'action-btn action-danger';
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      window.bilmHistory?.removeWatchHistory?.(item.key);
      render();
    });

    row.appendChild(info);
    row.appendChild(remove);
    watchHistoryList.appendChild(row);
  });
}

function renderSearchHistory() {
  const searchItems = window.bilmHistory?.getSearchHistory?.() || [];
  searchHistoryList.innerHTML = '';
  searchHistoryEmpty.style.display = searchItems.length ? 'none' : 'block';

  searchItems.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'history-item';

    const info = document.createElement('div');
    info.innerHTML = `
      <div>${item.query}</div>
      <div class="item-meta">${formatDate(item.updatedAt)}</div>
    `;

    const remove = document.createElement('button');
    remove.className = 'action-btn action-danger';
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      window.bilmHistory?.removeSearchHistory?.(item.query);
      render();
    });

    row.appendChild(info);
    row.appendChild(remove);
    searchHistoryList.appendChild(row);
  });
}

function render() {
  renderWatchHistory();
  renderSearchHistory();
}

clearWatchHistoryBtn.addEventListener('click', () => {
  if (!confirm('Clear watch history?')) return;
  window.bilmHistory?.clearWatchHistory?.();
  render();
});

clearSearchHistoryBtn.addEventListener('click', () => {
  if (!confirm('Clear search history?')) return;
  window.bilmHistory?.clearSearchHistory?.();
  render();
});

clearAllHistoryBtn.addEventListener('click', () => {
  if (!confirm('Clear all history?')) return;
  window.bilmHistory?.clearWatchHistory?.();
  window.bilmHistory?.clearSearchHistory?.();
  render();
});

window.addEventListener('storage', render);
window.addEventListener('DOMContentLoaded', render);
