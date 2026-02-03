const TMDB_API_KEY = '3ade810499876bb5672f40e54960e6a2';
const OMDB_API_KEY = '9bf8cd26';
const BASE_URL = 'https://inspecting.github.io/bilm';

const urlParams = new URLSearchParams(window.location.search);
const currentQuery = urlParams.get('q') || '';

const resultsTitle = document.getElementById('resultsTitle');
const moviesSection = document.getElementById('moviesSection');
const tvSection = document.getElementById('tvSection');
const moviesResults = document.getElementById('moviesResults');
const tvResults = document.getElementById('tvResults');

resultsTitle.textContent = `Search Results for "${currentQuery}"`;

function fetchImdbMovies(query) {
  if (!query) return Promise.resolve([]);
  const firstChar = query[0].toLowerCase();
  const url = `https://v2.sg.media-imdb.com/suggestion/${firstChar}/${encodeURIComponent(query)}.json`;
  return fetch(url)
    .then(res => res.json())
    .then(data => {
      if (!data.d) return [];
      return data.d.filter(item => item.qid === 'movie').map(item => ({
        title: item.l,
        year: item.y || 'N/A',
        img: item.i?.[0] || 'https://via.placeholder.com/140x210?text=No+Image',
        link: `${BASE_URL}/movies/viewer.html?id=${item.id}`,
        source: 'IMDb-v2'
      }));
    })
    .catch(() => []);
}

function fetchTvmazeShows(query) {
  if (!query) return Promise.resolve([]);
  const url = `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`;
  return fetch(url)
    .then(res => res.json())
    .then(data => {
      if (!Array.isArray(data)) return [];
      return data.map(item => {
        const show = item.show;
        return {
          title: show.name,
          year: show.premiered ? show.premiered.slice(0, 4) : 'N/A',
          img: show.image?.medium || 'https://via.placeholder.com/140x210?text=No+Image',
          link: `${BASE_URL}/tv/viewer.html?id=${show.id}`,
          source: 'TVmaze'
        };
      });
    })
    .catch(() => []);
}

if (currentQuery) {
  Promise.all([
    fetch(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(currentQuery)}`).then(r => r.json()),
    fetch(`https://api.themoviedb.org/3/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(currentQuery)}`).then(r => r.json()),
    fetch(`https://www.omdbapi.com/?s=${encodeURIComponent(currentQuery)}&apikey=${OMDB_API_KEY}&type=movie`).then(r => r.json()),
    fetchImdbMovies(currentQuery),
    fetchTvmazeShows(currentQuery)
  ])
    .then(([tmdbMovies, tmdbTV, omdbMovies, imdbMovies, tvmazeShows]) => {
      const movieMap = new Map();
      const tvMap = new Map();

      (tmdbMovies.results || []).forEach(item => {
        const key = `${item.title.toLowerCase()}-${item.release_date?.slice(0, 4)}`;
        if (!movieMap.has(key)) {
          movieMap.set(key, {
            title: item.title,
            year: item.release_date?.slice(0, 4) || 'N/A',
            img: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://via.placeholder.com/140x210?text=No+Image',
            link: `${BASE_URL}/movies/viewer.html?id=${item.id}`,
            source: 'TMDB'
          });
        }
      });

      (omdbMovies.Search || []).forEach(item => {
        const key = `${item.Title.toLowerCase()}-${item.Year}`;
        if (!movieMap.has(key)) {
          movieMap.set(key, {
            title: item.Title,
            year: item.Year,
            img: item.Poster !== 'N/A' ? item.Poster : 'https://via.placeholder.com/140x210?text=No+Image',
            link: `${BASE_URL}/movies/viewer.html?id=${item.imdbID}`,
            source: 'OMDB'
          });
        }
      });

      imdbMovies.forEach(item => {
        const key = `${item.title.toLowerCase()}-${item.year}`;
        if (!movieMap.has(key)) {
          movieMap.set(key, item);
        }
      });

      (tmdbTV.results || []).forEach(item => {
        const key = `${item.name.toLowerCase()}-${item.first_air_date?.slice(0, 4)}`;
        if (!tvMap.has(key)) {
          tvMap.set(key, {
            title: item.name,
            year: item.first_air_date?.slice(0, 4) || 'N/A',
            img: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : 'https://via.placeholder.com/140x210?text=No+Image',
            link: `${BASE_URL}/tv/viewer.html?id=${item.id}`,
            source: 'TMDB'
          });
        }
      });

      tvmazeShows.forEach(item => {
        const key = `${item.title.toLowerCase()}-${item.year}`;
        if (!tvMap.has(key)) {
          tvMap.set(key, item);
        }
      });

      if (movieMap.size > 0) {
        renderResults(moviesResults, Array.from(movieMap.values()));
        moviesSection.style.display = 'block';
      } else {
        moviesSection.style.display = 'none';
      }

      if (tvMap.size > 0) {
        renderResults(tvResults, Array.from(tvMap.values()));
        tvSection.style.display = 'block';
      } else {
        tvSection.style.display = 'none';
      }
    })
    .catch(err => {
      console.error('Search failed', err);
      moviesSection.innerHTML = '<p class="no-results">Failed to load results.</p>';
      tvSection.innerHTML = '';
    });
} else {
  moviesSection.innerHTML = '<p class="no-results">Please enter a search term.</p>';
  tvSection.innerHTML = '';
}

function renderResults(container, items) {
  container.innerHTML = '';
  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'card';

    const img = document.createElement('img');
    img.src = item.img;
    img.alt = item.title;
    img.onerror = () => {
      img.src = 'https://via.placeholder.com/140x210?text=No+Image';
    };

    const title = document.createElement('p');
    title.textContent = `${item.title} (${item.year})`;

    card.appendChild(img);
    card.appendChild(title);

    card.dataset.source = item.source;

    card.onclick = () => {
      console.log(`🟣 Clicked on "${item.title}" from API: ${item.source}`);
      window.location.href = item.link;
    };

    container.appendChild(card);
  });
}
