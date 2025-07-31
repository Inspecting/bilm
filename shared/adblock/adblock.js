(async () => {
  console.log("[adblock.js] Ad blocker loaded");

  const FILTER_PATH = "/bilm/shared/adblock/filters/ads.txt";

  function blockElement(el) {
    if (el && el.remove) {
      console.log("[adblock.js] Removed element:", el);
      el.remove();
    }
  }

  function blockAdsByFilter(filterLines) {
    const filters = filterLines.filter(line => line && !line.startsWith("!") && !line.startsWith("["));
    const observer = new MutationObserver(() => {
      document.querySelectorAll("iframe, script, img, div").forEach(el => {
        const src = el.src || el.dataset.src || el.href || el.innerHTML;
        if (src) {
          for (const f of filters) {
            if (src.includes(f.replace(/^(\|\|)?/, "").replace(/\^$/, ""))) {
              blockElement(el);
              break;
            }
          }
        }
      });
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  try {
    const res = await fetch(FILTER_PATH);
    const txt = await res.text();
    const lines = txt.split("\n");
    blockAdsByFilter(lines);
  } catch (e) {
    console.error("[adblock.js] Failed to load filter list:", e);
  }
})();