(() => {
  const container =
    document.getElementById('navbarContainer') ||
    document.getElementById('navbar-placeholder');

  if (!container) return;

  fetch('/bilm/shared/navbar.html')
    .then(res => res.text())
    .then(html => {
      container.innerHTML = html;

      const existingCss = document.querySelector('link[data-navbar-css]');
      if (!existingCss) {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = '/bilm/shared/navbar.css';
        css.setAttribute('data-navbar-css', 'true');
        document.head.appendChild(css);
      }

      const existingScript = document.querySelector('script[data-navbar-js]');
      if (!existingScript) {
        const script = document.createElement('script');
        script.src = '/bilm/shared/navbar.js';
        script.setAttribute('data-navbar-js', 'true');
        document.body.appendChild(script);
      }
    });
})();
