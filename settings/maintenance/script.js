function detectBasePath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const appRoots = new Set(['home', 'movies', 'tv', 'games', 'search', 'settings', 'random', 'test', 'shared', 'index.html']);
  if (!parts.length || appRoots.has(parts[0])) return '';
  if (parts.length > 1 && appRoots.has(parts[1])) return `/${parts[0]}`;
  return '';
}

function withBase(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${detectBasePath()}${normalized}`;
}

document.addEventListener('DOMContentLoaded', () => {
  const resetThemeBtn = document.getElementById('resetThemeBtn');
  const resetDataBtn = document.getElementById('resetDataBtn');
  const resetStatusText = document.getElementById('resetStatusText');
  const restoreMigrationBtn = document.getElementById('restoreMigrationBtn');
  const clearMigrationBtn = document.getElementById('clearMigrationBtn');
  const migrationRecoveryCount = document.getElementById('migrationRecoveryCount');
  const migrationRecoveryStatus = document.getElementById('migrationRecoveryStatus');
  const runHealthCheckBtn = document.getElementById('runHealthCheckBtn');
  const healthCheckStatus = document.getElementById('healthCheckStatus');
  const healthCheckList = document.getElementById('healthCheckList');
  const clearSyncDebugBtn = document.getElementById('clearSyncDebugBtn');
  const syncDebugPanel = document.getElementById('syncDebugPanel');
  const syncDebugMessage = document.getElementById('syncDebugMessage');
  const syncDebugDetails = document.getElementById('syncDebugDetails');

  const DEBUG_ISSUE_LOCAL_KEY = 'debug-local-issue';
  const MIGRATION_QUARANTINE_KEY = 'bilm-media-identity-quarantine-v1';
  const MIGRATION_QUARANTINE_META_KEY = 'bilm-media-identity-quarantine-meta-v1';
  const HEALTH_CHECK_TARGETS = [
    { label: 'Storage API', url: 'https://storage-api.watchbilm.org/media/tmdb/configuration' },
    { label: 'Data API', url: 'https://data-api.watchbilm.org' },
    { label: 'AniList', url: 'https://graphql.anilist.co' },
    { label: 'VidSrc', url: 'https://vidsrc-embed.ru' },
    { label: 'EmbedMaster', url: 'https://embedmaster.link' },
    { label: 'MultiEmbed', url: 'https://multiembed.mov' },
    { label: 'VidKing', url: 'https://www.vidking.net' },
    { label: 'VidNest', url: 'https://vidnest.fun' }
  ];

  function showToast(message, tone = 'info', duration = 1000) {
    window.bilmToast?.show?.(message, { tone, duration });
  }

  function formatSyncTimestamp(atMs) {
    if (!Number.isFinite(Number(atMs)) || Number(atMs) <= 0) return 'Unknown';
    try {
      return new Date(Number(atMs)).toLocaleString();
    } catch {
      return 'Unknown';
    }
  }

  function readStoredDebugIssue() {
    try {
      const raw = localStorage.getItem(DEBUG_ISSUE_LOCAL_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function writeStoredDebugIssue(issue) {
    try {
      if (!issue) {
        localStorage.removeItem(DEBUG_ISSUE_LOCAL_KEY);
        return;
      }
      localStorage.setItem(DEBUG_ISSUE_LOCAL_KEY, JSON.stringify(issue));
    } catch {
      // local-only best effort
    }
  }

  function normalizeDebugIssue(issue, fallbackType = 'sync') {
    if (!issue || typeof issue !== 'object') return null;
    const normalizedType = String(issue?.type || fallbackType || 'sync').trim().toLowerCase() === 'other'
      ? 'other'
      : 'sync';
    const fallbackMessage = normalizedType === 'sync'
      ? 'Sync request failed.'
      : 'Unexpected runtime error detected.';
    const retryable = typeof issue?.retryable === 'boolean' ? issue.retryable : null;
    return {
      type: normalizedType,
      scope: String(issue?.scope || (normalizedType === 'sync' ? 'sync' : 'runtime')).trim() || (normalizedType === 'sync' ? 'sync' : 'runtime'),
      source: String(issue?.source || (normalizedType === 'sync' ? 'sync-engine' : 'window')).trim() || 'window',
      code: String(issue?.code || (normalizedType === 'sync' ? 'sync_error' : 'runtime_error')).trim() || 'runtime_error',
      message: String(issue?.message || fallbackMessage).trim() || fallbackMessage,
      retryable,
      status: Number(issue?.status || 0) || null,
      requestId: String(issue?.requestId || '').trim() || null,
      sectorKey: String(issue?.sectorKey || '').trim() || null,
      listKey: String(issue?.listKey || '').trim() || null,
      atMs: Number(issue?.atMs || Date.now()) || Date.now()
    };
  }

  function resetSyncDebugPanel({ clearStored = true } = {}) {
    if (!syncDebugMessage || !syncDebugDetails) return;
    syncDebugMessage.textContent = 'No debug issues detected on this page yet.';
    syncDebugDetails.textContent = '';
    syncDebugDetails.hidden = true;
    syncDebugPanel?.removeAttribute('data-state');
    if (clearStored) writeStoredDebugIssue(null);
  }

  function renderDebugIssue(issue, { persist = true } = {}) {
    if (!syncDebugMessage || !syncDebugDetails) return;
    const normalized = normalizeDebugIssue(issue, issue?.type || 'sync');
    if (!normalized) {
      resetSyncDebugPanel();
      return;
    }
    syncDebugPanel?.setAttribute('data-state', 'error');
    syncDebugMessage.textContent = normalized.message;
    const lines = [
      `Type: ${normalized.type === 'sync' ? 'Sync' : 'Other'}`,
      `Code: ${normalized.code}`,
      `Status: ${normalized.status ? normalized.status : 'n/a'}`,
      `Retryable: ${normalized.retryable === null ? 'n/a' : (normalized.retryable ? 'yes' : 'no')}`,
      `Request ID: ${normalized.requestId || 'n/a'}`,
      `Source: ${normalized.source}`,
      `Scope: ${normalized.scope}`,
      normalized.sectorKey ? `Sector: ${normalized.sectorKey}` : '',
      normalized.listKey ? `List: ${normalized.listKey}` : '',
      `Time: ${formatSyncTimestamp(normalized.atMs)}`
    ].filter(Boolean);
    syncDebugDetails.textContent = lines.join('\n');
    syncDebugDetails.hidden = false;
    if (persist) writeStoredDebugIssue(normalized);
  }

  function restoreDebugIssuePanel() {
    const stored = readStoredDebugIssue();
    if (!stored) {
      resetSyncDebugPanel({ clearStored: false });
      return;
    }
    renderDebugIssue(stored, { persist: false });
  }

  function reportRuntimeDebugIssue(reason, source = 'window') {
    const errorLike = reason instanceof Error ? reason : null;
    const message = String(
      errorLike?.message
      || reason?.message
      || reason?.toString?.()
      || 'Unexpected runtime error detected.'
    ).trim() || 'Unexpected runtime error detected.';
    const code = String(
      errorLike?.name
      || reason?.code
      || reason?.error
      || 'runtime_error'
    ).trim() || 'runtime_error';
    renderDebugIssue({
      type: 'other',
      scope: 'runtime',
      source,
      code,
      message,
      retryable: false,
      status: null,
      requestId: null,
      atMs: Date.now()
    });
  }

  async function ensureAuthReady() {
    const start = Date.now();
    while (!window.bilmAuth && Date.now() - start < 7000) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!window.bilmAuth) throw new Error('Auth module did not load.');
    await window.bilmAuth.init();
  }

  async function runWithMutationSuppression(task) {
    if (window.bilmAuth?.withMutationSuppressed) {
      return window.bilmAuth.withMutationSuppressed(task);
    }
    return task();
  }

  async function clearAllLocalData() {
    await runWithMutationSuppression(async () => {
      localStorage.clear();
      sessionStorage.clear();

      document.cookie.split(';').forEach((cookie) => {
        const eqPos = cookie.indexOf('=');
        const name = eqPos > -1 ? cookie.slice(0, eqPos).trim() : cookie.trim();
        if (name) {
          document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
        }
      });

      if (window.indexedDB?.databases) {
        const databases = await window.indexedDB.databases();
        await Promise.all((databases || []).map((db) => new Promise((resolve) => {
          if (!db.name) {
            resolve();
            return;
          }
          const request = window.indexedDB.deleteDatabase(db.name);
          request.onsuccess = () => resolve();
          request.onerror = () => resolve();
          request.onblocked = () => resolve();
        })));
      }

      if (window.caches?.keys) {
        const cacheKeys = await window.caches.keys();
        await Promise.all(cacheKeys.map((cacheKey) => window.caches.delete(cacheKey)));
      }
    });
  }

  function readMigrationQuarantineEntries() {
    try {
      const identityApi = window.BilmMediaIdentity;
      if (typeof identityApi?.readQuarantineEntries === 'function') {
        const entries = identityApi.readQuarantineEntries();
        return Array.isArray(entries) ? entries : [];
      }
      const parsed = JSON.parse(localStorage.getItem(MIGRATION_QUARANTINE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function updateMigrationRecoveryUi() {
    const entries = readMigrationQuarantineEntries();
    if (!migrationRecoveryCount) return;
    if (!entries.length) {
      migrationRecoveryCount.textContent = 'No quarantined items found.';
    } else {
      migrationRecoveryCount.textContent = `${entries.length} quarantined item${entries.length === 1 ? '' : 's'} available for manual recovery.`;
    }
    if (restoreMigrationBtn) restoreMigrationBtn.disabled = entries.length === 0;
    if (clearMigrationBtn) clearMigrationBtn.disabled = entries.length === 0;
  }

  function clearMigrationQuarantine() {
    try {
      localStorage.removeItem(MIGRATION_QUARANTINE_KEY);
      localStorage.setItem(MIGRATION_QUARANTINE_META_KEY, JSON.stringify({
        clearedAtMs: Date.now(),
        count: 0
      }));
      migrationRecoveryStatus.textContent = 'Quarantine cleared.';
      updateMigrationRecoveryUi();
    } catch (error) {
      migrationRecoveryStatus.textContent = `Could not clear quarantine: ${error.message}`;
    }
  }

  function restoreMigrationQuarantine() {
    const identityApi = window.BilmMediaIdentity;
    if (typeof identityApi?.restoreQuarantinedItems !== 'function') {
      migrationRecoveryStatus.textContent = 'Recovery API unavailable. Reload and try again.';
      return;
    }
    const result = identityApi.restoreQuarantinedItems();
    const restored = Number(result?.restored || 0) || 0;
    migrationRecoveryStatus.textContent = restored > 0
      ? `Restored ${restored} item${restored === 1 ? '' : 's'} from quarantine.`
      : 'No recoverable items were found.';
    updateMigrationRecoveryUi();
  }

  function renderHealthResults(results = []) {
    if (!healthCheckList) return;
    healthCheckList.innerHTML = '';
    if (!results.length) {
      const row = document.createElement('div');
      row.className = 'health-row';
      row.dataset.state = 'error';
      row.innerHTML = '<span class="label">No results</span><span class="state">Run checks to view status.</span>';
      healthCheckList.appendChild(row);
      return;
    }
    results.forEach((result) => {
      const row = document.createElement('div');
      row.className = 'health-row';
      row.dataset.state = result.ok ? 'ok' : 'error';

      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = result.label;

      const state = document.createElement('span');
      state.className = 'state';
      state.textContent = result.ok
        ? `ok (${result.latencyMs} ms)`
        : `failed (${result.error || result.status || 'network'})`;

      row.appendChild(label);
      row.appendChild(state);
      healthCheckList.appendChild(row);
    });
  }

  async function runConnectionHealthChecks() {
    if (!runHealthCheckBtn || !healthCheckStatus) return;
    runHealthCheckBtn.disabled = true;
    healthCheckStatus.textContent = 'Running checks...';
    try {
      const response = await fetch(withBase('/api/health/check'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ targets: HEALTH_CHECK_TARGETS })
      });
      if (!response.ok) {
        throw new Error(`Health endpoint failed with HTTP ${response.status}`);
      }
      const payload = await response.json();
      const results = Array.isArray(payload?.results) ? payload.results : [];
      renderHealthResults(results);
      const failed = results.filter((entry) => !entry.ok).length;
      if (failed === 0) {
        healthCheckStatus.textContent = `All ${results.length} checks passed.`;
      } else {
        healthCheckStatus.textContent = `${failed}/${results.length} checks failed.`;
      }
    } catch (error) {
      healthCheckStatus.textContent = `Health checks failed: ${error.message}`;
      renderHealthResults([]);
    } finally {
      runHealthCheckBtn.disabled = false;
    }
  }

  resetThemeBtn?.addEventListener('click', () => {
    if (!confirm('Reset theme to default settings?')) return;
    window.bilmTheme?.resetTheme?.();
    resetStatusText.textContent = 'Theme reset complete.';
    showToast('Theme reset complete.', 'success');
  });

  resetDataBtn?.addEventListener('click', async () => {
    const confirmReset = confirm('This will erase all local site data on this device. Continue?');
    if (!confirmReset) return;
    const typedConfirmation = prompt('Type RESET to confirm data wipe.');
    if (typedConfirmation?.trim().toUpperCase() !== 'RESET') {
      alert('Reset canceled. Confirmation text did not match.');
      return;
    }
    try {
      await clearAllLocalData();
      resetStatusText.textContent = 'Data reset complete. Reloading...';
      showToast('Data reset complete.', 'success');
      window.setTimeout(() => location.reload(), 250);
    } catch (error) {
      resetStatusText.textContent = `Reset failed: ${error.message}`;
      showToast('Data reset failed.', 'error');
    }
  });

  restoreMigrationBtn?.addEventListener('click', () => {
    restoreMigrationQuarantine();
  });

  clearMigrationBtn?.addEventListener('click', () => {
    if (!confirm('Clear all quarantined migration entries?')) return;
    clearMigrationQuarantine();
  });

  runHealthCheckBtn?.addEventListener('click', () => {
    runConnectionHealthChecks();
  });

  clearSyncDebugBtn?.addEventListener('click', () => {
    resetSyncDebugPanel();
  });

  window.addEventListener('error', (event) => {
    const runtimeReason = event?.error || { message: event?.message, code: 'window_error' };
    reportRuntimeDebugIssue(runtimeReason, 'window.error');
  });

  window.addEventListener('unhandledrejection', (event) => {
    reportRuntimeDebugIssue(event?.reason, 'unhandledrejection');
  });

  (async () => {
    updateMigrationRecoveryUi();
    restoreDebugIssuePanel();
    renderHealthResults([]);
    try {
      await ensureAuthReady();
      window.bilmAuth?.onSyncIssue?.((issue) => {
        renderDebugIssue({
          ...issue,
          type: 'sync',
          source: 'sync-engine'
        });
      });
    } catch (error) {
      reportRuntimeDebugIssue(error, 'auth-init');
    }
  })();
});
