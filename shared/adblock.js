
// adblock.js — Embed Adblocker with Self-Whitelist for Its Own Script
// Drop this at end of <body> or include with defer

(async () => {
  const log = (...args) => console.log('[adblock.js]', ...args);
  const warn = (...args) => console.warn('[adblock.js]', ...args);

  // ===== WHITELISTS =====
  const embedHosts = [
    'vidsrc.xyz',
    'vidplay.to',
    'upstream.to',
    'cdn.vidplayer.net',
    'inspecting.github.io'  // Whitelist script hosting domain
  ];
  const apiHosts = [
    'api.themoviedb.org',
    'yourdomain.com'
  ];
  const apiPrefixes = [
    '/api/',
    'https://yourdomain.com/api/'
  ];
  const blacklist = [
    'doubleclick.net','googlesyndication.com','popads.net','exosrv.com',
    'adnxs.com','taboola.com','outbrain.com','trafficjunky.net',
    'juicyads.com','clkmon.com','exoclick.com'
  ];
  const adRegex = /(ad|ads|sponsor|promo|banner|doubleclick|popunder|outbrain|taboola|bongacams|trafficjunky|juicyads|clkmon|exoclick)/i;
  const selectors = [
    'iframe[src*="ads"]','iframe[id*="ad"]','iframe[class*="ad"]',
    '[src*="ads"]','[href*="ads"]','[class*="ad"]','[id*="ad"]',
    '[data-ad]','.sponsor','.promo','.overlay','.ad-container','.ad-player',
    'script[src*="ads"]','link[href*="ads"]'
  ];

  // ===== BLOCK DECISION =====
  function isBlockedURL(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    // Allow the adblock script itself
    if (lower.includes('adblock.js')) return false;
    // whitelist embed hosts
    if (embedHosts.some(h => lower.includes(h))) return false;
    // whitelist external API hosts
    try {
      const host = new URL(url).hostname;
      if (apiHosts.includes(host)) return false;
    } catch {}
    // whitelist API prefixes
    if (apiPrefixes.some(pref => url.startsWith(pref) || url.includes(pref))) return false;
    // block known ad domains
    if (blacklist.some(d => lower.includes(d))) return true;
    // regex catch
    return adRegex.test(lower);
  }

  // ===== FEATURE EXTRACTION & AI (omitted for brevity) =====
  // assume AI integration code here if needed

  // ===== CLEAN NODE =====
  async function cleanNode(el) {
    try {
      const url = el.src || el.href || '';
      if (!url || !isBlockedURL(url)) return;
      warn('Removed element:', el, 'URL:', url);
      el.remove();
    } catch (e) {
      console.error(e);
    }
  }

  // ===== CLEANUP =====
  function nukeAds() {
    document.querySelectorAll(selectors.join(',')).forEach(el => {
      warn('Nuke selector match:', el);
      el.remove();
    });
    document.querySelectorAll('iframe,script,link,img,div,span').forEach(cleanNode);
  }

  function cleanEmbeds() {
    document.querySelectorAll('iframe').forEach(iframe => {
      if (iframe.dataset._ad) return;
      iframe.dataset._ad = '1';
      const url = iframe.src || '';
      if (isBlockedURL(url)) {
        warn('Removed iframe:', iframe, 'URL:', url);
        iframe.remove(); return;
      }
      try {
        const doc = iframe.contentDocument;
        if (doc) selectors.forEach(s => doc.querySelectorAll(s).forEach(e => e.remove()));
      } catch {}
    });
  }

  function removeShadowAds() {
    const recurse = root => {
      selectors.forEach(s => root.querySelectorAll(s).forEach(e => e.remove()));
      root.querySelectorAll('*').forEach(el => el.shadowRoot && recurse(el.shadowRoot));
    };
    recurse(document);
  }

  // ===== INTERCEPTORS =====
  (function(){
    const origX = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
      if (isBlockedURL(url)) {
        warn('Blocked XHR:', url);
        return;
      }
      return origX.apply(this, [method, url, ...args]);
    };
    const origFetch = window.fetch;
    window.fetch = (...args) => {
      const url = args[0];
      if (typeof url === 'string' && isBlockedURL(url)) {
        warn('Blocked fetch:', url);
        return new Promise(() => {});
      }
      return origFetch.apply(this, args);
    };
    const origOpen = window.open;
    window.open = (url, ...args) => {
      if (typeof url === 'string' && isBlockedURL(url)) {
        warn('Blocked popup:', url);
        return null;
      }
      return origOpen.apply(this, [url, ...args]);
    };
  })();

  // ===== RUN & OBSERVE =====
  const runAll = () => { nukeAds(); cleanEmbeds(); removeShadowAds(); };
  new MutationObserver(runAll).observe(document, { childList: true, subtree: true });
  setInterval(runAll, 3000);
  runAll();

  log('✅ adblock.js loaded with self-whitelist');
})();
