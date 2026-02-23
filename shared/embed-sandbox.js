(function () {
  function applyEmbedAttributes(iframe) {
    if (!iframe) return;
    iframe.removeAttribute('sandbox');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.setAttribute('allow', 'fullscreen; encrypted-media; autoplay');
    iframe.setAttribute('allowfullscreen', '');
  }

  function normalizeEmbedUrl(url) {
    if (!url) return '';
    try {
      const parsed = new URL(url, window.location.href);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
      return parsed.toString();
    } catch {
      return '';
    }
  }

  function setSandboxedIframeSrc(iframe, url) {
    if (!iframe) return;
    applyEmbedAttributes(iframe);
    iframe.src = normalizeEmbedUrl(url) || 'about:blank';
  }

  window.BilmEmbedSandbox = {
    applySandboxAttributes: applyEmbedAttributes,
    applyEmbedAttributes,
    setSandboxedIframeSrc
  };
})();
