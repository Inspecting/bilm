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
