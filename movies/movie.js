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
  const index = current.findIndex((entry) => entry.tmdbId === item.tmdbId);
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

function createMovieCard(movie) {
  const cardItem = {
    tmdbId: movie.id,
    title: movie.title,
    year: movie.release_date?.slice(0, 4) || 'N/A',
    type: 'movie',
    img: movie.poster_path
      ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
      : 'https://via.placeholder.com/140x210?text=No+Image',
    source: 'TMDB',
    rating: movie.vote_average,
    link: `./movie.html?id=${movie.id}`
  };

  return window.BilmMediaCard.createMediaCard({
    item: cardItem,
    className: 'movie-card',
    badgeClassName: 'source-badge-overlay',
    metaClassName: 'card-meta',
    titleClassName: 'card-title',
    subtitleClassName: 'card-subtitle',
    dataset: { tmdbId: movie.id }
  });
}

function setMoreLikeStatus(message) {
  if (moreLikeStatus) {
    moreLikeStatus.textContent = message;
  }
}

async function fetchMoreLikeCandidates(page = 1) {
  const [similar, recommended] = await Promise.all([
    fetchJSON(`https://api.themoviedb.org/3/movie/${tmdbId}/similar?api_key=${TMDB_API_KEY}&page=${page}`),
    fetchJSON(`https://api.themoviedb.org/3/movie/${tmdbId}/recommendations?api_key=${TMDB_API_KEY}&page=${page}`)
  ]);

  const merged = [...(similar?.results || []), ...(recommended?.results || [])];
  const pageSeen = new Set();
  return merged.filter((movie) => {
    if (!movie?.id || movie.id === Number(tmdbId) || pageSeen.has(movie.id)) return false;
    pageSeen.add(movie.id);
    return true;
  });
}

async function loadMoreLikeMovies() {
  if (!moreLikeEl || similarLoading || similarEnded) return;
  similarLoading = true;
  setMoreLikeStatus('Loading more titles...');

  const movies = await fetchMoreLikeCandidates(similarPage);
  const unique = movies.filter((movie) => movie.id && !seenMoreLike.has(movie.id));

  if (!unique.length) {
    similarEnded = true;
    setMoreLikeStatus('No more recommendations right now.');
    similarLoading = false;
    return;
  }

  unique.forEach((movie) => {
    seenMoreLike.add(movie.id);
    moreLikeEl.appendChild(createMovieCard(movie));
  });

  similarPage += 1;
  setMoreLikeStatus('');
  similarLoading = false;
}

async function loadMovieDetails() {
  if (!tmdbId) {
    status.textContent = 'Missing movie id.';
    return;
  }

  try {
    const [details, videos, credits] = await Promise.all([
      fetchJSON(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`),
      fetchJSON(`https://api.themoviedb.org/3/movie/${tmdbId}/videos?api_key=${TMDB_API_KEY}`),
      fetchJSON(`https://api.themoviedb.org/3/movie/${tmdbId}/credits?api_key=${TMDB_API_KEY}`)
    ]);

    document.getElementById('movieBody').style.display = '';
    document.getElementById('movieTitle').textContent = `${details.title} (${(details.release_date || '').slice(0, 4) || 'N/A'})`;
    document.getElementById('titleHead').textContent = details.title;
    document.getElementById('overview').textContent = details.overview || 'No description available.';
    document.getElementById('poster').src = details.poster_path
      ? `https://image.tmdb.org/t/p/w500${details.poster_path}`
      : 'https://via.placeholder.com/500x750?text=No+Poster';

    const pills = document.getElementById('pills');
    pills.innerHTML = '';
    [
      details.release_date?.slice(0, 4),
      `${Math.round((details.vote_average || 0) * 10) / 10}/10`,
      `${details.runtime || '?'} min`,
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
    document.getElementById('tmdbLink').href = `https://www.themoviedb.org/movie/${details.id}`;

    if (moreLikeEl) {
      moreLikeEl.innerHTML = '';
      seenMoreLike.clear();
      similarPage = 1;
      similarEnded = false;
      await loadMoreLikeMovies();
    }

    const movieItem = {
      tmdbId: details.id,
      title: details.title,
      type: 'movie',
      year: details.release_date?.slice(0, 4) || 'N/A',
      img: details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : 'https://via.placeholder.com/140x210?text=No+Image',
      source: 'TMDB',
      rating: details.vote_average,
      link: `./movie.html?id=${details.id}`
    };

    const syncStates = () => {
      const isFavorite = readList(FAVORITES_KEY).some((entry) => entry.tmdbId === movieItem.tmdbId);
      const isWatchLater = readList(WATCH_LATER_KEY).some((entry) => entry.tmdbId === movieItem.tmdbId);
      setIconState(favoriteBtn, isFavorite, { active: 'Remove from favorites', inactive: 'Add to favorites' });
      setIconState(watchLaterBtn, isWatchLater, { active: 'Remove from watch later', inactive: 'Add to watch later' });
    };

    favoriteBtn.addEventListener('click', () => {
      toggleInList(FAVORITES_KEY, movieItem);
      syncStates();
    });

    watchLaterBtn.addEventListener('click', () => {
      toggleInList(WATCH_LATER_KEY, movieItem);
      syncStates();
    });

    syncStates();
    status.textContent = '';
  } catch {
    status.textContent = 'Unable to load movie details right now.';
  }
}

loadMovieDetails();

if (moreLikeBox) {
  moreLikeBox.addEventListener('scroll', () => {
    if (similarLoading || similarEnded) return;
    if (moreLikeBox.scrollTop + moreLikeBox.clientHeight >= moreLikeBox.scrollHeight - 180) {
      loadMoreLikeMovies();
    }
  });
}
