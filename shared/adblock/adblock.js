(async () => {
  // Allow script to run ONLY on embed hosts
  const allowedDomains = ['vidsrc.xyz', 'videocdn.tv'];

  const hostname = location.hostname;

  // Exit unless we're on a matching embed domain
  if (!allowedDomains.some(domain => hostname.includes(domain))) {
    console.log('[adblock.js] Not running on this domain:', hostname);
    return;
  }

  console.log('[adblock.js] Running on:', hostname);

  const res = await fetch('/shared/adblock/filters/ads.txt');
  const txt = await res.text();
  const filters = txt
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('!') && !line.startsWith('@@'));

  const patterns = filters.map(line => {
    try {
      const regex = line
        .replace(/[\.\?\+\[\]\(\)\{\}\\]/g, '\\$&') // escape regex chars
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

  matchAndRemove();

  new MutationObserver(() => matchAndRemove())
    .observe(document.documentElement, { childList: true, subtree: true });
})();
