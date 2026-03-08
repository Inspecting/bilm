(function () {
  const DEFAULT_TIMEOUT_SCHEDULE_MS = [10000, 12000];
  const RESET_DELAY_MS = 60;

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function buildReloadableUrl(url, refreshKey) {
    const key = String(refreshKey || 'bilm_refresh').trim() || 'bilm_refresh';
    return `${url}${url.includes('?') ? '&' : '?'}${encodeURIComponent(key)}=${Date.now()}`;
  }

  async function loadWithRetry({
    iframe,
    url,
    timeoutScheduleMs = DEFAULT_TIMEOUT_SCHEDULE_MS,
    refreshKey = 'bilm_refresh',
    resetDelayMs = RESET_DELAY_MS,
    isCancelled = null,
    onAttempt = null,
    onSuccess = null,
    onFailure = null
  } = {}) {
    if (!iframe || !url) {
      return { ok: false, reason: 'invalid_input', attempt: 0 };
    }

    const schedule = Array.isArray(timeoutScheduleMs) && timeoutScheduleMs.length
      ? timeoutScheduleMs.map((value) => Math.max(1000, Number(value) || 0))
      : DEFAULT_TIMEOUT_SCHEDULE_MS;

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
        const timer = setTimeout(() => finish({ ok: false, reason: 'timeout', attempt, timeoutMs }), timeoutMs);

        function cleanup() {
          iframe.removeEventListener('load', onLoad);
          iframe.removeEventListener('error', onError);
          clearTimeout(timer);
        }

        function finish(payload) {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(payload);
        }

        function onLoad() {
          finish({ ok: true, reason: 'load', attempt, timeoutMs });
        }

        function onError() {
          finish({ ok: false, reason: 'error', attempt, timeoutMs });
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
