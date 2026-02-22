const TMDB_API_KEY = '3ade810499876bb5672f40e54960e6a2';
const params = new URLSearchParams(window.location.search);
const tmdbId = params.get('id');

const FAVORITES_KEY = 'bilm-favorites';
const WATCH_LATER_KEY = 'bilm-watch-later';

const status = document.getElementById('status');
const favoriteBtn = document.getElementById('favoriteBtn');
const watchLaterBtn = document.getElementById('watchLaterBtn');
const moreLikeBox = document.getElementById('moreLikeBox');
const moreLikeEl = document.getElementById('moreLike');
const moreLikeStatus = document.getElementById('moreLikeStatus');

let similarPage = 1;
let similarLoading = false;
let similarEnded = false;
const seenMoreLike = new Set();

function fetchJSON(url) {
  return fetch(url).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
}

function readList(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeList(key, items) {
  localStorage.setItem(key, JSON.stringify(items));
}

function toggleInList(key, item) {
  const current = readList(key);
  const index = current.findIndex((entry) => entry.key === item.key || entry.tmdbId === item.tmdbId || entry.id === item.id);
  if (index >= 0) {
    current.splice(index, 1);
    writeList(key, current);
    return false;
  }
  current.unshift(item);
  writeList(key, current.slice(0, 60));
  return true;
}

function setIconState(button, isActive, labels) {
  if (!button) return;
  button.classList.toggle('is-active', isActive);
  button.setAttribute('aria-pressed', String(isActive));
  const text = isActive ? labels.active : labels.inactive;
  button.title = text;
  button.setAttribute('aria-label', text);
}

function createShowCard(show) {
  const cardItem = {
    tmdbId: show.id,
    title: show.name,
    year: show.first_air_date?.slice(0, 4) || 'N/A',
    type: 'tv',
    img: show.poster_path
      ? `https://image.tmdb.org/t/p/w500${show.poster_path}`
      : 'https://via.placeholder.com/140x210?text=No+Image',
    source: 'TMDB',
    rating: show.vote_average,
    link: `./movie.html?id=${show.id}`
  };

  return window.BilmMediaCard.createMediaCard({
    item: cardItem,
    className: 'movie-card',
    badgeClassName: 'source-badge-overlay',
    metaClassName: 'card-meta',
    titleClassName: 'card-title',
    subtitleClassName: 'card-subtitle',
    dataset: { tmdbId: show.id }
  });
}

function setMoreLikeStatus(message) {
  if (moreLikeStatus) {
    moreLikeStatus.textContent = message;
  }
}

async function fetchMoreLikeCandidates(page = 1) {
  const [similar, recommended] = await Promise.all([
    fetchJSON(`https://api.themoviedb.org/3/tv/${tmdbId}/similar?api_key=${TMDB_API_KEY}&page=${page}`),
    fetchJSON(`https://api.themoviedb.org/3/tv/${tmdbId}/recommendations?api_key=${TMDB_API_KEY}&page=${page}`)
  ]);

  const merged = [...(similar?.results || []), ...(recommended?.results || [])];
  const pageSeen = new Set();
  return merged.filter((show) => {
    if (!show?.id || show.id === Number(tmdbId) || pageSeen.has(show.id)) return false;
    pageSeen.add(show.id);
    return true;
  });
}

async function loadMoreLikeShows() {
  if (!moreLikeEl || similarLoading || similarEnded) return;
  similarLoading = true;
  setMoreLikeStatus('Loading more titles...');

  const shows = await fetchMoreLikeCandidates(similarPage);
  const unique = shows.filter((show) => show.id && !seenMoreLike.has(show.id));

  if (!unique.length) {
    similarEnded = true;
    setMoreLikeStatus('No more recommendations right now.');
    similarLoading = false;
    return;
  }

  unique.forEach((show) => {
    seenMoreLike.add(show.id);
    moreLikeEl.appendChild(createShowCard(show));
  });

  similarPage += 1;
  setMoreLikeStatus('');
  similarLoading = false;
}

async function loadShowDetails() {
  if (!tmdbId) {
    status.textContent = 'Missing TV show id.';
    return;
  }

  try {
    const [details, videos, credits] = await Promise.all([
      fetchJSON(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${TMDB_API_KEY}`),
      fetchJSON(`https://api.themoviedb.org/3/tv/${tmdbId}/videos?api_key=${TMDB_API_KEY}`),
      fetchJSON(`https://api.themoviedb.org/3/tv/${tmdbId}/credits?api_key=${TMDB_API_KEY}`)
    ]);

    document.getElementById('movieBody').style.display = '';
    document.getElementById('movieTitle').textContent = `${details.name} (${(details.first_air_date || '').slice(0, 4) || 'N/A'})`;
    document.getElementById('titleHead').textContent = details.name;
    document.getElementById('overview').textContent = details.overview || 'No description available.';
    document.getElementById('poster').src = details.poster_path
      ? `https://image.tmdb.org/t/p/w500${details.poster_path}`
      : 'https://via.placeholder.com/500x750?text=No+Poster';

    const pills = document.getElementById('pills');
    pills.innerHTML = '';
    [
      details.first_air_date?.slice(0, 4),
      `${Math.round((details.vote_average || 0) * 10) / 10}/10`,
      `${details.number_of_seasons || '?'} season${details.number_of_seasons === 1 ? '' : 's'}`,
      ...(details.genres || []).map((genre) => genre.name)
    ].filter(Boolean).forEach((value) => {
      const span = document.createElement('span');
      span.className = 'pill';
      span.textContent = value;
      pills.appendChild(span);
    });

    const trailer = (videos.results || []).find((video) => video.site === 'YouTube' && video.type === 'Trailer') || videos.results?.[0];
    document.getElementById('trailerBox').innerHTML = trailer
      ? `<iframe src="https://www.youtube.com/embed/${trailer.key}" title="Trailer" allowfullscreen></iframe>`
      : '<p class="subtitle">No trailer available.</p>';

    document.getElementById('castLine').textContent = (credits.cast || []).slice(0, 10).map((person) => person.name).join(' • ') || 'No cast information.';

    document.getElementById('watchLink').href = `./watch/viewer.html?id=${details.id}`;
    document.getElementById('tmdbLink').href = `https://www.themoviedb.org/tv/${details.id}`;

    if (moreLikeEl) {
      moreLikeEl.innerHTML = '';
      seenMoreLike.clear();
      similarPage = 1;
      similarEnded = false;
      await loadMoreLikeShows();
    }

    const showItem = {
      key: `tv-${details.id}`,
      id: details.id,
      tmdbId: details.id,
      title: details.name,
      type: 'tv',
      date: details.first_air_date || '',
      year: details.first_air_date?.slice(0, 4) || 'N/A',
      poster: details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : 'https://via.placeholder.com/140x210?text=No+Image',
      source: 'TMDB',
      rating: details.vote_average,
      link: `./movie.html?id=${details.id}`,
      updatedAt: Date.now()
    };

    const syncStates = () => {
      const isFavorite = readList(FAVORITES_KEY).some((entry) => entry.key === showItem.key || entry.tmdbId === showItem.tmdbId || entry.id === showItem.id);
      const isWatchLater = readList(WATCH_LATER_KEY).some((entry) => entry.key === showItem.key || entry.tmdbId === showItem.tmdbId || entry.id === showItem.id);
      setIconState(favoriteBtn, isFavorite, { active: 'Remove from favorites', inactive: 'Add to favorites' });
      setIconState(watchLaterBtn, isWatchLater, { active: 'Remove from watch later', inactive: 'Add to watch later' });
    };

    favoriteBtn.addEventListener('click', () => {
      toggleInList(FAVORITES_KEY, showItem);
      syncStates();
    });

    watchLaterBtn.addEventListener('click', () => {
      toggleInList(WATCH_LATER_KEY, showItem);
      syncStates();
    });

    syncStates();
    status.textContent = '';
  } catch {
    status.textContent = 'Unable to load TV details right now.';
  }
}

loadShowDetails();

if (moreLikeBox) {
  moreLikeBox.addEventListener('scroll', () => {
    if (similarLoading || similarEnded) return;
    if (moreLikeBox.scrollTop + moreLikeBox.clientHeight >= moreLikeBox.scrollHeight - 180) {
      loadMoreLikeShows();
    }
  });
}
