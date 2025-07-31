
// adblock.js — In-Page Ghostery-Powered Ad & Tracker Blocker
// Drop this before </body> with defer

(async () => {
  const log = (...args) => console.log('[adblock.js]', ...args);
  const warn = (...args) => console.warn('[adblock.js]', ...args);

  // 1. Load adblock-wasm
  await new Promise(res => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/adblock-wasm@0.2.5/dist/AdblockWasm.js';
    s.onload = res;
    document.head.appendChild(s);
  });
  log('adblock-wasm loaded');

  // 2. Fetch Ghostery blocklists
  const listUrls = [
    'https://raw.githubusercontent.com/ghostery/ghostery-blocklists/main/ghostery-tracker-list.txt',
    'https://raw.githubusercontent.com/ghostery/ghostery-blocklists/main/ghostery-ad-list.txt'
  ];
  const lists = await Promise.all(listUrls.map(url => fetch(url).then(r => r.text())));
  log('Ghostery lists fetched');

  // 3. Initialize WASM engine
  const engine = await AdblockWasm.EngineFactory.fromText(lists.join('\n'));
  log('Adblock engine initialized');

  // 4. Hook network methods
  const origFetch = window.fetch;
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (engine.check(url, { 
      elementType: AdblockWasm.ElementType.OTHER, 
      domain: location.hostname 
    })) {
      warn('Blocked fetch:', url);
      return new Promise(() => {});
    }
    return origFetch(input, init);
  };

  const origXhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    if (engine.check(url, { 
      elementType: AdblockWasm.ElementType.OTHER, 
      domain: location.hostname 
    })) {
      warn('Blocked XHR:', url);
      return;
    }
    return origXhrOpen.call(this, method, url, ...args);
  };

  // 5. Observe DOM for ad/tracker elements
  const observer = new MutationObserver(muts => {
    muts.forEach(m => {
      m.addedNodes.forEach(node => {
        if (node.nodeType === 1) {
          const src = node.src || node.href || '';
          if (src && engine.check(src, {
            elementType: AdblockWasm.ElementType.SCRIPT,
            domain: location.hostname
          })) {
            warn('Removed element:', node, 'URL:', src);
            node.remove();
          }
          // also remove any nested
          node.querySelectorAll('iframe,script,link,img,video').forEach(el => {
            const url = el.src || el.href || '';
            if (url && engine.check(url, { 
              elementType: AdblockWasm.ElementType.OTHER, 
              domain: location.hostname 
            })) {
              warn('Removed nested:', el, 'URL:', url);
              el.remove();
            }
          });
        }
      });
    });
  });
  observer.observe(document, { childList: true, subtree: true });

  log('✅ Ghostery-powered adblock initialized');
})();
