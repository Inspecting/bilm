
// adblock.js — Modular, Robust Embed Adblocker
// Drop at end of <body> or include with defer

(async () => {
  // ======= CONFIGURATION =======
  const CONFIG = {
    embedHosts: ['vidsrc.xyz', 'vidplay.to', 'upstream.to', 'cdn.vidplayer.net'],
    apiHosts: ['api.themoviedb.org', 'inspecting.github.io/bilm/'],
    apiPrefixes: ['/api/'],
    blacklist: [
      'doubleclick.net','googlesyndication.com','popads.net','exosrv.com',
      'adnxs.com','taboola.com','outbrain.com','trafficjunky.net',
      'juicyads.com','clkmon.com','exoclick.com'
    ],
    adKeywords: /(ad|ads|sponsor|promo|banner|doubleclick|popunder|outbrain|taboola|bongacams|trafficjunky|juicyads|clkmon|exoclick)/i,
    selectors: [
      'iframe[src*="ads"]','iframe[id*="ad"]','iframe[class*="ad"]',
      '[src*="ads"]','[href*="ads"]','[class*="ad"]','[id*="ad"]',
      '[data-ad]','.sponsor','.promo','.overlay','.ad-container','.ad-player',
      'script[src*="ads"]','link[href*="ads"]'
    ]
  };

  const log = (...args) => console.log('[adblock]', ...args);
  const warn = (...args) => console.warn('[adblock]', ...args);

  // ======= URL BLOCKING LOGIC =======
  function isWhitelisted(url) {
    if (!url) return true;
    const u = url.toLowerCase();
    // self script
    if (u.includes('adblock.js')) return true;
    // embed hosts
    if (CONFIG.embedHosts.some(host => u.includes(host))) return true;
    // API hosts
    try {
      const host = new URL(url).hostname;
      if (CONFIG.apiHosts.includes(host)) return true;
    } catch {}
    // API prefixes
    if (CONFIG.apiPrefixes.some(pref => u.startsWith(pref) || u.includes(pref))) return true;
    return false;
  }

  function isAdUrl(url) {
    const u = url.toLowerCase();
    if (CONFIG.blacklist.some(domain => u.includes(domain))) return true;
    return CONFIG.adKeywords.test(u);
  }

  function shouldBlockUrl(url) {
    if (!url) return false;
    if (isWhitelisted(url)) return false;
    return isAdUrl(url);
  }

  // ======= DOM CLEANUP =======
  function cleanElement(el) {
    const url = el.src || el.href || '';
    if (shouldBlockUrl(url)) {
      warn('Removing element:', el, 'URL:', url);
      el.remove();
    }
  }

  function nukeSelectors() {
    document.querySelectorAll(CONFIG.selectors.join(',')).forEach(el => {
      warn('Selector nuke:', el);
      el.remove();
    });
  }

  function cleanDOM() {
    nukeSelectors();
    document.querySelectorAll('iframe,script,link,img,div,span').forEach(cleanElement);
  }

  // ======= SHADOW DOM =======
  function cleanShadow(root) {
    CONFIG.selectors.forEach(sel => root.querySelectorAll(sel).forEach(e => e.remove()));
    root.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) cleanShadow(el.shadowRoot);
    });
  }

  function cleanAll() {
    cleanDOM();
    cleanShadow(document);
  }

  // ======= NETWORK INTERCEPTORS =======
  function interceptXHR() {
    const orig = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(m, url, ...args) {
      if (shouldBlockUrl(url)) {
        warn('Blocked XHR:', url);
        return;
      }
      return orig.call(this, m, url, ...args);
    };
  }

  function interceptFetch() {
    const orig = window.fetch;
    window.fetch = (...args) => {
      const url = args[0];
      if (typeof url === 'string' && shouldBlockUrl(url)) {
        warn('Blocked fetch:', url);
        return new Promise(() => {});
      }
      return orig.apply(this, args);
    };
  }

  function interceptWindowOpen() {
    const orig = window.open;
    window.open = (url, ...args) => {
      if (typeof url === 'string' && shouldBlockUrl(url)) {
        warn('Blocked popup:', url);
        return null;
      }
      return orig.call(window, url, ...args);
    };
  }

  // ======= INIT =======
  interceptXHR();
  interceptFetch();
  interceptWindowOpen();

  // Continuous cleanup
  const observer = new MutationObserver(cleanAll);
  observer.observe(document, { childList: true, subtree: true });
  setInterval(cleanAll, 2000);
  cleanAll();

  log('Adblock.js initialized.');
})();
