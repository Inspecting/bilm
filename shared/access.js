(() => {
function detectBasePath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const appRoots = new Set(['home', 'movies', 'tv', 'games', 'search', 'settings', 'random', 'test', 'shared', 'index.html']);
  if (!parts.length || appRoots.has(parts[0])) return '';
  return `/${parts[0]}`;
}

function withBase(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${detectBasePath()}${normalized}`;
}

  const ACCESS_KEY = 'bilm-site-unlocked';
  const USER_CODE_KEY = 'bilm-user-code';
  const ACCESS_GATE_PATH = withBase('/random/rng.html');
  const path = window.location.pathname;
  const isRngPage = path.includes('/random/rng');
  let hasAccess = false;

  try {
    hasAccess = localStorage.getItem(ACCESS_KEY) === 'true';
  } catch {
    hasAccess = false;
  }


  try {
    if (!localStorage.getItem(USER_CODE_KEY)) {
      const generatedCode = `BC-${Math.random().toString(36).slice(2, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase().slice(-6)}`;
      localStorage.setItem(USER_CODE_KEY, generatedCode);
    }
  } catch {
    // Ignore storage failures.
  }

  if (!hasAccess && !isRngPage) {
    window.location.replace(ACCESS_GATE_PATH);
  }
})();
