const TMDB_API_KEY = '3ade810499876bb5672f40e54960e6a2';
const params = new URLSearchParams(window.location.search);
const tmdbId = params.get('id');

const iframe = document.getElementById('videoPlayer');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const closeBtn = document.getElementById('closeBtn');
const playerContainer = document.getElementById('playerContainer');
const navbarContainer = document.getElementById('navbarContainer');
const seasonSelect = document.getElementById('seasonSelect');
const episodeSelect = document.getElementById('episodeSelect');
const prevSeasonBtn = document.getElementById('prevSeason');
const nextSeasonBtn = document.getElementById('nextSeason');
const prevEpisodeBtn = document.getElementById('prevEpisode');
const nextEpisodeBtn = document.getElementById('nextEpisode');

const serverBtn = document.getElementById('serverBtn');
const serverDropdown = document.getElementById('serverDropdown');
const serverItems = document.querySelectorAll('.serverDropdownItem');

let currentServer = 'vidsrc1';
let imdbId = null;
let currentSeason = 1;
let currentEpisode = 1;
let totalSeasons = 1;
let episodesPerSeason = {};

function saveProgress() {
  const progressKey = `tv_progress_${tmdbId}`;
  const progress = { season: currentSeason, episode: currentEpisode };
  localStorage.setItem(progressKey, JSON.stringify(progress));
}

function loadProgress() {
  const progressKey = `tv_progress_${tmdbId}`;
  const saved = JSON.parse(localStorage.getItem(progressKey));
  if (saved) {
    currentSeason = saved.season;
    currentEpisode = saved.episode;
  }
}

function populateSeasons(num) {
  seasonSelect.innerHTML = '';
  for (let i = 1; i <= num; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `Season ${i}`;
    if (i === currentSeason) opt.selected = true;
    seasonSelect.appendChild(opt);
  }
}

function populateEpisodes(num) {
  episodeSelect.innerHTML = '';
  for (let i = 1; i <= num; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `Episode ${i}`;
    if (i === currentEpisode) opt.selected = true;
    episodeSelect.appendChild(opt);
  }
}

async function fetchTMDBData() {
  if (!tmdbId) return;

  try {
    const externalRes = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`);
    const externalData = await externalRes.json();
    imdbId = externalData.imdb_id || null;

    const detailsRes = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`);
    const details = await detailsRes.json();

    totalSeasons = details.number_of_seasons || 1;
    episodesPerSeason = {};
    details.seasons.forEach(season => {
      episodesPerSeason[season.season_number] = season.episode_count || 1;
    });

    populateSeasons(totalSeasons);
    if (!episodesPerSeason[currentSeason]) episodesPerSeason[currentSeason] = 1;
    populateEpisodes(episodesPerSeason[currentSeason]);

    loadProgress();
    updateControls();

    updateIframe();
  } catch (e) {
    console.error('Error fetching TMDB data:', e);
  }
}

function updateIframe() {
  saveProgress();
  const idToUse = imdbId || tmdbId;
  if (!idToUse) {
    iframe.src = '';
    return;
  }

  if (currentServer === 'vidsrc1') {
    iframe.src = `https://vsrc.su/embed/${idToUse}/${currentSeason}-${currentEpisode}`;
  } else if (currentServer === 'vidsrc2') {
    iframe.src = `https://vidsrcme.ru/embed/tv?tmdb=${idToUse}&season=${currentSeason}&episode=${currentEpisode}`;
  } else if (currentServer === 'vidsrc3') {
    iframe.src = `https://vidsrc.to/embed/tv?tmdb=${idToUse}&season=${currentSeason}&episode=${currentEpisode}`;
  } else if (currentServer === 'vidsrc4') {
    iframe.src = `https://vidsrc.io/embed/tv?tmdb=${idToUse}&season=${currentSeason}&episode=${currentEpisode}`;
  } else if (currentServer === 'vidsrc5') {
    iframe.src = `https://vidsrcs.com/embed/tv?tmdb=${idToUse}&season=${currentSeason}&episode=${currentEpisode}`;
  } else if (currentServer === 'vidsrc6') {
    iframe.src = `https://vidstream.pro/embed/tv?tmdb=${idToUse}&season=${currentSeason}&episode=${currentEpisode}`;
  } else if (currentServer === 'vidsrc7') {
    iframe.src = `https://vidcloud.co/embed/tv?tmdb=${idToUse}&season=${currentSeason}&episode=${currentEpisode}`;
  }
}

function updateControls() {
  seasonSelect.value = currentSeason;
  episodeSelect.value = currentEpisode;
}

seasonSelect.addEventListener('change', e => {
  currentSeason = parseInt(e.target.value);
  if (!episodesPerSeason[currentSeason]) episodesPerSeason[currentSeason] = 1;
  populateEpisodes(episodesPerSeason[currentSeason]);
  currentEpisode = 1;
  updateIframe();
});

episodeSelect.addEventListener('change', e => {
  currentEpisode = parseInt(e.target.value);
  updateIframe();
});

prevSeasonBtn.addEventListener('click', () => {
  if (currentSeason > 1) currentSeason--;
  populateSeasons(totalSeasons);
  populateEpisodes(episodesPerSeason[currentSeason]);
  currentEpisode = 1;
  updateIframe();
});

nextSeasonBtn.addEventListener('click', () => {
  if (currentSeason < totalSeasons) currentSeason++;
  populateSeasons(totalSeasons);
  populateEpisodes(episodesPerSeason[currentSeason]);
  currentEpisode = 1;
  updateIframe();
});

prevEpisodeBtn.addEventListener('click', () => {
  if (currentEpisode > 1) currentEpisode--;
  populateEpisodes(episodesPerSeason[currentSeason]);
  updateIframe();
});

nextEpisodeBtn.addEventListener('click', () => {
  if (currentEpisode < episodesPerSeason[currentSeason]) currentEpisode++;
  populateEpisodes(episodesPerSeason[currentSeason]);
  updateIframe();
});

// Server dropdown
serverBtn.addEventListener('click', () => {
  serverDropdown.style.display = serverDropdown.style.display === 'flex' ? 'none' : 'flex';
});

serverItems.forEach(item => {
  item.addEventListener('click', () => {
    serverItems.forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    currentServer = item.dataset.server;
    updateIframe();
    serverDropdown.style.display = 'none';
  });
});

// Fullscreen simulation
fullscreenBtn.addEventListener('click', () => {
  if (!document.body.classList.contains('simulated-fullscreen')) {
    document.body.classList.add('simulated-fullscreen');
    navbarContainer.classList.add('hide-navbar');
    closeBtn.style.display = 'block';
  } else {
    document.body.classList.remove('simulated-fullscreen');
    navbarContainer.classList.remove('hide-navbar');
    closeBtn.style.display = 'none';
  }
});

closeBtn.addEventListener('click', () => {
  document.body.classList.remove('simulated-fullscreen');
  navbarContainer.classList.remove('hide-navbar');
  closeBtn.style.display = 'none';
});

// Load TMDB data
fetchTMDBData();
