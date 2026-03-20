(function initBilmMediaIdentity(global) {
  const APP_ROOTS = new Set([
    'home',
    'movies',
    'tv',
    'games',
    'search',
    'settings',
    'random',
    'test',
    'shared',
    'index.html'
  ]);
  const APP_ROUTE_PATTERN = /^\/(?:home|movies|tv|games|search|settings|random|test|shared)(?:\/|$)/i;
  const MIGRATION_META_KEY = 'bilm-media-identity-migration-v3';
  const MIGRATION_QUARANTINE_KEY = 'bilm-media-identity-quarantine-v1';
  const MIGRATION_QUARANTINE_META_KEY = 'bilm-media-identity-quarantine-meta-v1';
  const MIGRATED_LIST_KEYS = Object.freeze([
    'bilm-favorites',
    'bilm-watch-later',
    'bilm-continue-watching',
    'bilm-watch-history',
    'bilm-history-movies',
    'bilm-history-tv'
  ]);
  const WATCH_HISTORY_MIGRATION_KEYS = new Set([
    'bilm-watch-history',
    'bilm-history-movies',
    'bilm-history-tv'
  ]);

  function detectBasePath() {
    const appRoots = new Set(['home', 'movies', 'tv', 'games', 'search', 'settings', 'random', 'test', 'shared', 'index.html']);
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (!parts.length) return '';
    
    const appRootIndex = parts.findIndex((part) => appRoots.has(part));
    if (appRootIndex >= 0) {
      if (appRootIndex === 0) return '';
      return `/${parts.slice(0, appRootIndex).join('/')}`;
    }
    
    if (parts[0] === 'gh' && parts.length >= 3) {
      return `/${parts.slice(0, 3).join('/')}`;
    }
    if (parts[0] === 'npm' && parts.length >= 2) {
      return `/${parts.slice(0, 2).join('/')}`;
    }
    if (parts.length === 1) {
      return `/${parts[0]}`;
    }
    return '';
  }

  function withBase(path) {
    const normalized = String(path || '').startsWith('/') ? String(path) : `/${String(path || '')}`;
    return `${detectBasePath()}${normalized}`;
  }

  function normalizeInternalAppPath(pathname = '') {
    const rawPath = String(pathname || '').trim();
    if (!rawPath) return '';
    const normalizedPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    const basePath = detectBasePath();
    if (!basePath) return normalizedPath;
    if (normalizedPath === basePath || normalizedPath.startsWith(`${basePath}/`)) return normalizedPath;
    if (!APP_ROUTE_PATTERN.test(normalizedPath)) return normalizedPath;
    return `${basePath}${normalizedPath}`;
  }

  function toPositiveInt(value) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function normalizeProvider(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '';
    if (normalized === 'anilist' || normalized === 'anime') return 'anilist';
    if (normalized === 'tmdb' || normalized === 'themoviedb' || normalized === 'movie_db') return 'tmdb';
    return '';
  }

  function normalizeType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'tv' || normalized === 'series' || normalized === 'show') return 'tv';
    if (normalized === 'movie' || normalized === 'film') return 'movie';
    return '';
  }

  function toMediaTypeFromAniListFormat(formatValue) {
    const normalized = String(formatValue || '').trim().toUpperCase();
    if (!normalized) return 'tv';
    return normalized === 'MOVIE' ? 'movie' : 'tv';
  }

  function parseUrl(rawUrl = '') {
    try {
      const href = String(rawUrl || '').trim();
      if (!href) return null;
      return new URL(href, global.location?.href || 'http://localhost');
    } catch {
      return null;
    }
  }

  function inferProviderFromKey(rawKey = '') {
    const key = String(rawKey || '').trim();
    if (!key) return '';
    if (key.includes(':')) {
      return normalizeProvider(key.split(':')[0]);
    }
    if (/^anime-/i.test(key)) return 'anilist';
    if (/^movie-/i.test(key) || /^tv-/i.test(key)) return 'tmdb';
    return '';
  }

  function inferTypeFromKey(rawKey = '') {
    const key = String(rawKey || '').trim();
    if (!key) return '';
    if (key.includes(':')) {
      const segments = key.split(':');
      if (segments.length >= 2) return normalizeType(segments[1]);
    }
    if (/^anime-tv-/i.test(key) || /^tv-/i.test(key)) return 'tv';
    if (/^anime-movie-/i.test(key) || /^movie-/i.test(key)) return 'movie';
    return '';
  }

  function inferTypeFromPath(pathname = '') {
    const normalized = String(pathname || '').toLowerCase();
    if (/\/tv\//i.test(normalized)) return 'tv';
    if (/\/movies?\//i.test(normalized)) return 'movie';
    return '';
  }

  function resolveIdentity(item, options = {}) {
    const source = item && typeof item === 'object' ? item : {};
    const rawKey = String(source.key || '').trim();
    const rawLink = String(source.link || '').trim();
    const parsedUrl = parseUrl(rawLink);
    const params = parsedUrl?.searchParams || null;
    const hasAnimeFlag = params?.get('anime') === '1' || params?.has('aid') || /[?&]anime=1(?:&|$)/i.test(rawLink);

    let provider = normalizeProvider(options.preferProvider)
      || normalizeProvider(source.provider)
      || normalizeProvider(source.source)
      || inferProviderFromKey(rawKey)
      || (hasAnimeFlag ? 'anilist' : '');
    if (!provider) provider = 'tmdb';

    let type = normalizeType(options.preferType)
      || normalizeType(source.type)
      || inferTypeFromKey(rawKey)
      || normalizeType(params?.get('type'))
      || inferTypeFromPath(parsedUrl?.pathname || '');
    if (!type) type = 'movie';

    let anilistId = toPositiveInt(source.anilistId);
    let tmdbId = toPositiveInt(source.tmdbId);
    const genericId = toPositiveInt(source.id);

    if (!anilistId && hasAnimeFlag) {
      anilistId = toPositiveInt(params?.get('aid')) || genericId || tmdbId;
    }
    if (!tmdbId && !hasAnimeFlag) {
      tmdbId = toPositiveInt(params?.get('id')) || genericId;
    }

    if (provider === 'anilist') {
      if (!anilistId) anilistId = genericId || tmdbId || toPositiveInt(params?.get('aid'));
      tmdbId = options.allowAnimeTmdbId === true ? tmdbId : 0;
    } else {
      if (!tmdbId) tmdbId = genericId || toPositiveInt(params?.get('id'));
      anilistId = 0;
    }

    const id = provider === 'anilist' ? anilistId : tmdbId;
    const key = id > 0 ? `${provider}:${type}:${id}` : rawKey;

    return {
      provider,
      type,
      id,
      key,
      anilistId,
      tmdbId,
      hasAnimeFlag,
      rawLink,
      parsedUrl
    };
  }

  function buildDetailsLink(identityInput = {}) {
    const identity = resolveIdentity(identityInput, {
      preferProvider: identityInput.provider,
      preferType: identityInput.type,
      allowAnimeTmdbId: true
    });
    if (!identity.id) return '';
    if (identity.provider === 'anilist') {
      const base = identity.type === 'tv' ? withBase('/tv/show.html') : withBase('/movies/show.html');
      return `${base}?anime=1&aid=${encodeURIComponent(identity.id)}&type=${encodeURIComponent(identity.type)}`;
    }
    const base = identity.type === 'tv' ? withBase('/tv/show.html') : withBase('/movies/show.html');
    return `${base}?id=${encodeURIComponent(identity.id)}`;
  }

  function normalizeSameOriginLink(rawLink = '') {
    const parsed = parseUrl(rawLink);
    if (!parsed) return String(rawLink || '').trim();
    const sameOrigin = parsed.origin === String(global.location?.origin || '');
    if (!sameOrigin) return parsed.toString();
    const normalizedPath = normalizeInternalAppPath(parsed.pathname);
    return `${normalizedPath}${parsed.search}${parsed.hash}`;
  }

  function canonicalizeStoredItem(item, options = {}) {
    if (!item || typeof item !== 'object') return null;
    const identity = resolveIdentity(item, options);
    const next = { ...item };

    if (identity.provider) next.provider = identity.provider;
    if (identity.type) next.type = identity.type;
    if (identity.key) next.key = identity.key;
    if (identity.id > 0) next.id = identity.id;
    if (!next.updatedAt) next.updatedAt = Date.now();
    if (!next.source) next.source = identity.provider === 'anilist' ? 'AniList' : 'TMDB';

    if (identity.provider === 'anilist') {
      if (identity.anilistId > 0) next.anilistId = identity.anilistId;
      delete next.tmdbId;
      next.link = buildDetailsLink(identity);
    } else {
      if (identity.tmdbId > 0) next.tmdbId = identity.tmdbId;
      delete next.anilistId;
      next.link = buildDetailsLink(identity);
    }

    if (!next.link) {
      next.link = normalizeSameOriginLink(identity.rawLink || '');
    }

    return next;
  }

  function createStoredMediaItem(payload = {}) {
    const provider = normalizeProvider(payload.provider) || 'tmdb';
    const type = normalizeType(payload.type) || 'movie';
    const id = toPositiveInt(payload.id || (provider === 'anilist' ? payload.anilistId : payload.tmdbId));
    if (!id) return null;
    const item = canonicalizeStoredItem({
      ...payload,
      provider,
      type,
      id,
      updatedAt: payload.updatedAt || Date.now()
    }, {
      preferProvider: provider,
      preferType: type
    });
    if (!item) return null;
    return item;
  }

  function getIdentityKey(item) {
    return resolveIdentity(item).key;
  }

  function isSameIdentity(left, right) {
    const a = resolveIdentity(left);
    const b = resolveIdentity(right);
    if (a.key && b.key) return a.key === b.key;
    return a.provider === b.provider && a.type === b.type && a.id > 0 && a.id === b.id;
  }

  function findIndexByIdentity(list, target) {
    const items = Array.isArray(list) ? list : [];
    for (let index = 0; index < items.length; index += 1) {
      if (isSameIdentity(items[index], target)) return index;
    }
    return -1;
  }

  function hasIdentity(list, target) {
    return findIndexByIdentity(list, target) >= 0;
  }

  function resolveDetailsDestination(item, fallbackType = 'movie') {
    const identity = resolveIdentity(item, { preferType: fallbackType });
    if (identity.id > 0) return buildDetailsLink(identity);

    const rawLink = String(item?.link || '').trim();
    if (!rawLink) return '';
    return normalizeSameOriginLink(rawLink);
  }

  function dedupeCanonicalItems(items = []) {
    const map = new Map();
    const list = Array.isArray(items) ? items : [];
    list.forEach((item) => {
      const canonical = canonicalizeStoredItem(item);
      if (!canonical) return;
      const key = String(canonical.key || '').trim();
      if (!key) return;
      const current = map.get(key);
      const currentUpdatedAt = Number(current?.updatedAt || 0) || 0;
      const candidateUpdatedAt = Number(canonical.updatedAt || 0) || 0;
      if (!current || candidateUpdatedAt >= currentUpdatedAt) {
        map.set(key, canonical);
      }
    });
    return [...map.values()].sort((a, b) => (Number(b?.updatedAt || 0) || 0) - (Number(a?.updatedAt || 0) || 0));
  }

  function readJsonArray(storageKey) {
    try {
      const raw = global.localStorage?.getItem(storageKey);
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeJsonArray(storageKey, value) {
    global.localStorage?.setItem(storageKey, JSON.stringify(value));
  }

  function readQuarantineEntries() {
    return readJsonArray(MIGRATION_QUARANTINE_KEY);
  }

  function writeQuarantineEntries(entries) {
    writeJsonArray(MIGRATION_QUARANTINE_KEY, entries);
  }

  function getQuarantineCount() {
    return readQuarantineEntries().length;
  }

  function setQuarantineMeta(partial = {}) {
    try {
      const previous = JSON.parse(global.localStorage?.getItem(MIGRATION_QUARANTINE_META_KEY) || '{}') || {};
      global.localStorage?.setItem(MIGRATION_QUARANTINE_META_KEY, JSON.stringify({
        ...previous,
        ...partial
      }));
    } catch {
      // Best effort meta write.
    }
  }

  function hashLegacyItem(value) {
    const text = String(value || '');
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash >>> 0);
  }

  function makeLegacyFallbackItem(rawItem, restoreIndex = 0) {
    const source = rawItem && typeof rawItem === 'object' ? rawItem : {};
    const type = normalizeType(source.type) || 'movie';
    const provider = normalizeProvider(source.provider) || 'tmdb';
    const seeded = hashLegacyItem(JSON.stringify(source)) + Math.max(0, Number(restoreIndex) || 0);
    const fallbackId = (seeded % 900000000) + 100000000;
    return {
      ...source,
      provider,
      type,
      id: toPositiveInt(source.id) || fallbackId,
      updatedAt: Number(source.updatedAt || 0) || Date.now()
    };
  }

  function appendQuarantineEntries(entries = []) {
    const incoming = Array.isArray(entries) ? entries : [];
    if (!incoming.length) return 0;
    const current = readQuarantineEntries();
    const next = [...incoming, ...current].slice(0, 500);
    writeQuarantineEntries(next);
    setQuarantineMeta({
      lastUpdatedAtMs: Date.now(),
      count: next.length
    });
    return incoming.length;
  }

  function isWatchHistoryListKey(storageKey) {
    return WATCH_HISTORY_MIGRATION_KEYS.has(String(storageKey || '').trim());
  }

  function migrateList(storageKey, quarantineEntries = []) {
    const current = readJsonArray(storageKey);
    if (!current.length) return { changed: false, quarantined: 0 };
    const shouldDedupeByIdentity = !isWatchHistoryListKey(storageKey);
    const map = shouldDedupeByIdentity ? new Map() : null;
    const migrated = [];
    let quarantined = 0;
    current.forEach((item) => {
      const canonical = canonicalizeStoredItem(item);
      const key = String(canonical?.key || '').trim();
      if (!canonical || !key) {
        quarantined += 1;
        quarantineEntries.push({
          storageKey,
          reason: 'missing_identity_key',
          quarantinedAtMs: Date.now(),
          item
        });
        return;
      }
      if (!shouldDedupeByIdentity) {
        migrated.push(canonical);
        return;
      }
      const currentEntry = map.get(key);
      const currentUpdatedAt = Number(currentEntry?.updatedAt || 0) || 0;
      const candidateUpdatedAt = Number(canonical.updatedAt || 0) || 0;
      if (!currentEntry || candidateUpdatedAt >= currentUpdatedAt) {
        map.set(key, canonical);
      }
    });
    const output = shouldDedupeByIdentity
      ? [...map.values()].sort((a, b) => (Number(b?.updatedAt || 0) || 0) - (Number(a?.updatedAt || 0) || 0))
      : migrated;
    const before = JSON.stringify(current);
    const after = JSON.stringify(output);
    const changed = before !== after;
    if (changed) {
      writeJsonArray(storageKey, output);
    }
    return { changed, quarantined };
  }

  function restoreQuarantinedItems() {
    const entries = readQuarantineEntries();
    if (!entries.length) {
      return { restored: 0, remaining: 0 };
    }

    const grouped = new Map();
    entries.forEach((entry, index) => {
      const storageKey = String(entry?.storageKey || '').trim();
      if (!storageKey) return;
      const fallbackItem = makeLegacyFallbackItem(entry?.item, index);
      const canonical = canonicalizeStoredItem(fallbackItem, {
        preferProvider: fallbackItem.provider,
        preferType: fallbackItem.type,
        allowAnimeTmdbId: true
      }) || {
        ...fallbackItem,
        key: `legacy:${fallbackItem.type}:${fallbackItem.id || (Date.now() + index)}`
      };
      if (!grouped.has(storageKey)) grouped.set(storageKey, []);
      grouped.get(storageKey).push(canonical);
    });

    let restored = 0;
    grouped.forEach((items, storageKey) => {
      const existing = readJsonArray(storageKey);
      const merged = isWatchHistoryListKey(storageKey)
        ? [...(Array.isArray(items) ? items : []), ...existing]
          .map((entry) => canonicalizeStoredItem(entry) || entry)
          .filter((entry) => {
            const identityKey = String(entry?.key || '').trim();
            return Boolean(entry) && Boolean(identityKey);
          })
        : dedupeCanonicalItems([...(Array.isArray(items) ? items : []), ...existing]);
      writeJsonArray(storageKey, merged);
      restored += Array.isArray(items) ? items.length : 0;
    });

    global.localStorage?.removeItem(MIGRATION_QUARANTINE_KEY);
    setQuarantineMeta({
      restoredAtMs: Date.now(),
      restoredCount: restored,
      count: 0
    });
    return { restored, remaining: 0 };
  }

  function migrateLocalListsOnce() {
    try {
      const previous = global.localStorage?.getItem(MIGRATION_META_KEY);
      if (String(previous || '').trim()) return false;

      let changed = false;
      const quarantinedEntries = [];
      let quarantined = 0;
      MIGRATED_LIST_KEYS.forEach((storageKey) => {
        const result = migrateList(storageKey, quarantinedEntries);
        if (result.changed) changed = true;
        quarantined += Number(result.quarantined || 0) || 0;
      });
      if (quarantinedEntries.length) {
        appendQuarantineEntries(quarantinedEntries);
      }
      global.localStorage?.setItem(MIGRATION_META_KEY, JSON.stringify({
        migratedAtMs: Date.now(),
        changed,
        quarantined
      }));
      return changed;
    } catch {
      return false;
    }
  }

  global.BilmMediaIdentity = {
    MIGRATION_META_KEY,
    toMediaTypeFromAniListFormat,
    resolveIdentity,
    buildDetailsLink,
    resolveDetailsDestination,
    canonicalizeStoredItem,
    createStoredMediaItem,
    getIdentityKey,
    isSameIdentity,
    findIndexByIdentity,
    hasIdentity,
    dedupeCanonicalItems,
    MIGRATION_QUARANTINE_KEY,
    getQuarantineCount,
    readQuarantineEntries,
    restoreQuarantinedItems,
    migrateLocalListsOnce,
    normalizeInternalAppPath,
    normalizeSameOriginLink,
    withBase
  };

  try {
    migrateLocalListsOnce();
  } catch {
    // Best-effort migration.
  }
})(window);
