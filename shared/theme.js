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
  const ACCESS_GATE_PATH = withBase('/random/rng.html');
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

  const GA_MEASUREMENT_ID = 'G-KJSZFZNESQ';

  const initAnalytics = () => {
    if (!GA_MEASUREMENT_ID || window.__bilmAnalyticsLoaded) return;
    window.__bilmAnalyticsLoaded = true;

    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function gtag() {
      window.dataLayer.push(arguments);
    };
    window.gtag('js', new Date());
    window.gtag('config', GA_MEASUREMENT_ID);

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
    document.head.appendChild(script);
  };

  initAnalytics();

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
    incognito: false,
    skeletonLoading: true,
    optimisticUi: true,
    commandPalette: true,
    guidedEmptyStates: true,
    microInteractions: true,
    milestones: true,
    smartForms: true,
    smartDefaults: true,
    navHints: true,
    contextualHelp: true,
    accessibilityBoost: true,
    lowDataMode: false,
    smartSearch: true,
    trustSignals: true,
    funMode: true,
    feedbackTools: true,
    offlineMode: true,
    sessionRecovery: true,
    onboardingChecklist: true,
    whatsNew: true
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

    root.dataset.lowDataMode = settings.lowDataMode === true ? 'on' : 'off';
    root.dataset.commandPalette = settings.commandPalette === false ? 'off' : 'on';
    root.dataset.microInteractions = settings.microInteractions === false ? 'off' : 'on';
    root.dataset.funMode = settings.funMode === false ? 'off' : 'on';
    root.dataset.guidedEmptyStates = settings.guidedEmptyStates === false ? 'off' : 'on';
    root.dataset.contextualHelp = settings.contextualHelp === false ? 'off' : 'on';
    root.dataset.accessibilityBoost = settings.accessibilityBoost === false ? 'off' : 'on';
    root.dataset.smartSearch = settings.smartSearch === false ? 'off' : 'on';
    root.dataset.smartForms = settings.smartForms === false ? 'off' : 'on';
    root.dataset.onboardingChecklist = settings.onboardingChecklist === false ? 'off' : 'on';
    root.dataset.whatsNew = settings.whatsNew === false ? 'off' : 'on';

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', themeColor);
    }

    ensureExperience(settings);
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


  const EXPERIENCE_VERSION = '2026.02-experience-pack';
  const SESSION_RECOVERY_PREFIX = 'bilm-recovery:';
  let experienceInitialized = false;
  let commandPaletteNode = null;
  let feedbackButtonNode = null;
  let statusNode = null;
  let checklistNode = null;

  const createStatusNode = () => {
    if (statusNode) return statusNode;
    statusNode = document.createElement('div');
    statusNode.className = 'bilm-status-pill';
    statusNode.hidden = true;
    document.body.appendChild(statusNode);
    return statusNode;
  };

  const showStatus = (text, timeout = 2200) => {
    const node = createStatusNode();
    node.textContent = text;
    node.hidden = false;
    clearTimeout(node._hideTimer);
    node._hideTimer = window.setTimeout(() => {
      node.hidden = true;
    }, timeout);
  };

  const createCommandPalette = () => {
    if (commandPaletteNode) return commandPaletteNode;
    const palette = document.createElement('div');
    palette.className = 'bilm-command-palette';
    palette.innerHTML = `
      <div class="bilm-command-panel" role="dialog" aria-modal="true" aria-label="Quick actions">
        <input class="bilm-command-input" placeholder="Jump to page..." aria-label="Quick action search" />
        <div class="bilm-command-list"></div>
      </div>`;
    const commands = [
      { label: 'Home', href: withBase('/home/') },
      { label: 'Movies', href: withBase('/movies/') },
      { label: 'TV', href: withBase('/tv/') },
      { label: 'Games', href: withBase('/games/') },
      { label: 'Settings', href: withBase('/settings/') },
      { label: 'Search', href: withBase('/search/') }
    ];
    const input = palette.querySelector('.bilm-command-input');
    const list = palette.querySelector('.bilm-command-list');

    const renderCommands = (query = '') => {
      const normalized = query.trim().toLowerCase();
      const items = commands.filter((item) => item.label.toLowerCase().includes(normalized));
      list.innerHTML = '';
      items.forEach((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'bilm-command-item';
        button.textContent = item.label;
        button.addEventListener('click', () => {
          window.location.href = item.href;
        });
        list.appendChild(button);
      });
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'bilm-command-empty';
        empty.textContent = 'No matches';
        list.appendChild(empty);
      }
    };

    renderCommands();
    input.addEventListener('input', () => renderCommands(input.value));
    palette.addEventListener('click', (event) => {
      if (event.target === palette) {
        palette.classList.remove('open');
      }
    });
    document.body.appendChild(palette);
    commandPaletteNode = palette;
    return palette;
  };

  const createFeedbackButton = () => {
    if (feedbackButtonNode) return feedbackButtonNode;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bilm-feedback-button';
    button.textContent = 'Feedback';
    button.addEventListener('click', () => {
      const message = window.prompt('Quick feedback for Bilm:');
      if (!message) return;
      try {
        const log = safeParse(localStorage.getItem('bilm-feedback-log'), []);
        const next = Array.isArray(log) ? log : [];
        next.unshift({ message, at: Date.now(), path: location.pathname });
        localStorage.setItem('bilm-feedback-log', JSON.stringify(next.slice(0, 40)));
        showStatus('Thanks for your feedback 💜');
      } catch {
        showStatus('Feedback saved locally failed.');
      }
    });
    document.body.appendChild(button);
    feedbackButtonNode = button;
    return button;
  };

  const setupSessionRecovery = (enabled) => {
    const forms = document.querySelectorAll('input[type="text"], input[type="search"], textarea');
    forms.forEach((field) => {
      const key = `${SESSION_RECOVERY_PREFIX}${location.pathname}:${field.id || field.name || field.placeholder || 'field'}`;
      if (enabled) {
        if (!field.value) {
          const cached = sessionStorage.getItem(key);
          if (cached) field.value = cached;
        }
        if (!field.dataset.recoveryBound) {
          field.dataset.recoveryBound = 'true';
          field.addEventListener('input', () => {
            try {
              sessionStorage.setItem(key, field.value || '');
            } catch {
              return;
            }
          });
        }
      } else {
        try {
          sessionStorage.removeItem(key);
        } catch {
          return;
        }
      }
    });
  };

  const maybeShowWhatsNew = (settings) => {
    if (settings.whatsNew === false) return;
    const seenKey = 'bilm-whats-new-seen';
    if (localStorage.getItem(seenKey) === EXPERIENCE_VERSION) return;
    showStatus('New: Experience options are now active site-wide.');
    localStorage.setItem(seenKey, EXPERIENCE_VERSION);
  };

  const ensureExperience = (settings) => {
    const root = document.documentElement;
    if (!root.dataset.loaded) root.dataset.loaded = 'false';
    root.dataset.skeletonLoading = settings.skeletonLoading === false ? 'off' : 'on';
    root.dataset.optimisticUi = settings.optimisticUi === false ? 'off' : 'on';
    root.dataset.navHints = settings.navHints === false ? 'off' : 'on';
    root.dataset.trustSignals = settings.trustSignals === false ? 'off' : 'on';
    root.dataset.feedbackTools = settings.feedbackTools === false ? 'off' : 'on';
    root.dataset.offlineMode = settings.offlineMode === false ? 'off' : 'on';
    root.dataset.sessionRecovery = settings.sessionRecovery === false ? 'off' : 'on';

    if (!experienceInitialized) {
      experienceInitialized = true;

      document.addEventListener('keydown', (event) => {
        const palette = createCommandPalette();
        if (event.key === 'Escape' && palette.classList.contains('open')) {
          palette.classList.remove('open');
          return;
        }
        const paletteEnabled = (window.bilmTheme?.getSettings?.().commandPalette) !== false;
        const isShortcut = (event.key && event.key.toLowerCase() === 'k') && (event.ctrlKey || event.metaKey);
        if (!paletteEnabled || !isShortcut) return;
        event.preventDefault();
        palette.classList.add('open');
        const input = palette.querySelector('.bilm-command-input');
        input.value = '';
        input.dispatchEvent(new Event('input'));
        input.focus();
      });

      window.addEventListener('online', () => showStatus('You are back online.'));
      window.addEventListener('offline', () => showStatus('You are offline. Cached pages still work.'));

      window.addEventListener('DOMContentLoaded', () => {
        document.documentElement.dataset.loaded = 'true';
        const liveSettings = window.bilmTheme?.getSettings?.() || settings;
        maybeShowWhatsNew(liveSettings);
        if (liveSettings.onboardingChecklist !== false && location.pathname.includes('/home')) {
          if (!checklistNode) {
            checklistNode = document.createElement('div');
            checklistNode.className = 'bilm-checklist';
            checklistNode.innerHTML = '<h4>Quick checklist</h4><ul><li>Search for a title</li><li>Open a movie or show</li><li>Customize your theme in Settings</li></ul>';
            document.body.appendChild(checklistNode);
          }
          checklistNode.hidden = false;
        }
      });
    }

    const palette = createCommandPalette();
    palette.classList.toggle('feature-disabled', settings.commandPalette === false);
    if (settings.commandPalette === false) palette.classList.remove('open');

    const feedbackButton = createFeedbackButton();
    feedbackButton.hidden = settings.feedbackTools === false;

    if (settings.offlineMode !== false && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register(withBase('/sw.js')).catch(() => null);
    }

    if (settings.smartDefaults !== false) {
      const searchInput = document.querySelector('input[type="search"], input#searchInput');
      if (searchInput && !searchInput.placeholder) {
        searchInput.placeholder = 'Search movies, shows, actors...';
      }
    }

    setupSessionRecovery(settings.sessionRecovery !== false);
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
