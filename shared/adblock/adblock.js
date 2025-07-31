(async () => {
  const listUrls = [
    '/shared/adblock/filters/ghostery-ad-list.txt',
    '/shared/adblock/filters/ghostery-tracker-list.txt'
  ];

  const { default: engineFactory } = await import('https://cdn.jsdelivr.net/npm/@eyeo/adblocker-wasm@latest/dist/es/engine/index.min.mjs');

  const responses = await Promise.all(listUrls.map(url => fetch(url).then(r => r.text())));
  const engine = await engineFactory.fromLists(...responses);

  const shouldBlock = url => engine.match(url, { domain: location.hostname })?.matched;

  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    if (shouldBlock(args[0])) {
      console.warn('[adblock.js] Blocked fetch:', args[0]);
      return new Promise(() => {}); // block request
    }
    return originalFetch.apply(this, args);
  };

  const observer = new MutationObserver(mutations => {
    for (let m of mutations) {
      m.addedNodes.forEach(node => {
        if (node.nodeType === 1 && node.src && shouldBlock(node.src)) {
          console.warn('[adblock.js] Blocked element:', node.src);
          node.remove();
        }
      });
    }
  });
  observer.observe(document, { childList: true, subtree: true });

  console.log('[adblock.js] Ghostery-style adblock enabled');
})();
