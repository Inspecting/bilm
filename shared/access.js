(() => {
  const ACCESS_KEY = 'bilm-site-unlocked';
  const USER_CODE_KEY = 'bilm-user-code';
  const ACCESS_GATE_PATH = '/bilm/random/rng.html';
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
