<script type="module">
  import { FiltersEngine, Request } from 'https://cdn.jsdelivr.net/npm/@ghostery/adblocker@2.11.3/dist/esm/index.min.js';

  async function initAdblock(){
    // Use built-in Ghostery lists for both ad & tracker blocking
    const engine = await FiltersEngine.fromPrebuiltAdsAndTracking(fetch);

    function shouldBlock(url) {
      const req = Request.fromRawDetails({ url, type: 'other' });
      return engine.match(req).matched;
    }

    // Hook fetch
    const origFetch = window.fetch;
    window.fetch = (...args) => {
      if (shouldBlock(args[0])) {
        console.warn('[adblock] Blocked fetch:', args[0]);
        return new Promise(() => {});
      }
      return origFetch(...args);
    };

    // Monitor DOM injections
    new MutationObserver(muts => {
      muts.forEach(m => {
        m.addedNodes.forEach(node => {
          if (node.nodeType === 1 && node.src && shouldBlock(node.src)) {
            console.warn('[adblock] Removed element:', node.src);
            node.remove();
          }
        });
      });
    }).observe(document.documentElement, { childList: true, subtree: true });

    console.log('[adblock] Ghostery adblock library running');
  }

  initAdblock();
</script>
