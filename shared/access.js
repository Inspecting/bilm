(() => {
  const ACCESS_KEY = 'bilm-site-unlocked';
  const ACCESS_GATE_PATH = '/bilm/random/rng.html';
  const path = window.location.pathname;
  const isRngPage = path.includes('/random/rng');
  let hasAccess = false;

  try {
    hasAccess = localStorage.getItem(ACCESS_KEY) === 'true';
  } catch {
    hasAccess = false;
  }

  if (!hasAccess && !isRngPage) {
    window.location.replace(ACCESS_GATE_PATH);
  }
})();
