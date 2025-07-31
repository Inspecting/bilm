
// adblock.js — Ultimate Embed Adblocker with Host Whitelist
// Drop this at end of <body> or include with defer

(async () => {
  const log = (...args) => console.log('[adblock.js]', ...args);

  // ===== HOST WHITELISTS =====
  const embedHosts = [
    'vidsrc.xyz',
    'vidplay.to',
    // add any other domains serving your episodes here
  ];
  const whitelist = ['example.com','mytrustedcdn.net'];
  const blacklist = [
    'doubleclick.net','googlesyndication.com','vidplay.net','vidsrc.to',
    'popads.net','exosrv.com','adnxs.com','taboola.com','outbrain.com',
    'bongacams.com','trafficjunky.net','juicyads.com','clkmon.com','exoclick.com'
  ];
  const useWhitelist = false;
  const adRegex = /(ad|ads|sponsor|promo|banner|doubleclick|popunder|outbrain|taboola|bongacams|trafficjunky|juicyads|clkmon|exoclick)/i;
  const selectors = [
    'iframe[src*="ads"]','iframe[id*="ad"]','iframe[class*="ad"]',
    '[src*="ads"]','[href*="ads"]','[class*="ad"]','[id*="ad"]',
    '[data-ad]','.sponsor','.promo','.overlay','.ad-container','.ad-player',
    'script[src*="ads"]','link[href*="ads"]','video[poster*="ad"]'
  ];

  // ===== LOAD TF.JS & MODEL (AI) =====
  await new Promise(res => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.0.0/dist/tf.min.js';
    s.onload = res;
    document.head.appendChild(s);
  });
  log('TensorFlow.js loaded');

  let model;
  tf.loadLayersModel('/models/ad_detector/model.json')
    .then(m => { model = m; log('[AI] Model loaded'); })
    .catch(e => log('[AI] Model load failed', e));

  // ===== FEATURE EXTRACTION =====
  function extractFeatures(el) {
    const s = getComputedStyle(el);
    return {
      z: parseInt(s.zIndex)||0,
      area: el.offsetWidth * el.offsetHeight,
      textLen: (el.innerText||'').length,
      childCount: el.children.length
    };
  }

  // ===== AI PREDICTION =====
  async function aiBlock(el) {
    if (!model) return false;
    const f = extractFeatures(el);
    const t = tf.tensor2d([[f.z,f.area,f.textLen,f.childCount]]);
    const p = (await model.predict(t).data())[0];
    t.dispose();
    return p > 0.5;
  }

  // ===== BLOCK DECISION =====
  function isBlockedURL(url) {
    if (!url) return false;
    // Always allow embed hosts
    if (embedHosts.some(d => url.includes(d))) return false;
    if (useWhitelist) return !whitelist.some(d => url.includes(d));
    if (blacklist.some(d => url.includes(d))) return true;
    return adRegex.test(url);
  }

  // ===== CLEAN NODE =====
  async function cleanNode(el) {
    const url = el.src || el.href || '';
    const meta = el.id + ' ' + el.className + ' ' + (el.innerText||'');
    let block = isBlockedURL(url + meta);
    if (!block) block = await aiBlock(el);
    if (block) el.remove();
  }

  // ===== DOM / IFRAME / SHADOW DOM CLEANUP =====
  function nukeAds() {
    document.querySelectorAll(selectors.join(',')).forEach(el => el.remove());
    document.querySelectorAll('iframe,script,link,img,div,span,video').forEach(cleanNode);
  }

  function cleanEmbeds() {
    document.querySelectorAll('iframe').forEach(iframe => {
      if (iframe.dataset._ad) return;
      iframe.dataset._ad = '1';
      if (isBlockedURL(iframe.src)) {
        iframe.remove();
        return;
      }
      try {
        const doc = iframe.contentDocument;
        if (doc) selectors.forEach(s => doc.querySelectorAll(s).forEach(e => e.remove()));
      } catch {
        iframe.addEventListener('load', () => {
          try {
            const doc = iframe.contentDocument;
            if (doc) selectors.forEach(s => doc.querySelectorAll(s).forEach(e => e.remove()));
          } catch {}
        });
      }
    });
  }

  function removeShadowAds() {
    const traverse = root => {
      selectors.forEach(sel => root.querySelectorAll(sel).forEach(e => e.remove()));
      root.querySelectorAll('*').forEach(el => el.shadowRoot && traverse(el.shadowRoot));
    };
    traverse(document);
  }

  // ===== NETWORK & SCRIPT INTERCEPTORS =====
  (function(){
    const ox = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
      if (isBlockedURL(url)) return;
      return ox.apply(this, [method, url, ...args]);
    };
    const ofetch = window.fetch;
    window.fetch = (...args) => {
      const url = args[0];
      if (typeof url === 'string' && isBlockedURL(url)) return new Promise(() => {});
      return ofetch.apply(this, args);
    };
    const oopen = window.open;
    window.open = (url, ...args) => {
      if (typeof url === 'string' && isBlockedURL(url)) return null;
      return oopen.apply(this, [url, ...args]);
    };
  })();

  // ===== OBSERVERS & RUN =====
  const runAll = () => { nukeAds(); cleanEmbeds(); removeShadowAds(); };
  new MutationObserver(runAll).observe(document, { childList: true, subtree: true });
  setInterval(runAll, 3000);
  runAll();

  log('✅ adblock.js loaded with embed host whitelist');
})();
