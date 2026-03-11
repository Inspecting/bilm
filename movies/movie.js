const ANILIST_GRAPHQL_URL = 'https://storage-api.watchbilm.org/media/anilist';
const params = new URLSearchParams(window.location.search);
const API_COOLDOWN_MS = 1000;
const apiCooldownByHost = new Map();
const tmdbId = params.get('id');
const isAnime = params.get('anime') === '1';
const anilistId = params.get('aid') || params.get('id');

const FAVORITES_KEY = 'bilm-favorites';
const WATCH_LATER_KEY = 'bilm-watch-later';
const mediaIdentity = window.BilmMediaIdentity || {
  toMediaTypeFromAniListFormat: () => 'tv',
  buildDetailsLink: ({ type, id }) => (type === 'tv'
    ? `../tv/show.html?anime=1&aid=${id}&type=tv`
    : `./show.html?anime=1&aid=${id}&type=movie`),
  createStoredMediaItem: (item) => item,
  canonicalizeStoredItem: (item) => item,
  findIndexByIdentity: (list, item) => list.findIndex((entry) => entry?.key && entry.key === item?.key),
  hasIdentity: (list, item) => list.some((entry) => entry?.key && entry.key === item?.key),
  dedupeCanonicalItems: (list) => list
};
mediaIdentity.migrateLocalListsOnce?.();

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

function detectBasePath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const appRoots = new Set(['home', 'movies', 'tv', 'games', 'search', 'settings', 'random', 'test', 'shared', 'index.html']);
  if (!parts.length || appRoots.has(parts[0])) return '';
  if (parts.length > 1 && appRoots.has(parts[1])) return `/${parts[0]}`;
  return '';
}

function withBase(path) {
  const normalized = String(path || '').startsWith('/') ? String(path) : `/${String(path || '')}`;
  return `${detectBasePath()}${normalized}`;
}

function buildTmdbProxyUrl(tmdbPath, sourceParams = null) {
  const cleanedPath = String(tmdbPath || '').replace(/^\/+/, '');
  if (!cleanedPath) return '';
  const proxyUrl = new URL(`${window.location.origin}${withBase(`/api/tmdb/${cleanedPath}`)}`);
  if (sourceParams && typeof sourceParams.forEach === 'function') {
    sourceParams.forEach((value, key) => {
      if (String(key || '').toLowerCase() === 'api_key') return;
      proxyUrl.searchParams.append(key, value);
    });
  }
  return proxyUrl.toString();
}

function buildBackupUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || '').trim(), window.location.href);
    if (parsed.origin !== 'https://storage-api.watchbilm.org') return '';
    if (!parsed.pathname.startsWith('/media/tmdb/')) return '';
    const tmdbPath = parsed.pathname.slice('/media/tmdb/'.length);
    return buildTmdbProxyUrl(tmdbPath, parsed.searchParams);
  } catch {
    return '';
  }
}

function fetchJSON(url) {
  const primaryUrl = String(url || '').trim();
  return fetch(primaryUrl)
    .then((res) => {
      if (res.ok) return res.json();
      throw new Error(`HTTP ${res.status}`);
    })
    .catch(async (error) => {
      const backupUrl = buildBackupUrl(primaryUrl);
      if (!backupUrl) throw error;
      console.info('[api-fallback] movie details using backup provider', {
        primaryUrl,
        backupUrl
      });
      const backupResponse = await fetch(backupUrl);
      if (!backupResponse.ok) throw error;
      return backupResponse.json();
    });
}

function readList(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => mediaIdentity.canonicalizeStoredItem(item) || item).filter(Boolean);
  } catch {
    return [];
  }
}

function writeList(key, items) {
  const list = Array.isArray(items) ? items : [];
  const normalized = list
    .map((item) => mediaIdentity.canonicalizeStoredItem(item) || item)
    .filter(Boolean);
  localStorage.setItem(key, JSON.stringify(mediaIdentity.dedupeCanonicalItems(normalized)));
}

function toggleInList(key, item) {
  const canonical = mediaIdentity.canonicalizeStoredItem(item) || item;
  const current = readList(key);
  const index = mediaIdentity.findIndexByIdentity(current, canonical);
  if (index >= 0) {
    current.splice(index, 1);
    writeList(key, current);
    return false;
  }
  current.unshift(canonical);
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

function pickCertification(items, key = 'certification') {
  const list = Array.isArray(items) ? items : [];
  const us = list.find((entry) => entry?.iso_3166_1 === 'US');
  const fromUs = us?.release_dates?.find((entry) => String(entry?.[key] || '').trim())?.[key];
  if (String(fromUs || '').trim()) return String(fromUs).trim();

  for (const entry of list) {
    const value = entry?.release_dates?.find((row) => String(row?.[key] || '').trim())?.[key];
    if (String(value || '').trim()) return String(value).trim();
  }

  return '';
}

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function extractYear(value) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 1800 ? parsed : 0;
}

function sanitizeText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function setMoreLikeStatus(message) {
  if (moreLikeStatus) {
    moreLikeStatus.textContent = message;
  }
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
    link: `./show.html?id=${movie.id}`
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

function createAnimeCard(media) {
  const animeMediaId = Number(media?.id || 0);
  if (!animeMediaId) return document.createDocumentFragment();
  const mediaType = mediaIdentity.toMediaTypeFromAniListFormat(media?.format);
  const detailsLink = mediaIdentity.buildDetailsLink({
    provider: 'anilist',
    type: mediaType,
    id: animeMediaId
  });
  return window.BilmMediaCard.createMediaCard({
    item: {
      id: animeMediaId,
      anilistId: animeMediaId,
      title: media?.title?.english || media?.title?.romaji || 'Untitled',
      year: String(media?.startDate?.year || 'N/A'),
      type: mediaType,
      img: media?.coverImage?.large || media?.coverImage?.medium || 'https://via.placeholder.com/140x210?text=No+Image',
      source: 'AniList',
      rating: Number.isFinite(Number(media?.averageScore)) ? Number(media.averageScore) / 10 : null,
      link: detailsLink
    },
    className: 'movie-card',
    badgeClassName: 'source-badge-overlay',
    metaClassName: 'card-meta',
    titleClassName: 'card-title',
    subtitleClassName: 'card-subtitle',
    dataset: { anilistId: animeMediaId }
  });
}

async function fetchMoreLikeCandidates(page = 1) {
  const [similar, recommended] = await Promise.all([
    fetchJSON(`https://storage-api.watchbilm.org/media/tmdb/movie/${tmdbId}/similar?page=${page}`),
    fetchJSON(`https://storage-api.watchbilm.org/media/tmdb/movie/${tmdbId}/recommendations?page=${page}`)
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

function collectAnimeRecommendations(details) {
  const recommended = [];
  const seen = new Set();
  const addMedia = (media) => {
    const id = Number(media?.id || 0);
    if (!id || seen.has(id) || id === Number(details?.id || 0)) return;
    seen.add(id);
    recommended.push(media);
  };

  (details?.recommendations?.nodes || []).forEach((node) => addMedia(node?.mediaRecommendation));
  (details?.relations?.edges || []).forEach((edge) => {
    const relationType = String(edge?.relationType || '').trim().toUpperCase();
    if (!relationType) return;
    addMedia(edge?.node);
  });

  return recommended;
}

function renderAnimeTrailer(details) {
  const trailerSite = String(details?.trailer?.site || '').trim().toLowerCase();
  const trailerId = String(details?.trailer?.id || '').trim();
  if (trailerSite === 'youtube' && trailerId) {
    document.getElementById('trailerBox').innerHTML = `<iframe src="https://www.youtube.com/embed/${encodeURIComponent(trailerId)}" title="Trailer" allowfullscreen></iframe>`;
    return true;
  }
  return false;
}

async function findStrictTmdbMovieMatch({ title, year }) {
  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTitle) return 0;
  const search = await fetchJSON(`https://storage-api.watchbilm.org/media/tmdb/search/movie?query=${encodeURIComponent(title)}`);
  const candidates = Array.isArray(search?.results) ? search.results : [];
  for (const candidate of candidates) {
    const candidateTitle = normalizeTitle(candidate?.title || candidate?.original_title);
    if (!candidateTitle || candidateTitle !== normalizedTitle) continue;
    const candidateYear = extractYear(String(candidate?.release_date || '').slice(0, 4));
    if (year > 0 && candidateYear > 0 && Math.abs(candidateYear - year) > 1) continue;
    return Number(candidate?.id || 0) || 0;
  }
  return 0;
}

async function renderStrictTmdbAnimeFallback({ title, year, includeRecommendations = true }) {
  const strictTmdbId = await findStrictTmdbMovieMatch({ title, year });
  if (!strictTmdbId) return false;

  const videos = await fetchJSON(`https://storage-api.watchbilm.org/media/tmdb/movie/${strictTmdbId}/videos`);
  const trailer = (videos?.results || []).find((video) => video.site === 'YouTube' && video.type === 'Trailer');
  if (trailer?.key) {
    document.getElementById('trailerBox').innerHTML = `<iframe src="https://www.youtube.com/embed/${encodeURIComponent(trailer.key)}" title="Trailer" allowfullscreen></iframe>`;
  }

  if (!includeRecommendations || !moreLikeEl) return Boolean(trailer?.key);

  const [similar, recommended] = await Promise.all([
    fetchJSON(`https://storage-api.watchbilm.org/media/tmdb/movie/${strictTmdbId}/similar?page=1`),
    fetchJSON(`https://storage-api.watchbilm.org/media/tmdb/movie/${strictTmdbId}/recommendations?page=1`)
  ]);
  const merged = [...(similar?.results || []), ...(recommended?.results || [])];
  const deduped = [];
  const seen = new Set();
  merged.forEach((movie) => {
    const id = Number(movie?.id || 0);
    if (!id || seen.has(id)) return;
    seen.add(id);
    deduped.push(movie);
  });

  if (!deduped.length) return Boolean(trailer?.key);
  deduped.slice(0, 24).forEach((movie) => {
    moreLikeEl.appendChild(createMovieCard(movie));
  });
  setMoreLikeStatus('Using strict TMDB fallback recommendations.');
  return true;
}

async function fetchAnimeMovieDetails() {
  if (!anilistId) {
    status.textContent = 'Missing anime id.';
    return;
  }

  const query = `
    query ($id: Int!) {
      Media(id: $id, type: ANIME) {
        id
        format
        title { romaji english }
        coverImage { large medium }
        bannerImage
        description(asHtml: false)
        episodes
        duration
        averageScore
        genres
        startDate { year month day }
        trailer { id site thumbnail }
        recommendations(perPage: 24, sort: RATING_DESC) {
          nodes {
            mediaRecommendation {
              id
              format
              title { romaji english }
              coverImage { large medium }
              startDate { year month day }
              averageScore
            }
          }
        }
        relations {
          edges {
            relationType
            node {
              id
              type
              format
              title { romaji english }
              coverImage { large medium }
              startDate { year month day }
              averageScore
            }
          }
        }
      }
    }
  `;

  try {
    await waitForApiCooldown(ANILIST_GRAPHQL_URL);
    let response = await fetch(ANILIST_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ query, variables: { id: Number(anilistId) } })
    });
    if (!response.ok) {
      console.info('[api-fallback] anime movie details using direct AniList provider');
      await waitForApiCooldown('https://graphql.anilist.co');
      response = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ query, variables: { id: Number(anilistId) } })
      });
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const details = payload?.data?.Media;
    if (!details?.id) throw new Error('Anime not found');

    const title = details.title?.english || details.title?.romaji || 'Unknown title';
    const year = details.startDate?.year || 'N/A';
    const month = details.startDate?.month || 1;
    const day = details.startDate?.day || 1;
    const releaseDate = details.startDate?.year ? new Date(details.startDate.year, month - 1, day) : null;

    document.getElementById('movieBody').style.display = '';
    document.getElementById('movieTitle').textContent = `${title} (${year})`;
    document.getElementById('titleHead').textContent = title;
    document.getElementById('overview').textContent = sanitizeText(details.description || 'No description available.');
    document.getElementById('poster').src = details.coverImage?.large || details.coverImage?.medium || 'https://via.placeholder.com/500x750?text=No+Poster';

    const pills = document.getElementById('pills');
    pills.innerHTML = '';
    [
      year,
      details.averageScore ? `${Math.round((details.averageScore / 10) * 10) / 10}/10` : null,
      details.episodes ? `${details.episodes} episode${details.episodes === 1 ? '' : 's'}` : null,
      details.duration ? `${details.duration} min` : null,
      ...(details.genres || [])
    ].filter(Boolean).forEach((value) => {
      const span = document.createElement('span');
      span.className = 'pill';
      span.textContent = value;
      pills.appendChild(span);
    });

    const hasAniListTrailer = renderAnimeTrailer(details);
    if (!hasAniListTrailer) {
      document.getElementById('trailerBox').innerHTML = '<p class="subtitle">Trailer not available from AniList. Trying strict fallback…</p>';
    }

    document.getElementById('castLine').textContent = 'Cast data unavailable for anime source.';
    document.getElementById('watchLink').href = `./watch/viewer.html?anime=1&aid=${details.id}&type=movie&episode=1`;
    document.getElementById('tmdbLink').textContent = 'Open on AniList';
    document.getElementById('tmdbLink').href = `https://anilist.co/anime/${details.id}`;

    if (moreLikeEl) {
      moreLikeEl.innerHTML = '';
      const recommendations = collectAnimeRecommendations(details);
      recommendations.forEach((media) => {
        moreLikeEl.appendChild(createAnimeCard(media));
      });
      if (recommendations.length) {
        setMoreLikeStatus('');
      } else {
        setMoreLikeStatus('AniList had no recommendations. Trying strict fallback…');
      }
      if (!hasAniListTrailer || !recommendations.length) {
        const fallbackUsed = await renderStrictTmdbAnimeFallback({
          title,
          year: extractYear(year),
          includeRecommendations: !recommendations.length
        });
        if (!fallbackUsed) {
          if (!hasAniListTrailer) {
            document.getElementById('trailerBox').innerHTML = '<p class="subtitle">No trailer available right now.</p>';
          }
          if (!recommendations.length) {
            setMoreLikeStatus('Recommendations unavailable for anime right now.');
          }
        }
      }
    }

    const movieItem = mediaIdentity.createStoredMediaItem({
      provider: 'anilist',
      id: details.id,
      anilistId: details.id,
      title,
      type: 'movie',
      date: releaseDate ? releaseDate.toISOString() : '',
      year: String(year),
      poster: details.coverImage?.large || details.coverImage?.medium || 'https://via.placeholder.com/140x210?text=No+Image',
      source: 'AniList',
      rating: details.averageScore ? details.averageScore / 10 : null,
      certification: 'N/A',
      updatedAt: Date.now()
    });

    const syncStates = () => {
      const favorites = readList(FAVORITES_KEY);
      const watchLater = readList(WATCH_LATER_KEY);
      const isFavorite = mediaIdentity.hasIdentity(favorites, movieItem);
      const isWatchLater = mediaIdentity.hasIdentity(watchLater, movieItem);
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
    status.textContent = 'Unable to load anime details right now.';
  }
}

async function loadMovieDetails() {
  if (isAnime) {
    await fetchAnimeMovieDetails();
    return;
  }

  if (!tmdbId) {
    status.textContent = 'Missing movie id.';
    return;
  }

  try {
    const [details, videos, credits, releaseDates] = await Promise.all([
      fetchJSON(`https://storage-api.watchbilm.org/media/tmdb/movie/${tmdbId}`),
      fetchJSON(`https://storage-api.watchbilm.org/media/tmdb/movie/${tmdbId}/videos`),
      fetchJSON(`https://storage-api.watchbilm.org/media/tmdb/movie/${tmdbId}/credits`),
      fetchJSON(`https://storage-api.watchbilm.org/media/tmdb/movie/${tmdbId}/release_dates`)
    ]);

    document.getElementById('movieBody').style.display = '';
    document.getElementById('movieTitle').textContent = `${details.title} (${(details.release_date || '').slice(0, 4) || 'N/A'})`;
    document.getElementById('titleHead').textContent = details.title;
    document.getElementById('overview').textContent = details.overview || 'No description available.';
    document.getElementById('poster').src = details.poster_path
      ? `https://image.tmdb.org/t/p/w500${details.poster_path}`
      : 'https://via.placeholder.com/500x750?text=No+Poster';

    const certification = pickCertification(releaseDates?.results);

    const pills = document.getElementById('pills');
    pills.innerHTML = '';
    [
      details.release_date?.slice(0, 4),
      `${Math.round((details.vote_average || 0) * 10) / 10}/10`,
      certification,
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

    const movieItem = mediaIdentity.createStoredMediaItem({
      provider: 'tmdb',
      id: details.id,
      tmdbId: details.id,
      title: details.title,
      type: 'movie',
      date: details.release_date || '',
      year: details.release_date?.slice(0, 4) || 'N/A',
      poster: details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : 'https://via.placeholder.com/140x210?text=No+Image',
      source: 'TMDB',
      rating: details.vote_average,
      certification,
      updatedAt: Date.now()
    });

    const syncStates = () => {
      const favorites = readList(FAVORITES_KEY);
      const watchLater = readList(WATCH_LATER_KEY);
      const isFavorite = mediaIdentity.hasIdentity(favorites, movieItem);
      const isWatchLater = mediaIdentity.hasIdentity(watchLater, movieItem);
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
    if (similarLoading || similarEnded || isAnime) return;
    if (moreLikeBox.scrollTop + moreLikeBox.clientHeight >= moreLikeBox.scrollHeight - 180) {
      loadMoreLikeMovies();
    }
  });
}

async function waitForApiCooldown(url) {
  let host = 'default';
  try {
    host = new URL(url, window.location.origin).host || 'default';
  } catch {
    host = 'default';
  }
  const now = Date.now();
  const nextAllowedAt = apiCooldownByHost.get(host) || 0;
  const waitMs = nextAllowedAt - now;
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  apiCooldownByHost.set(host, Date.now() + API_COOLDOWN_MS);
}
