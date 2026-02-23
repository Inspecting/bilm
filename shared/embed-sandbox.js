(function () {
  const SANDBOX_TOKENS = [
    'allow-scripts',
    'allow-same-origin',
    'allow-presentation',
    'allow-forms',
    'allow-pointer-lock'
  ];

  function applySandboxAttributes(iframe) {
    if (!iframe) return;
    iframe.setAttribute('sandbox', SANDBOX_TOKENS.join(' '));
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
    applySandboxAttributes(iframe);
    iframe.src = normalizeEmbedUrl(url) || 'about:blank';
  }

  window.BilmEmbedSandbox = {
    applySandboxAttributes,
    setSandboxedIframeSrc
  };
})();
