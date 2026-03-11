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

  function waitForLateLoad({ iframe, waitMs = DEFAULT_LATE_LOAD_WINDOW_MS, isCancelled = null }) {
    return new Promise((resolve) => {
      let settled = false;
      const timeoutId = setTimeout(() => finish(false), Math.max(0, Number(waitMs) || 0));

      function cleanup() {
        iframe.removeEventListener('load', onLateLoad);
        clearTimeout(timeoutId);
      }

      function finish(ok) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(ok);
      }

      function onLateLoad() {
        if (typeof isCancelled === 'function' && isCancelled()) {
          finish(false);
          return;
        }
        finish(true);
      }

      iframe.addEventListener('load', onLateLoad, { once: true });
    });
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
        const timer = setTimeout(() => {
          timedOut = true;
          if (safeTimeoutGraceMs <= 0) {
            finish({ ok: false, reason: 'timeout', attempt, timeoutMs, attemptUrl });
            return;
          }
          timeoutGraceTimer = setTimeout(() => {
            finish({ ok: false, reason: 'timeout', attempt, timeoutMs, attemptUrl });
          }, safeTimeoutGraceMs);
        }, timeoutMs);
        let timeoutGraceTimer = null;

        function cleanup() {
          iframe.removeEventListener('load', onLoad);
          iframe.removeEventListener('error', onError);
          clearTimeout(timer);
          clearTimeout(timeoutGraceTimer);
        }

        function finish(payload) {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(payload);
        }

        function onLoad() {
          finish({
            ok: true,
            reason: timedOut ? 'load_after_timeout_grace' : 'load',
            attempt,
            timeoutMs,
            attemptUrl
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

      if (result.ok) {
        if (typeof onSuccess === 'function') {
          onSuccess(result);
        }
        return result;
      }

      if (result.reason === 'timeout' && safeLateLoadWindowMs > 0) {
        const lateLoadRecovered = await waitForLateLoad({
          iframe,
          waitMs: safeLateLoadWindowMs,
          isCancelled
        });
        if (lateLoadRecovered) {
          const recoveredResult = {
            ok: true,
            reason: 'late_load_recovered',
            attempt,
            timeoutMs,
            attemptUrl,
            late: true
          };
          if (typeof onLateSuccess === 'function') {
            onLateSuccess(recoveredResult);
          }
          if (typeof onSuccess === 'function') {
            onSuccess(recoveredResult);
          }
          return recoveredResult;
        }
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
