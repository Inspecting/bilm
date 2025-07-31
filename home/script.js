document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');

  document.querySelector('main').classList.add('visible');

  searchBtn.onclick = () => {
    const query = searchInput.value.trim();
    if (!query) return alert('Please enter a search term');
    window.location.href = `/bilm/home/search.html?q=${encodeURIComponent(query)}`;
  };

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchBtn.click();
  });
});