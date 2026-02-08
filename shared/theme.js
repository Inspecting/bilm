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
    return;
  }

  const STORAGE_KEY = 'bilm-theme-settings';
  const DEFAULT_SETTINGS = {
    accent: '#a855f7',
    background: 'deep',
    customBackground: '#0b0b14',
    motion: true,
    particles: true,
    defaultServer: 'vidsrc',
    searchHistory: true,
    continueWatching: true
  };

  const backgroundColors = {
    deep: '#0b0b14',
    midnight: '#05050b',
    velvet: '#120818',
    aurora: '#062a2a',
    slate: '#111827',
    sunset: '#2a1326'
  };

  const hexToRgb = (hex) => {
    if (!hex) return null;
    const clean = hex.replace('#', '').trim();
    if (clean.length !== 6) return null;
    const num = parseInt(clean, 16);
    if (Number.isNaN(num)) return null;
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  };

  const applyAccent = (root, accent) => {
    const safeAccent = accent || DEFAULT_SETTINGS.accent;
    root.style.setProperty('--accent', safeAccent);
    const rgb = hexToRgb(safeAccent);
    if (rgb) {
      root.style.setProperty('--accent-soft', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.2)`);
      root.style.setProperty('--accent-glow', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.45)`);
      root.style.setProperty('--accent-strong', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.75)`);
    }
  };

  const applyTheme = (settings) => {
    const root = document.documentElement;
    applyAccent(root, settings.accent);
    root.dataset.background = settings.background || DEFAULT_SETTINGS.background;
    root.dataset.motion = settings.motion === false ? 'off' : 'on';

    if (root.dataset.background === 'custom') {
      root.style.setProperty('--bg-custom', settings.customBackground || DEFAULT_SETTINGS.customBackground);
    }

    const themeColor = root.dataset.background === 'custom'
      ? (settings.customBackground || DEFAULT_SETTINGS.customBackground)
      : (backgroundColors[root.dataset.background] || backgroundColors.deep);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', themeColor);
    }

    window.dispatchEvent(new CustomEvent('bilm:theme-changed', { detail: settings }));
  };

  const loadSettings = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  };

  const saveSettings = (settings) => {
    const next = { ...DEFAULT_SETTINGS, ...settings };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      return;
    }
    applyTheme(next);
  };

  const resetTheme = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      return;
    }
    applyTheme({ ...DEFAULT_SETTINGS });
  };

  const initial = loadSettings();
  applyTheme(initial);

  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    applyTheme(loadSettings());
  });

  window.bilmTheme = {
    STORAGE_KEY,
    DEFAULT_SETTINGS,
    getSettings: loadSettings,
    setSettings: saveSettings,
    resetTheme,
    applyTheme
  };
})();
