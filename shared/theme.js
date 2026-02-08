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
  const INCOGNITO_BACKUP_KEY = 'bilm-incognito-backup';
  const INCOGNITO_STORAGE_KEYS = [
    'bilm-search-history',
    'bilm-watch-history',
    'bilm-continue-watching',
    'bilm-favorites',
    'bilm-watch-later'
  ];
  const INCOGNITO_PREFIXES = ['bilm-tv-progress-'];
  const DEFAULT_SETTINGS = {
    accent: '#a855f7',
    background: 'deep',
    customBackground: '#0b0b14',
    motion: true,
    particles: true,
    defaultServer: 'vidsrc',
    searchHistory: true,
    continueWatching: true,
    incognito: false
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

  const safeParse = (value, fallback) => {
    if (!value) return fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  };

  const isIncognitoKey = (key) => {
    if (!key) return false;
    if (INCOGNITO_STORAGE_KEYS.includes(key)) return true;
    return INCOGNITO_PREFIXES.some(prefix => key.startsWith(prefix));
  };

  const collectIncognitoKeys = () => {
    const keys = new Set(INCOGNITO_STORAGE_KEYS);
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (isIncognitoKey(key)) {
          keys.add(key);
        }
      }
    } catch {
      return [...keys];
    }
    return [...keys];
  };

  const handleIncognitoTransition = (prevSettings, nextSettings) => {
    const wasIncognito = prevSettings?.incognito === true;
    const isIncognito = nextSettings?.incognito === true;
    if (wasIncognito === isIncognito) return;

    if (isIncognito) {
      let backup = null;
      try {
        backup = localStorage.getItem(INCOGNITO_BACKUP_KEY);
      } catch {
        backup = null;
      }
      if (!backup) {
        const snapshot = {};
        const keysToBackup = collectIncognitoKeys();
        keysToBackup.forEach((key) => {
          try {
            const value = localStorage.getItem(key);
            if (value !== null) snapshot[key] = value;
          } catch {
            return;
          }
        });
        try {
          localStorage.setItem(INCOGNITO_BACKUP_KEY, JSON.stringify(snapshot));
        } catch {
          return;
        }
      }
      const keysToClear = collectIncognitoKeys();
      keysToClear.forEach((key) => {
        try {
          localStorage.removeItem(key);
        } catch {
          return;
        }
      });
    } else {
      let backup = {};
      try {
        backup = safeParse(localStorage.getItem(INCOGNITO_BACKUP_KEY), {});
      } catch {
        backup = {};
      }
      const keysToRestore = collectIncognitoKeys();
      keysToRestore.forEach((key) => {
        try {
          if (Object.prototype.hasOwnProperty.call(backup, key)) {
            localStorage.setItem(key, backup[key]);
          } else {
            localStorage.removeItem(key);
          }
        } catch {
          return;
        }
      });
      try {
        localStorage.removeItem(INCOGNITO_BACKUP_KEY);
      } catch {
        return;
      }
      keysToRestore.forEach((key) => {
        try {
          sessionStorage.removeItem(key);
        } catch {
          return;
        }
      });
    }
  };

  let currentSettings = loadSettings();

  const getStorageForKey = (key) => {
    if (currentSettings?.incognito === true && isIncognitoKey(key)) {
      return sessionStorage;
    }
    return localStorage;
  };

  const storageAPI = {
    getItem(key) {
      try {
        return getStorageForKey(key).getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        getStorageForKey(key).setItem(key, value);
      } catch {
        return;
      }
    },
    removeItem(key) {
      try {
        getStorageForKey(key).removeItem(key);
      } catch {
        return;
      }
    },
    getJSON(key, fallback = null) {
      const raw = storageAPI.getItem(key);
      return safeParse(raw, fallback);
    },
    setJSON(key, value) {
      storageAPI.setItem(key, JSON.stringify(value));
    }
  };

  const saveSettings = (settings) => {
    const next = { ...DEFAULT_SETTINGS, ...settings };
    handleIncognitoTransition(currentSettings, next);
    currentSettings = next;
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

  currentSettings = loadSettings();
  applyTheme(currentSettings);

  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    const next = loadSettings();
    handleIncognitoTransition(currentSettings, next);
    currentSettings = next;
    applyTheme(next);
  });

  window.bilmTheme = {
    STORAGE_KEY,
    DEFAULT_SETTINGS,
    getSettings: loadSettings,
    setSettings: saveSettings,
    resetTheme,
    applyTheme,
    storage: storageAPI
  };
})();
