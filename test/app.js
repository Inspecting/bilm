const TMDB_API_KEY = '3ade810499876bb5672f40e54960e6a2';

async function tmdb(path, params = {}) {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  url.searchParams.set('api_key', TMDB_API_KEY);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB error: ${res.status}`);
  return res.json();
}

async function resolveMovieId(rawId) {
  const id = String(rawId || '').trim();
  if (!id) throw new Error('Enter a TMDB or IMDb id');
  if (/^\d+$/.test(id)) return { tmdbId: Number(id), inputType: 'tmdb' };
  if (/^tt\d+$/i.test(id)) {
    const data = await tmdb(`/find/${id}`, { external_source: 'imdb_id' });
    const found = data?.movie_results?.[0];
    if (!found?.id) throw new Error('IMDb ID not found on TMDB');
    return { tmdbId: found.id, inputType: 'imdb', imdbId: id };
  }
  throw new Error('ID format not recognized. Use TMDB numeric ID or IMDb ID like tt0133093.');
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

window.TestMovieApp = { tmdb, resolveMovieId, esc };
