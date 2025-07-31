(async () => {
  const res = await fetch('/bilm/shared/adblock/filters/ads.txt');
  const txt = await res.text();
  const filters = txt
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('!') && !line.startsWith('@@'));

  // Convert filter rules into simple regex patterns
  const patterns = filters.map(line => {
    try {
      // Replace * with .*, ^ with \b to mimic adblock syntax a bit
      const regex = line
        .replace(/[\.\?\+\[\]\(\)\{\}\\]/g, '\\$&') // escape regex special chars
        .replace(/\*/g, '.*')
        .replace(/\^/g, '\\b');
      return new RegExp(regex, 'i');
    } catch {
      return null;
    }
  }).filter(Boolean);

  function matchAndRemove() {
    const elements = document.querySelectorAll('iframe, script, img, link, div');
    elements.forEach(el => {
      const src = el.src || el.href || '';
      if (patterns.some(rx => rx.test(src))) {
        console.warn('[adblock.js] Removed element:', el);
        el.remove();
      }
    });
  }

  // Run on load
  matchAndRemove();

  // Observe DOM for future elements
  const observer = new MutationObserver(() => matchAndRemove());
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
