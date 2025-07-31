(async () => {
  const response = await fetch('/shared/adblock/filters/ads.txt');
  const text = await response.text();
  const patterns = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('!') && !line.startsWith('#'));

  function matchesAd(url) {
    return patterns.some(pat => url.includes(pat));
  }

  // Intercept fetch
  const originalFetch = window.fetch;
  window.fetch = (...args) => {
    if (matchesAd(args[0])) {
      console.warn('[adblock.js] Blocked fetch:', args[0]);
      return new Promise(() => {}); // Never resolves
    }
    return originalFetch(...args);
  };

  // Intercept dynamic scripts/iframes/etc.
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1) {
          const src = node.src || node.data || '';
          if (src && matchesAd(src)) {
            console.warn('[adblock.js] Removed element:', node.tagName, src);
            node.remove();
          }
        }
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  console.log('[adblock.js] Simple adblocker with ads.txt loaded');
})();
