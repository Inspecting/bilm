(() => {
  const WATCH_HISTORY_KEY = 'bilm-watch-history-v1';
  const SEARCH_HISTORY_KEY = 'bilm-search-history-v1';
  const LEGACY_SEARCH_HISTORY_KEY = 'bilm-search-history';
  const MAX_WATCH_ITEMS = 200;
  const MAX_SEARCH_ITEMS = 10;

  function safeRead(key) {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function safeWrite(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
  }

  function getSearchHistory() {
    const current = safeRead(SEARCH_HISTORY_KEY);
    if (current.length) {
      return current.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }

    const legacy = safeRead(LEGACY_SEARCH_HISTORY_KEY)
      .filter((item) => item && typeof item.query === 'string')
      .map((item) => ({
        query: item.query.trim(),
        updatedAt: Number(item.updatedAt) || Date.now(),
        source: item.source || 'home'
      }));

    if (legacy.length) {
      const deduped = [];
      const seen = new Set();
      legacy
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .forEach((item) => {
          const token = normalizeText(item.query);
          if (!token || seen.has(token)) return;
          seen.add(token);
          deduped.push(item);
        });
      const trimmed = deduped.slice(0, MAX_SEARCH_ITEMS);
      safeWrite(SEARCH_HISTORY_KEY, trimmed);
      return trimmed;
    }

    return [];
  }

  function upsertSearchHistory(entry) {
    const query = (entry?.query || '').trim();
    if (!query) return getSearchHistory();

    const nextItem = {
      query,
      source: entry?.source || 'home',
      updatedAt: Date.now()
    };

    const existing = getSearchHistory().filter((item) => normalizeText(item.query) !== normalizeText(query));
    const next = [nextItem, ...existing].slice(0, MAX_SEARCH_ITEMS);
    safeWrite(SEARCH_HISTORY_KEY, next);
    return next;
  }

  function removeSearchHistory(query) {
    const token = normalizeText(query);
    const next = getSearchHistory().filter((item) => normalizeText(item.query) !== token);
    safeWrite(SEARCH_HISTORY_KEY, next);
    return next;
  }

  function clearSearchHistory() {
    localStorage.removeItem(SEARCH_HISTORY_KEY);
    localStorage.removeItem(LEGACY_SEARCH_HISTORY_KEY);
  }

  function getWatchHistory() {
    return safeRead(WATCH_HISTORY_KEY)
      .filter((item) => item && item.key)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function upsertWatchHistory(entry) {
    if (!entry?.key) return getWatchHistory();
    const payload = {
      ...entry,
      updatedAt: Date.now()
    };
    const next = [payload, ...getWatchHistory().filter((item) => item.key !== payload.key)].slice(0, MAX_WATCH_ITEMS);
    safeWrite(WATCH_HISTORY_KEY, next);
    return next;
  }

  function removeWatchHistory(key) {
    const next = getWatchHistory().filter((item) => item.key !== key);
    safeWrite(WATCH_HISTORY_KEY, next);
    return next;
  }

  function clearWatchHistory() {
    localStorage.removeItem(WATCH_HISTORY_KEY);
  }

  window.bilmHistory = {
    KEYS: {
      WATCH_HISTORY_KEY,
      SEARCH_HISTORY_KEY
    },
    LIMITS: {
      MAX_WATCH_ITEMS,
      MAX_SEARCH_ITEMS
    },
    getWatchHistory,
    upsertWatchHistory,
    removeWatchHistory,
    clearWatchHistory,
    getSearchHistory,
    upsertSearchHistory,
    removeSearchHistory,
    clearSearchHistory
  };
})();
