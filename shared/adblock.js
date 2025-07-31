
// adblock.js — Enhanced Modular Embed Adblocker
// Drop at end of <body> or include with defer

(async () => {
  const log = (...args) => console.log('[adblock.js]', ...args);
  const warn = (...args) => console.warn('[adblock.js]', ...args);

  // ===== CONFIG =====
  const CONFIG = {
    embedHosts: ['vidsrc.xyz','vidplay.to','upstream.to','cdn.vidplayer.net'],
    apiHosts: ['api.themoviedb.org','yourdomain.com'],
    apiPrefixes: ['/api/'],
    blacklist: [
      'doubleclick.net','googlesyndication.com','popads.net','exosrv.com',
      'adnxs.com','taboola.com','outbrain.com','trafficjunky.net',
      'juicyads.com','clkmon.com','exoclick.com'
    ],
    adKeywords: /(ad|ads|sponsor|promo|banner|doubleclick|popunder|outbrain|taboola|bongacams|trafficjunky|juicyads|clkmon|exoclick)/i,
    // Extended selectors
    selectors: [
      '[id*="ad"]','[class*="ad"]','[class*="ads"]','[class*="banner"]',
      '.ad-overlay','.ad-popup','.ad-banner','.adsbygoogle','.adsense',
      '.ad-container','.advertisement','.sponsor','.promo','.skip-ad',
      '.countdown','.overlay-block','.video-ads'
    ]
  };

  // ===== URL DECISION =====
  function isWhitelisted(url) {
    if (!url) return true;
    const u = url.toLowerCase();
    if (u.includes('adblock.js')) return true;
    if (CONFIG.embedHosts.some(h=>u.includes(h))) return true;
    try {
      const h = new URL(url).hostname;
      if (CONFIG.apiHosts.includes(h)) return true;
    } catch {}
    if (CONFIG.apiPrefixes.some(p=>url.startsWith(p))) return true;
    return false;
  }
  function isAdUrl(url) {
    const u = url.toLowerCase();
    if (CONFIG.blacklist.some(d=>u.includes(d))) return true;
    return CONFIG.adKeywords.test(u);
  }
  function shouldBlockUrl(url) {
    if (!url) return false;
    if (isWhitelisted(url)) return false;
    return isAdUrl(url);
  }

  // ===== CORE HIDE FUNCTION =====
  function hideAds(root=document) {
    CONFIG.selectors.forEach(sel=>
      root.querySelectorAll(sel).forEach(el=>{
        warn('Hiding ad element via selector:', sel, el);
        el.remove?.() || el.style && Object.assign(el.style, {
          display:'none', visibility:'hidden', opacity:'0', pointerEvents:'none'
        });
      })
    );
  }

  // ===== CLEAN INDIVIDUAL ELEMENT =====
  function cleanEl(el) {
    const url = el.src||el.href||'';
    if (shouldBlockUrl(url)) {
      warn('Removing element:', el, 'URL:', url);
      el.remove();
    }
  }

  // ===== FULL CLEAN =====
  function cleanAll() {
    hideAds();
    document.querySelectorAll('iframe,script,link,img,div,span').forEach(cleanEl);
  }

  // ===== NETWORK INTERCEPT =====
  (()=>{
    const ox=XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open=function(m,u,...a){
      if (shouldBlockUrl(u)) { warn('Blocked XHR:',u);return; }
      return ox.call(this,m,u,...a);
    };
    const of=window.fetch;
    window.fetch=function(...a){
      const u=a[0];
      if(typeof u==='string' && shouldBlockUrl(u)) { warn('Blocked fetch:',u); return new Promise(()=>{}); }
      return of.apply(this,a);
    };
    const oo=window.open;
    window.open=function(u,...a){
      if(typeof u==='string' && shouldBlockUrl(u)) { warn('Blocked popup:',u); return null; }
      return oo.call(this,u,...a);
    };
  })();

  // ===== OBSERVER & INTERVAL =====
  const obs=new MutationObserver(m=>{
    m.forEach(r=>r.addedNodes.forEach(n=>{
      if(n.nodeType===1){ hideAds(n); cleanEl(n); }
    }));
  });
  obs.observe(document.body,{childList:true,subtree:true});
  setInterval(cleanAll,2000);
  cleanAll();

  log('✅ Enhanced adblock.js initialized');
})();
