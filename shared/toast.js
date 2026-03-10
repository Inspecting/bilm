(() => {
  const STYLE_ID = 'bilm-toast-style';
  const HOST_ID = 'bilm-toast-host';
  const TOAST_ID = 'bilm-toast';
  const FADE_MS = 140;
  let hideTimer = null;
  let fadeTimer = null;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${HOST_ID} {
        position: fixed;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        z-index: 9999;
        pointer-events: none;
      }
      #${TOAST_ID} {
        min-width: min(82vw, 240px);
        max-width: min(92vw, 440px);
        padding: 12px 16px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: #f7f8ff;
        background: rgba(20, 24, 40, 0.92);
        box-shadow: 0 16px 30px rgba(0, 0, 0, 0.35);
        font: 600 14px/1.35 Poppins, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        text-align: center;
        opacity: 0;
        transform: translateY(8px) scale(0.98);
        transition: opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease;
      }
      #${TOAST_ID}[data-visible="true"] {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
      #${TOAST_ID}[data-tone="success"] {
        border-color: rgba(52, 211, 153, 0.45);
        background: rgba(7, 38, 31, 0.94);
      }
      #${TOAST_ID}[data-tone="error"] {
        border-color: rgba(248, 113, 113, 0.5);
        background: rgba(60, 19, 26, 0.94);
      }
      #${TOAST_ID}[data-tone="info"] {
        border-color: rgba(96, 165, 250, 0.45);
      }
    `;
    document.head.appendChild(style);
  }

  function ensureElements() {
    ensureStyle();
    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      host.hidden = true;
      document.body.appendChild(host);
    }

    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = TOAST_ID;
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      host.appendChild(toast);
    }
    return { host, toast };
  }

  function dismiss() {
    const host = document.getElementById(HOST_ID);
    const toast = document.getElementById(TOAST_ID);
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (fadeTimer) {
      clearTimeout(fadeTimer);
      fadeTimer = null;
    }
    if (!host || !toast) return;
    toast.setAttribute('data-visible', 'false');
    fadeTimer = setTimeout(() => {
      const currentHost = document.getElementById(HOST_ID);
      const currentToast = document.getElementById(TOAST_ID);
      if (!currentHost || !currentToast) return;
      if (currentToast.getAttribute('data-visible') === 'true') return;
      currentHost.hidden = true;
      currentToast.textContent = '';
    }, FADE_MS + 20);
  }

  function show(message, options = {}) {
    const text = String(message || '').trim();
    if (!text) return;
    const tone = String(options?.tone || 'info').trim().toLowerCase();
    const duration = Number(options?.duration ?? 1000);
    const { host, toast } = ensureElements();
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (fadeTimer) {
      clearTimeout(fadeTimer);
      fadeTimer = null;
    }
    host.hidden = false;
    toast.textContent = text;
    toast.setAttribute('data-tone', ['success', 'error', 'info'].includes(tone) ? tone : 'info');
    toast.setAttribute('data-visible', 'true');
    if (duration > 0) {
      hideTimer = setTimeout(() => {
        dismiss();
      }, duration);
    }
  }

  window.bilmToast = {
    show,
    dismiss
  };
})();
