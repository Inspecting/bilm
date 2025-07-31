import { FiltersEngine, Request } from 'https://cdn.jsdelivr.net/npm/@ghostery/adblocker@2.11.3/dist/esm/index.min.js';

async function initAdblock() {
  const adList = await fetch('/shared/adblock/filters/ads.txt').then(res => res.text());

  const engine = FiltersEngine.fromLists([adList]);

  function shouldBlock(url) {
    const req = Request.fromRawDetails({ url, type: 'other' });
    return engine.match(req).matched;
  }

  const origFetch = window.fetch;
  window.fetch = (...args) => {
    if (shouldBlock(args[0])) {
      console.warn('[adblock] Blocked fetch:', args[0]);
      return new Promise(() => {});
    }
    return origFetch(...args);
  };

  new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === 1 && node.src && shouldBlock(node.src)) {
          console.warn('[adblock] Removed element:', node.src);
          node.remove();
        }
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  console.log('[adblock] Adblocker with ads.txt loaded');
}

initAdblock();
