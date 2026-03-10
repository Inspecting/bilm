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
  const MIGRATION_META_KEY = 'bilm-media-identity-migration-v2';
  const MIGRATED_LIST_KEYS = Object.freeze([
    'bilm-favorites',
    'bilm-watch-later',
    'bilm-continue-watching',
    'bilm-watch-history',
    'bilm-history-movies',
    'bilm-history-tv'
  ]);

  function detectBasePath() {
    const pathname = String(global.location?.pathname || '/');
    const parts = pathname.split('/').filter(Boolean);
    if (!parts.length || APP_ROOTS.has(parts[0])) return '';
    if (parts.length > 1 && APP_ROOTS.has(parts[1])) return `/${parts[0]}`;
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

  function migrateList(storageKey) {
    const current = readJsonArray(storageKey);
    if (!current.length) return false;
    const migrated = dedupeCanonicalItems(current);
    const before = JSON.stringify(current);
    const after = JSON.stringify(migrated);
    if (before === after) return false;
    writeJsonArray(storageKey, migrated);
    return true;
  }

  function migrateLocalListsOnce() {
    try {
      const previous = global.localStorage?.getItem(MIGRATION_META_KEY);
      if (String(previous || '').trim()) return false;

      let changed = false;
      MIGRATED_LIST_KEYS.forEach((storageKey) => {
        if (migrateList(storageKey)) changed = true;
      });
      global.localStorage?.setItem(MIGRATION_META_KEY, JSON.stringify({
        migratedAtMs: Date.now(),
        changed
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
