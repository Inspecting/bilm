// adblock.js — In‑Page Adblocker with adblock‑wasm and filter lists
// Drop this before </body> with defer

(async () => {
  const log = (...args) => console.log('[adblock.js]', ...args);
  const warn = (...args) => console.warn('[adblock.js]', ...args);

  // 1. Load adblock‑wasm library
  await new Promise(res => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/adblock-wasm@0.2.5/dist/AdblockWasm.js';
    s.onload = res;
    document.head.appendChild(s);
  });
  log('✔ adblock-wasm loaded');

  // 2. Fetch filter lists (EasyList and Ghostery)
  const listUrls = [
    '/filters/easylist.txt',
    '/filters/ghostery-tracker-list.txt',
    '/filters/ghostery-ad-list.txt'
  ];
  const lists = await Promise.all(
    listUrls.map(url => fetch(url).then(r => r.text()))
  );
  log('✔ Filter lists fetched');

  // 3. Initialize WASM engine
  const engine = await AdblockWasm.EngineFactory.fromText(lists.join('\n'));
  log('✔ Adblock engine initialized');

  // 4. Utility to check URL
  function isBlocked(url) {
    try {
      return engine.check(url, {
        elementType: AdblockWasm.ElementType.OTHER,
        domain: location.hostname
      });
    } catch {
      return false;
    }
  }

  // 5. Hook fetch
  const origFetch = window.fetch;
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (isBlocked(url)) {
      warn('Blocked fetch:', url);
      return new Promise(() => {});
    }
    return origFetch(input, init);
  };

  // 6. Hook XHR
  const origXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    if (isBlocked(url)) {
      warn('Blocked XHR:', url);
      return;
    }
    return origXhrOpen.call(this, method, url, ...args);
  };

  // 7. Observe and clean DOM
  const observer = new MutationObserver(records => {
    records.forEach(record => {
      record.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        const el = node;
        const src = el.src || el.href || '';
        if (src && isBlocked(src)) {
          warn('Removed element:', el, 'URL:', src);
          el.remove();
          return;
        }
        // check nested
        el.querySelectorAll('iframe,script,link,img,video').forEach(nested => {
          const u = nested.src || nested.href || '';
          if (u && isBlocked(u)) {
            warn('Removed nested:', nested, 'URL:', u);
            nested.remove();
          }
        });
      });
    });
  });
  observer.observe(document, { childList: true, subtree: true });

  log('✅ In-page adblocker initialized');
})();
