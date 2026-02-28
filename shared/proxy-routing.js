(function () {
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

  function getProxyPrefixes(provider) {
    if (provider === 'ultraviolet') {
      return ['/uv/service/'];
    }
    if (provider === 'scramjet') {
      return ['/service/scramjet/', '/scramjet/'];
    }
    return [];
  }

  function normalizeProxyProvider(provider) {
    return provider === 'ultraviolet' || provider === 'scramjet' ? provider : 'none';
  }

  function buildProxiedUrl(url, { proxyEnabled = false, proxyProvider = 'none' } = {}) {
    if (!url || proxyEnabled !== true) return url;
    const provider = normalizeProxyProvider(proxyProvider);
    if (provider === 'none') return url;

    const [primaryPrefix] = getProxyPrefixes(provider);
    return `${window.location.origin}${withBase(`${primaryPrefix}${encodeURIComponent(url)}`)}`;
  }

  function isProxyPath(pathname) {
    const base = detectBasePath();
    const prefixes = [...getProxyPrefixes('ultraviolet'), ...getProxyPrefixes('scramjet')];
    return prefixes.some((prefix) => pathname.startsWith(`${base}${prefix}`) || pathname.startsWith(prefix));
  }

  function buildReloadableUrl(url) {
    if (!url) return url;
    try {
      const parsed = new URL(url, window.location.href);
      if (isProxyPath(parsed.pathname)) {
        // Proxied URLs encode destination in the path. Appending query params can break provider decoding.
        return parsed.toString();
      }
      parsed.searchParams.set('bilm_refresh', Date.now().toString());
      return parsed.toString();
    } catch {
      return `${url}${url.includes('?') ? '&' : '?'}bilm_refresh=${Date.now()}`;
    }
  }

  window.BilmProxyRouting = {
    detectBasePath,
    withBase,
    buildProxiedUrl,
    buildReloadableUrl
  };
})();
