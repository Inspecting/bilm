
// Simple Adblocker Script (Self-contained)

(function() {
  const blockedPatterns = [
    /doubleclick\.net/,
    /googlesyndication\.com/,
    /adservice\.google\.com/,
    /adsystem\.com/,
    /ads\./,
    /\/ads\//,
    /track(er)?\./,
    /\/tracker\//,
    /popads\./,
    /vidplay\.io\/ads/,
    /vidsrc\.to\/ads/,
    /\/banner/,
    /\?ad_tag=/,
    /\&ads=/,
  ];

  function shouldBlock(url) {
    return blockedPatterns.some(pattern => pattern.test(url));
  }

  // Block fetch
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    if (shouldBlock(args[0])) {
      console.warn("[adblock.js] Blocked fetch:", args[0]);
      return Promise.reject("Blocked by adblocker");
    }
    return originalFetch.apply(this, args);
  };

  // Block XHR
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    if (shouldBlock(url)) {
      console.warn("[adblock.js] Blocked XHR:", url);
      return;
    }
    return originalOpen.apply(this, arguments);
  };

  // Block iframes and scripts
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.tagName === "IFRAME" || node.tagName === "SCRIPT") {
          const src = node.src || "";
          if (shouldBlock(src)) {
            console.warn("[adblock.js] Removed element:", node.tagName, "URL:", src);
            node.remove();
          }
        }
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  console.log("[adblock.js] Simple adblocker initialized");
})();
