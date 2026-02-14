(() => {
  const USER_CODE_KEY = 'bilm-user-code';

  try {
    if (!localStorage.getItem(USER_CODE_KEY)) {
      const generatedCode = `BC-${Math.random().toString(36).slice(2, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase().slice(-6)}`;
      localStorage.setItem(USER_CODE_KEY, generatedCode);
    }
  } catch {
    // Ignore storage failures.
  }
})();
