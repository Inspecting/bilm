
// adblock.js — Ultimate Embed Adblocker with Real-Time AI Learning
// Drop this at end of <body> or include with defer

(async () => {
  // ===== LOGGING =====
  const log = (...args) => console.log('[adblock.js]', ...args);

  // ===== LOAD TF.JS =====
  await new Promise(resolve => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.0.0/dist/tf.min.js';
    s.onload = resolve;
    document.head.appendChild(s);
  });
  log('TensorFlow.js loaded');

  // ===== LOAD AI MODEL =====
  let model;
  const modelUrl = '/models/ad_detector/model.json';  // adjust path as needed
  tf.loadLayersModel(modelUrl)
    .then(m => { model = m; log('[AI] Model loaded'); })
    .catch(e => { log('[AI] Model load failed:', e); });

  // ===== CONFIGURATION =====
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

  // ===== FEATURE EXTRACTION =====
  function extractFeatures(el) {
    const style = getComputedStyle(el);
    const text = el.innerText || '';
    return {
      zIndex: parseInt(style.zIndex) || 0,
      area: el.offsetWidth * el.offsetHeight,
      textLength: text.length,
      children: el.children.length
    };
  }

  // ===== AI PREDICTION =====
  async function aiBlock(el) {
    if (!model) return false;
    const f = extractFeatures(el);
    const tensor = tf.tensor2d([[f.zIndex, f.area, f.textLength, f.children]]);
    const pred = model.predict(tensor);
    const prob = (await pred.data())[0];
    tensor.dispose();
    return prob > 0.5;
  }

  // ===== BLOCK DECISIONS =====
  function isBlockedURL(url) {
    if (!url) return false;
    if (useWhitelist) return !whitelist.some(d => url.includes(d));
    return blacklist.some(d => url.includes(d)) || adRegex.test(url);
  }

  const sampleBuffer = [];

  function collectSample(el, label) {
    try {
      const feat = extractFeatures(el);
      feat.label = label ? 1 : 0;
      sampleBuffer.push(feat);
      if (sampleBuffer.length >= 50) flushSamples();
    } catch {}
  }

  function flushSamples() {
    const batch = sampleBuffer.splice(0);
    fetch('/api/samples', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(batch)
    }).catch(() => {});
  }

  // ===== CLEANING FUNCTIONS =====
  async function cleanNode(el) {
    const url = el.src || el.href || '';
    const meta = el.id + ' ' + el.className + ' ' + el.innerText;
    let block = isBlockedURL(url + meta);
    if (!block) block = await aiBlock(el);
    if (block) {
      collectSample(el, true);
      el.remove();
    } else {
      collectSample(el, false);
    }
  }

  function nukeAds() {
    document.querySelectorAll(selectors.join(',')).forEach(el => el.remove());
    document.querySelectorAll('iframe, script, link, img, div, span, video').forEach(cleanNode);
  }

  function cleanEmbeds() {
    document.querySelectorAll('iframe').forEach(iframe => {
      if (iframe.dataset._ad) return;
      iframe.dataset._ad = 1;
      if (isBlockedURL(iframe.src)) return iframe.remove();
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

  function removeShadow() {
    const recurse = root => {
      selectors.forEach(s => root.querySelectorAll(s).forEach(e => e.remove()));
      root.querySelectorAll('*').forEach(e => e.shadowRoot && recurse(e.shadowRoot));
    };
    recurse(document);
  }

  // ===== INTERCEPTORS =====
  (() => {
    const ox = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(m, u) {
      if (isBlockedURL(u)) return;
      return ox.apply(this, arguments);
    };
    const _f = window.fetch;
    window.fetch = (...a) => {
      if (typeof a[0] === 'string' && isBlockedURL(a[0])) return new Promise(()=>{});
      return _f.apply(this, a);
    };
    const wo = window.open;
    window.open = (...a) => {
      if (typeof a[0] === 'string' && isBlockedURL(a[0])) return null;
      return wo.apply(this, a);
    };
    const oe = window.eval;
    window.eval = code => adRegex.test(code) ? '' : oe(code);
    const Of = Function;
    window.Function = (...args) => {
      const c = args[args.length-1];
      return adRegex.test(c) ? () => {} : new Of(...args);
    };
  })();

  // ===== OBSERVE & RUN =====
  const run = () => { nukeAds(); cleanEmbeds(); removeShadow(); };
  new MutationObserver(run).observe(document, {childList:true, subtree:true});
  setInterval(run, 3000);
  run();

  window.addEventListener('beforeunload', () => flushSamples());
  log('🚀 Advanced adblock.js with AI running');
})();
