const navbarScript = document.createElement('script');
navbarScript.src = '/bilm/shared/navbar.js';
navbarScript.defer = true;
document.body.appendChild(navbarScript);

const TMDB_API_KEY = '3ade810499876bb5672f40e54960e6a2';
const params = new URLSearchParams(window.location.search);
const contentId = params.get('id'); // movie or TV id

const iframe = document.getElementById('videoPlayer');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const playerContainer = document.getElementById('playerContainer');
const navbarContainer = document.getElementById('navbarContainer');
const closeBtn = document.getElementById('closeBtn');
const mediaTitle = document.getElementById('mediaTitle');
const mediaMeta = document.getElementById('mediaMeta');
const favoriteBtn = document.getElementById('favoriteBtn');

const serverBtn = document.getElementById('serverBtn');
const serverDropdown = document.getElementById('serverDropdown');
const serverItems = [...serverDropdown.querySelectorAll('.serverDropdownItem')];

const initialSettings = window.bilmTheme?.getSettings?.();
const supportedServers = ['vidsrc', 'godrive', 'multiembed'];
const normalizeServer = (server) => (supportedServers.includes(server) ? server : 'vidsrc');
let currentServer = normalizeServer(initialSettings?.defaultServer || 'vidsrc');
let continueWatchingEnabled = initialSettings?.continueWatching !== false;
let mediaDetails = null;
let imdbId = null;
const CONTINUE_KEY = 'bilm-continue-watching';
const FAVORITES_KEY = 'bilm-favorites';

const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
const CONTINUE_WATCHING_DELAY = 15000;
let continueWatchingReady = false;
let continueWatchingTimer = null;
let continueWatchingInterval = null;

function startContinueWatchingTimer() {
  if (!continueWatchingEnabled || continueWatchingTimer || continueWatchingReady) return;
  continueWatchingTimer = setTimeout(() => {
    continueWatchingReady = true;
    continueWatchingTimer = null;
    updateContinueWatching();
    continueWatchingInterval = setInterval(() => {
      if (continueWatchingEnabled) {
        updateContinueWatching();
      }
    }, 30000);
  }, CONTINUE_WATCHING_DELAY);
}

function stopContinueWatchingTimer() {
  if (continueWatchingTimer) {
    clearTimeout(continueWatchingTimer);
    continueWatchingTimer = null;
  }
  if (continueWatchingInterval) {
    clearInterval(continueWatchingInterval);
    continueWatchingInterval = null;
  }
  continueWatchingReady = false;
}

function buildMovieUrl(server) {
  if (!contentId) return '';
  switch (server) {
    case 'vidsrc':
      return `https://vidsrc.me/embed/${contentId}`;
    case 'godrive':
      return imdbId ? `https://godriveplayer.com/player.php?imdb=${imdbId}` : '';
    case 'multiembed':
      return imdbId
        ? `https://multiembed.mov/directstream.php?video_id=${imdbId}`
        : `https://multiembed.mov/directstream.php?video_id=${contentId}&tmdb=1`;
    default:
      return '';
  }
}

function updateIframe() {
  if (!contentId) {
    console.warn('No id parameter provided.');
    iframe.src = '';
    return;
  }
  let url = buildMovieUrl(currentServer);
  if (!url) {
    if (currentServer === 'godrive' && !imdbId) {
      return;
    }
    const fallbackServer = normalizeServer('vidsrc');
    setActiveServer(fallbackServer);
    url = buildMovieUrl(fallbackServer);
  }
  iframe.src = url;
  if (continueWatchingReady) {
    updateContinueWatching();
  }
}

function loadList(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveList(key, items) {
  localStorage.setItem(key, JSON.stringify(items));
}

function updateFavoriteButton(isFavorite) {
  if (!favoriteBtn) return;
  favoriteBtn.classList.toggle('is-active', isFavorite);
  favoriteBtn.setAttribute('aria-pressed', isFavorite ? 'true' : 'false');
  favoriteBtn.title = isFavorite ? 'Remove from favorites' : 'Add to favorites';
  favoriteBtn.setAttribute('aria-label', favoriteBtn.title);
}

function toggleFavorite() {
  if (!mediaDetails) return;
  const items = loadList(FAVORITES_KEY);
  const key = `movie-${mediaDetails.id}`;
  const existingIndex = items.findIndex(item => item.key === key);
  if (existingIndex >= 0) {
    items.splice(existingIndex, 1);
    saveList(FAVORITES_KEY, items);
    updateFavoriteButton(false);
    return;
  }

  items.unshift({
    key,
    id: mediaDetails.id,
    type: 'movie',
    title: mediaDetails.title,
    date: mediaDetails.releaseDate,
    year: mediaDetails.year,
    poster: mediaDetails.poster,
    link: mediaDetails.link,
    updatedAt: Date.now()
  });
  saveList(FAVORITES_KEY, items);
  updateFavoriteButton(true);
}

function updateContinueWatching() {
  if (!continueWatchingEnabled || !mediaDetails) return;
  const items = loadList(CONTINUE_KEY);
  const key = `movie-${mediaDetails.id}`;
  const existingIndex = items.findIndex(item => item.key === key);
  const payload = {
    key,
    id: mediaDetails.id,
    type: 'movie',
    title: mediaDetails.title,
    date: mediaDetails.releaseDate,
    year: mediaDetails.year,
    poster: mediaDetails.poster,
    link: mediaDetails.link,
    updatedAt: Date.now()
  };

  if (existingIndex >= 0) {
    items.splice(existingIndex, 1);
  }
  items.unshift(payload);
  saveList(CONTINUE_KEY, items);
}

async function loadMovieDetails() {
  if (!contentId) {
    mediaTitle.textContent = 'Unknown title';
    mediaMeta.textContent = 'Release date unavailable';
    return;
  }

  try {
    const [response, externalResponse] = await Promise.all([
      fetch(`https://api.themoviedb.org/3/movie/${contentId}?api_key=${TMDB_API_KEY}`),
      fetch(`https://api.themoviedb.org/3/movie/${contentId}/external_ids?api_key=${TMDB_API_KEY}`)
    ]);
    if (!response.ok) {
      throw new Error('Failed to load movie details');
    }
    const details = await response.json();
    const external = externalResponse.ok ? await externalResponse.json() : {};
    imdbId = external.imdb_id || null;
    const title = details.title || details.original_title || 'Unknown title';
    const releaseDate = details.release_date || '';
    const displayDate = releaseDate ? new Date(releaseDate).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : 'Release date unavailable';
    const year = releaseDate ? releaseDate.slice(0, 4) : 'N/A';
    const poster = details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : 'https://via.placeholder.com/140x210?text=No+Image';

    mediaTitle.textContent = title;
    mediaMeta.textContent = displayDate;
    document.title = `Bilm 💜 - ${title}`;

    mediaDetails = {
      id: contentId,
      title,
      releaseDate,
      year,
      poster,
      link: `/bilm/movies/viewer.html?id=${contentId}`
    };

    const favorites = loadList(FAVORITES_KEY);
    updateFavoriteButton(favorites.some(item => item.key === `movie-${contentId}`));
    updateIframe();
    startContinueWatchingTimer();
  } catch (error) {
    console.error('Error fetching movie details:', error);
    mediaTitle.textContent = 'Unknown title';
    mediaMeta.textContent = 'Release date unavailable';
  }
}

serverBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = serverDropdown.style.display === 'flex';
  if (isOpen) {
    serverDropdown.style.display = 'none';
    serverBtn.setAttribute('aria-expanded', 'false');
  } else {
    serverDropdown.style.display = 'flex';
    serverBtn.setAttribute('aria-expanded', 'true');
  }
});

document.addEventListener('click', () => {
  serverDropdown.style.display = 'none';
  serverBtn.setAttribute('aria-expanded', 'false');
});

function setActiveServer(server) {
  serverItems.forEach(i => i.classList.toggle('active', i.getAttribute('data-server') === server));
  currentServer = server;
}

serverItems.forEach(item => {
  item.addEventListener('click', () => {
    if (item.classList.contains('active')) return;
    setActiveServer(item.getAttribute('data-server'));
    updateIframe();
    serverDropdown.style.display = 'none';
    serverBtn.setAttribute('aria-expanded', 'false');
  });
});

if (currentServer) {
  setActiveServer(normalizeServer(currentServer));
}

window.addEventListener('bilm:theme-changed', (event) => {
  const newServer = normalizeServer(event.detail?.defaultServer);
  if (newServer && newServer !== currentServer) {
    setActiveServer(newServer);
    updateIframe();
  }
  const nextContinueWatching = event.detail?.continueWatching !== false;
  if (nextContinueWatching !== continueWatchingEnabled) {
    continueWatchingEnabled = nextContinueWatching;
    if (continueWatchingEnabled) {
      startContinueWatchingTimer();
    } else {
      stopContinueWatchingTimer();
    }
  }
});

if (favoriteBtn) {
  favoriteBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleFavorite();
  });
}

fullscreenBtn.onclick = () => {
  if (!isMobile) {
    if (playerContainer.requestFullscreen) {
      playerContainer.requestFullscreen();
    } else if (playerContainer.webkitRequestFullscreen) {
      playerContainer.webkitRequestFullscreen();
    } else if (playerContainer.msRequestFullscreen) {
      playerContainer.msRequestFullscreen();
    }
  } else {
    playerContainer.classList.add('simulated-fullscreen');
  }
  if (closeBtn) {
    closeBtn.style.display = 'block';
  }
  navbarContainer.classList.add('hide-navbar');
};

if (closeBtn) {
  closeBtn.onclick = () => {
    if (isMobile) {
      playerContainer.classList.remove('simulated-fullscreen');
    } else if (document.fullscreenElement || document.webkitFullscreenElement) {
      document.exitFullscreen?.() || document.webkitExitFullscreen?.();
    }
    closeBtn.style.display = 'none';
    navbarContainer.classList.remove('hide-navbar');
  };
}

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) {
    if (closeBtn) {
      closeBtn.style.display = 'none';
    }
    navbarContainer.classList.remove('hide-navbar');
  }
});

// Initial load
updateIframe();
loadMovieDetails();
startContinueWatchingTimer();
