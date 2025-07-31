
// adblock.js — Everything and the kitchen sink: Ultimate Embed Adblocker
// Drop at end of <body> or include with defer

(async () => {
  const log = (...args) => console.log('[adblock.js]', ...args);

  // ===== Load TensorFlow.js for AI =====
  await new Promise(res => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.0.0/dist/tf.min.js';
    s.onload = res;
    document.head.appendChild(s);
  });
  log('TensorFlow.js loaded');

  // ===== Load AI Model =====
  let model;
  const modelUrl = '/models/ad_detector/model.json';
  tf.loadLayersModel(modelUrl)
    .then(m => { model = m; log('[AI] Model loaded'); })
    .catch(e => log('[AI] Model load failed', e));

  // ===== Load Community Blocklist (EasyList) =====
  let communityList = [];
  fetch('https://easylist.to/easylist/easylist.txt')
    .then(r => r.text())
    .then(txt => {
      communityList = txt.split('\n').filter(l => l && !l.startsWith('!') && !l.startsWith('['));
      log('[Blocklist] Loaded', communityList.length, 'entries');
    })
    .catch(() => log('[Blocklist] Failed to load'));

  // ===== Config =====
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

  // ===== Feature Extraction =====
  function extractFeatures(el) {
    const s = getComputedStyle(el);
    return {
      z: parseInt(s.zIndex)||0,
      area: el.offsetWidth*el.offsetHeight,
      textLen: (el.innerText||'').length,
      childCount: el.children.length
    };
  }

  // ===== AI Prediction =====
  async function aiBlock(el) {
    if (!model) return false;
    const f = extractFeatures(el);
    const t = tf.tensor2d([[f.z,f.area,f.textLen,f.childCount]]);
    const p = (await model.predict(t).data())[0];
    t.dispose();
    return p > 0.5;
  }

  // ===== Block Decision =====
  function isBlockedURL(u) {
    if (!u) return false;
    if (useWhitelist) {
      return !whitelist.some(d => u.includes(d));
    }
    if (blacklist.some(d => u.includes(d))) return true;
    if (communityList.some(rule => u.includes(rule))) return true;
    return adRegex.test(u);
  }

  async function cleanNode(el) {
    const u = el.src||el.href||'';
    const meta = el.id + ' ' + el.className + ' ' + (el.innerText||'');
    let block = isBlockedURL(u+meta);
    if (!block) block = await aiBlock(el);
    if (block) el.remove();
  }

  // ===== DOM / Iframe / Shadow Cleanup =====
  function nukeAds() {
    document.querySelectorAll(selectors.join(',')).forEach(el => el.remove());
    document.querySelectorAll('iframe,script,link,img,div,span,video').forEach(cleanNode);
  }

  function cleanEmbeds() {
    document.querySelectorAll('iframe').forEach(iframe => {
      if (iframe.dataset._ad) return;
      iframe.dataset._ad = 1;
      if (isBlockedURL(iframe.src)) {
        iframe.remove(); return;
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

  function removeShadow() {
    const recurse = root => {
      selectors.forEach(s => root.querySelectorAll(s).forEach(e => e.remove()));
      root.querySelectorAll('*').forEach(e => e.shadowRoot && recurse(e.shadowRoot));
    };
    recurse(document);
  }

  // ===== Network Interceptors =====
  (function(){
    const ox = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(m,u,...a) {
      if (isBlockedURL(u)) return;
      return ox.call(this,m,u,...a);
    };
    const of = window.fetch;
    window.fetch = (...a) => {
      const u = a[0];
      if (typeof u==='string' && isBlockedURL(u)) return new Promise(()=>{});
      return of(...a);
    };
    const ows = window.WebSocket;
    window.WebSocket = function(u,p) {
      if (isBlockedURL(u)) return {};
      return new ows(u,p);
    };
    const sb = navigator.sendBeacon;
    navigator.sendBeacon = (u,d) => isBlockedURL(u)?false:sb.call(navigator,u,d);
  })();

  // ===== Service Worker Proxy =====
  (function(){
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register(URL.createObjectURL(new Blob([`
        self.addEventListener('fetch', e=>{
          const url = e.request.url;
          if (${JSON.stringify(blacklist.concat(communityList))}.some(d=>url.includes(d))) {
            e.respondWith(new Response('',{status:204,statusText:'No Content'}));
          }
        });
      `],{type:'application/javascript'})),{scope:'/'})
      .catch(()=>{});
    }
  })();

  // ===== MediaSource Hijack =====
  if (window.MediaSource) {
    const OrigMS = window.MediaSource;
    window.MediaSource = function(){ return new OrigMS(); };
    OrigMS.prototype.addSourceBuffer = function(type) {
      const sb = OrigMS.prototype.addSourceBuffer.call(this,type);
      const origAppend = sb.appendBuffer;
      sb.appendBuffer = function(buf) {
        // Could inspect buffer for known ad markers here
        origAppend.call(sb,buf);
      };
      return sb;
    };
  }

  // ===== CSS Injection =====
  try{
    const style = document.createElement('style');
    style.textContent = selectors.map(s=>`${s}{display:none!important;}`).join('\n');
    document.head.appendChild(style);
  }catch{}

  // ===== Continued Cleanup =====
  const runAll = ()=>{ nukeAds(); cleanEmbeds(); removeShadow(); };
  new MutationObserver(runAll).observe(document,{childList:true,subtree:true});
  setInterval(runAll,3000);
  runAll();

  log('🚀 All-inclusive embed adblock.js loaded');
})();
