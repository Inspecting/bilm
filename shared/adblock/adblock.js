(async () => {
  // Whitelist your own site so it never gets blocked
  const whitelist = ['inspecting.github.io'];

  // Optional: Only block ads on these external hosts
  const blacklist = ['vidsrc.xyz', 'vidplay.to', 'videocdn.tv'];

  const hostname = location.hostname;

  // Skip if the current domain is whitelisted
  if (whitelist.some(domain => hostname.includes(domain))) {
    console.log('[adblock.js] Skipped (whitelisted):', hostname);
    return;
  }

  // Skip if blacklist is set and the current host is not in it
  if (blacklist.length && !blacklist.some(domain => hostname.includes(domain))) {
    console.log('[adblock.js] Skipped (not in blacklist):', hostname);
    return;
  }

  const res = await fetch('/bilm/shared/adblock/filters/ads.txt');
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
