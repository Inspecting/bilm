(function () {
  const DEFAULT_TIMEOUT_SCHEDULE_MS = [12000, 15000];
  const DEFAULT_TIMEOUT_GRACE_MS = 1400;
  const DEFAULT_LATE_LOAD_WINDOW_MS = 2000;
  const RESET_DELAY_MS = 80;

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function buildReloadableUrl(url, refreshKey) {
    const key = String(refreshKey || 'bilm_refresh').trim() || 'bilm_refresh';
    return `${url}${url.includes('?') ? '&' : '?'}${encodeURIComponent(key)}=${Date.now()}`;
  }

  function readFrameLocationHref(iframe) {
    try {
      return String(iframe?.contentWindow?.location?.href || '').trim();
    } catch {
      // Cross-origin navigations can throw; treat as non-blank and continue.
      return '';
    }
  }

  function isBlankFrameLocation(locationHref) {
    const normalizedHref = String(locationHref || '').trim().toLowerCase();
    return !normalizedHref || normalizedHref === 'about:blank' || normalizedHref === 'about:srcdoc';
  }

  async function loadWithRetry({
    iframe,
    url,
    timeoutScheduleMs = DEFAULT_TIMEOUT_SCHEDULE_MS,
    timeoutGraceMs = DEFAULT_TIMEOUT_GRACE_MS,
    lateLoadWindowMs = DEFAULT_LATE_LOAD_WINDOW_MS,
    refreshKey = 'bilm_refresh',
    resetDelayMs = RESET_DELAY_MS,
    isCancelled = null,
    onAttempt = null,
    onSuccess = null,
    onFailure = null,
    onLateSuccess = null
  } = {}) {
    if (!iframe || !url) {
      return { ok: false, reason: 'invalid_input', attempt: 0 };
    }

    const schedule = Array.isArray(timeoutScheduleMs) && timeoutScheduleMs.length
      ? timeoutScheduleMs.map((value) => Math.max(1000, Number(value) || 0))
      : DEFAULT_TIMEOUT_SCHEDULE_MS;
    const safeTimeoutGraceMs = Math.max(0, Number(timeoutGraceMs) || 0);
    const safeLateLoadWindowMs = Math.max(0, Number(lateLoadWindowMs) || 0);

    for (let index = 0; index < schedule.length; index += 1) {
      if (typeof isCancelled === 'function' && isCancelled()) {
        return { ok: false, cancelled: true, attempt: index + 1 };
      }

      const attempt = index + 1;
      const timeoutMs = schedule[index];
      const attemptUrl = buildReloadableUrl(url, refreshKey);

      if (typeof onAttempt === 'function') {
        onAttempt({ attempt, timeoutMs, url: attemptUrl });
      }

      iframe.removeAttribute('sandbox');
      iframe.src = 'about:blank';
      await delay(resetDelayMs);

      if (typeof isCancelled === 'function' && isCancelled()) {
        return { ok: false, cancelled: true, attempt };
      }

      const result = await new Promise((resolve) => {
        let settled = false;
        let timedOut = false;
        let inLateWindow = false;
        const timer = setTimeout(() => {
          timedOut = true;
          if (safeTimeoutGraceMs <= 0) {
            startLateWindowOrFail();
            return;
          }
          timeoutGraceTimer = setTimeout(() => {
            startLateWindowOrFail();
          }, safeTimeoutGraceMs);
        }, timeoutMs);
        let timeoutGraceTimer = null;
        let lateWindowTimer = null;

        function cleanup() {
          iframe.removeEventListener('load', onLoad);
          iframe.removeEventListener('error', onError);
          clearTimeout(timer);
          clearTimeout(timeoutGraceTimer);
          clearTimeout(lateWindowTimer);
        }

        function finish(payload) {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(payload);
        }

        function startLateWindowOrFail() {
          if (safeLateLoadWindowMs <= 0 || inLateWindow) {
            finish({ ok: false, reason: 'timeout', attempt, timeoutMs, attemptUrl });
            return;
          }
          inLateWindow = true;
          lateWindowTimer = setTimeout(() => {
            finish({ ok: false, reason: 'timeout', attempt, timeoutMs, attemptUrl });
          }, safeLateLoadWindowMs);
        }

        function onLoad() {
          const frameLocationHref = readFrameLocationHref(iframe);
          if (isBlankFrameLocation(frameLocationHref)) {
            // Ignore reset/intermediate blank loads and keep waiting for real content.
            iframe.addEventListener('load', onLoad, { once: true });
            return;
          }
          finish({
            ok: true,
            reason: inLateWindow
              ? 'late_load_recovered'
              : (timedOut ? 'load_after_timeout_grace' : 'load'),
            attempt,
            timeoutMs,
            attemptUrl,
            late: inLateWindow,
            frameLocationHref
          });
        }

        function onError() {
          finish({ ok: false, reason: 'error', attempt, timeoutMs, attemptUrl });
        }

        iframe.addEventListener('load', onLoad, { once: true });
        iframe.addEventListener('error', onError, { once: true });
        iframe.removeAttribute('sandbox');
        iframe.src = attemptUrl;
      });

      if (typeof isCancelled === 'function' && isCancelled()) {
        return { ok: false, cancelled: true, attempt };
      }

      if (result.ok) {
        if (typeof onSuccess === 'function') {
          onSuccess(result);
        }
        if (result.late && typeof onLateSuccess === 'function') {
          onLateSuccess(result);
        }
        return result;
      }

      if (typeof onFailure === 'function') {
        onFailure(result);
      }
    }

    return {
      ok: false,
      reason: 'exhausted',
      attempt: schedule.length
    };
  }

  window.BilmIframeLoader = {
    loadWithRetry
  };
})();
