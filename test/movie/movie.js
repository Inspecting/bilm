(() => {
const movieApi = window.TestMovieApp.tmdb;
const resolveId = window.TestMovieApp.resolveMovieId;
const esc = window.TestMovieApp.esc;
const params = new URLSearchParams(window.location.search);

const idInput = document.getElementById('idInput');
const idType = document.getElementById('idType');
const status = document.getElementById('status');

async function loadMovie(rawId) {
  try {
    status.textContent = 'Loading movie...';
    const resolved = await resolveId(rawId, idType.value);
    const { tmdbId, imdbId } = resolved;

    const [details, videos, credits, similar] = await Promise.all([
      movieApi(`/movie/${tmdbId}`),
      movieApi(`/movie/${tmdbId}/videos`),
      movieApi(`/movie/${tmdbId}/credits`),
      movieApi(`/movie/${tmdbId}/similar`, { page: 1 })
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
      ? `<iframe src="https://www.youtube.com/embed/${esc(trailer.key)}" allowfullscreen title="Trailer"></iframe>`
      : '<p class="subtitle">No trailer available.</p>';

    const cast = (credits.cast || []).slice(0, 12).map((castItem) => castItem.name).join(' • ');
    document.getElementById('castLine').textContent = cast || 'No cast information available.';

    const moreLike = document.getElementById('moreLike');
    moreLike.innerHTML = '';
    (similar.results || []).slice(0, 12).forEach((movie) => {
      const card = document.createElement('a');
      card.className = 'movie-card';
      card.href = `./?id=${encodeURIComponent(movie.id)}&type=tmdb`;
      card.innerHTML = `
        <img src="${movie.poster_path ? `https://image.tmdb.org/t/p/w342${movie.poster_path}` : 'https://via.placeholder.com/342x513?text=No+Image'}" alt="${esc(movie.title)} poster" />
        <div class="meta"><strong>${esc(movie.title)}</strong><div class="subtitle">${esc((movie.release_date || '').slice(0, 4) || 'N/A')}</div></div>
      `;
      moreLike.appendChild(card);
    });

    const watchUrl = `./watch/viewer.html?id=${encodeURIComponent(rawId)}&type=${encodeURIComponent(idType.value)}&tmdb=${tmdbId}${imdbId ? `&imdb=${encodeURIComponent(imdbId)}` : ''}`;
    document.getElementById('watchLink').href = watchUrl;
    document.getElementById('watchBtn').onclick = () => { window.location.href = watchUrl; };
    document.getElementById('tmdbLink').href = `https://www.themoviedb.org/movie/${tmdbId}`;

    status.textContent = `Loaded ${details.title}.`;
    history.replaceState({}, '', `?id=${encodeURIComponent(rawId)}&type=${encodeURIComponent(idType.value)}`);
  } catch (error) {
    status.textContent = error.message || 'Could not load movie details.';
  }
}

document.getElementById('loadBtn').addEventListener('click', () => loadMovie(idInput.value));

const initialId = params.get('id');
const initialType = params.get('type') || 'auto';
if (['auto', 'tmdb', 'imdb'].includes(initialType)) idType.value = initialType;
if (initialId) {
  idInput.value = initialId;
  loadMovie(initialId);
}
})();
