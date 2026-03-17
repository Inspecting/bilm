import { test, expect } from '@playwright/test';

async function mockAuthScript(page, { loggedIn = false, email = 'tester@watchbilm.org' } = {}) {
  const user = loggedIn ? { uid: 'test-user-1', email } : null;
  await page.route('**/shared/auth.js', async (route) => {
    const body = `
      (() => {
        let currentUser = ${JSON.stringify(user)};
        const authListeners = new Set();
        const notify = () => {
          authListeners.forEach((callback) => {
            try {
              callback(currentUser);
            } catch {
              // Ignore listener failures in test stubs.
            }
          });
        };

        window.bilmAuth = {
          async init() { return { auth: {}, firestore: null, analytics: null }; },
          getCurrentUser() { return currentUser; },
          onAuthStateChanged(callback) {
            authListeners.add(callback);
            Promise.resolve().then(() => {
              try {
                callback(currentUser);
              } catch {
                // Ignore listener failures in test stubs.
              }
            });
            return () => authListeners.delete(callback);
          },
          onCloudSnapshotChanged() { return () => {}; },
          onSyncIssue() { return () => {}; },
          async flushSyncNow() { return true; },
          async signOut() { currentUser = null; notify(); },
          async signIn(nextEmail) {
            currentUser = { uid: 'test-user-1', email: nextEmail || 'tester@watchbilm.org' };
            notify();
            return { user: currentUser };
          },
          async signUp(nextEmail) {
            currentUser = { uid: 'test-user-1', email: nextEmail || 'tester@watchbilm.org' };
            notify();
            return { user: currentUser };
          },
          async getCloudSnapshot() { return null; },
          async saveCloudSnapshot() { return true; },
          withMutationSuppressed(task) {
            return typeof task === 'function' ? task() : undefined;
          }
        };
      })();
    `;

    await route.fulfill({
      status: 200,
      contentType: 'text/javascript; charset=utf-8',
      body
    });
  });
}

async function setThemeSettings(page, partial) {
  await page.addInitScript((settingsPatch) => {
    const key = 'bilm-theme-settings';
    let current = {};
    try {
      current = JSON.parse(localStorage.getItem(key) || '{}');
    } catch {
      current = {};
    }
    localStorage.setItem(key, JSON.stringify({ ...current, ...settingsPatch }));
  }, partial);
}

async function setLocalJson(page, key, value) {
  await page.addInitScript(({ storageKey, payload }) => {
    localStorage.setItem(storageKey, JSON.stringify(payload));
  }, { storageKey: key, payload: value });
}

test('core routes render', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });
  await page.goto('/home/');
  await expect(page.locator('main')).toBeVisible();

  await page.goto('/movies/show.html?id=447365');
  await expect(page.locator('main')).toBeVisible();

  await page.goto('/tv/show.html?id=1399');
  await expect(page.locator('main')).toBeVisible();

  await page.goto('/settings/');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});

test('watch player menus are mutually exclusive', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });
  await page.goto('/movies/watch/viewer.html?id=447365');
  await expect(page.locator('#playexBar')).toBeVisible();

  await page.click('#subtitleBtn');
  await expect(page.locator('#subtitleDropdown')).toBeVisible();

  await page.click('#serverBtn');
  await expect(page.locator('#serverDropdown')).toBeVisible();
  await expect(page.locator('#subtitleDropdown')).toBeHidden();
});

test('watch player keeps selected server on embed timeout and keeps refresh available', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });

  await page.route('**/storage-api.watchbilm.org/media/tmdb/movie/447365', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 447365,
        title: 'Guardians of the Galaxy Vol. 3',
        release_date: '2023-05-05',
        poster_path: null,
        vote_average: 8.0,
        genres: [{ id: 878, name: 'Science Fiction' }]
      })
    });
  });

  await page.route('**/storage-api.watchbilm.org/media/tmdb/movie/447365/external_ids', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ imdb_id: 'tt6791350' })
    });
  });

  await page.route('**/storage-api.watchbilm.org/media/tmdb/movie/447365/release_dates', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] })
    });
  });

  await page.route(/https:\/\/embedmaster\.link\/.*/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    await route.abort();
  });

  await page.goto('/movies/watch/viewer.html?id=447365', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('#playerStatus')).toContainText('Tap refresh or choose another server.', { timeout: 20_000 });
  await expect(page.locator('#serverDropdown .serverDropdownItem.active')).toHaveAttribute('data-server', 'embedmaster');
  await expect(page.locator('#refreshBtn')).toBeVisible();
  await expect(page.locator('#refreshBtn')).toBeEnabled();
});

test('tv watch still attempts iframe load when tmdb metadata fails', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });

  await page.route(/https:\/\/storage-api\.watchbilm\.org\/media\/tmdb\/tv\/1399.*/, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'metadata unavailable' })
    });
  });

  await page.goto('/tv/watch/viewer.html?id=1399', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#videoPlayer')).toHaveAttribute(
    'src',
    /https:\/\/embedmaster\.link\/830gqxyfskjlsnbq\/tv\/1399\/1\/1\?bilm_refresh=/,
    { timeout: 15_000 }
  );
});

test('anime watch keeps subtitles disabled', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });
  await page.goto('/tv/watch/viewer.html?anime=1&aid=21459&type=tv');
  await expect(page.locator('#playexBar')).toBeVisible();
  await expect(page.locator('#subtitleBtn')).toBeHidden();
  await expect(page.locator('#autoplayBtn')).toHaveCount(0);
});

test('settings exposes diagnostics controls', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });
  await page.goto('/settings/');
  await expect(page.locator('#openMaintenanceBtn')).toBeVisible();
  await page.click('#openMaintenanceBtn');
  await expect(page).toHaveURL(/\/settings\/maintenance\/?$/);
  await expect(page.locator('#runHealthCheckBtn')).toBeVisible();
  await expect(page.locator('#restoreMigrationBtn')).toBeVisible();
});

test('proxied mode replaces loading page for logged-in users', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: true, email: 'proxy@watchbilm.org' });
  await setThemeSettings(page, { proxied: true, loading: false });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#bilmProxyShell')).toBeVisible();
  await expect(page.locator('#bilmProxyFrame')).toHaveAttribute('src', /https:\/\/bilm-scramjet\.fly\.dev\//);
  await expect(page.locator('#bilmProxyErrorPanel')).toBeHidden();
  expect(page.url()).not.toMatch(/\/home\/?$/);
});

test('proxied mode replaces navbar routes for logged-in users', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: true, email: 'proxy@watchbilm.org' });
  await setThemeSettings(page, { proxied: true });
  await page.goto('/home/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#bilmProxyShell')).toBeVisible();
  await expect(page.locator('#bilmProxyExitBtn')).toBeVisible();
});

test('guests ignore proxied mode and loading off still redirects home', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });
  await setThemeSettings(page, { proxied: true, loading: false });
  await page.goto('/');
  await expect(page).toHaveURL(/\/home\/?$/);
});

test('settings hides proxied control for guests', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });
  await setThemeSettings(page, { proxied: true });
  await page.goto('/settings/');
  await expect(page.locator('#proxiedControlRow')).toBeHidden();
});

test('settings shows proxied control for logged-in users and persists toggle', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: true, email: 'proxy@watchbilm.org' });
  await setThemeSettings(page, { proxied: false });
  await page.goto('/settings/');
  const proxiedRow = page.locator('#proxiedControlRow');
  const proxiedToggle = page.locator('#proxiedToggle');
  const proxiedToggleHandle = page.locator('#proxiedControlRow .toggle span');

  await expect(proxiedRow).toBeVisible();
  await expect(proxiedToggle).not.toBeChecked();
  await proxiedToggleHandle.click();
  await expect(proxiedToggle).toBeChecked();

  const storedProxied = await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('bilm-theme-settings') || '{}');
    return settings.proxied === true;
  });
  expect(storedProxied).toBe(true);
});

test('watch history keeps duplicate rows and delete removes only one entry', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });
  const now = Date.now();
  await setLocalJson(page, 'bilm-watch-history', [
    {
      provider: 'tmdb',
      type: 'movie',
      key: 'tmdb:movie:447365',
      id: 447365,
      tmdbId: 447365,
      title: 'Guardians of the Galaxy Vol. 3',
      link: '/movies/show.html?id=447365',
      updatedAt: now - 1000,
      historyEntryId: 'history-entry-1'
    },
    {
      provider: 'tmdb',
      type: 'movie',
      key: 'tmdb:movie:447365',
      id: 447365,
      tmdbId: 447365,
      title: 'Guardians of the Galaxy Vol. 3',
      link: '/movies/show.html?id=447365',
      updatedAt: now,
      historyEntryId: 'history-entry-2'
    }
  ]);

  await page.goto('/settings/history/');
  await page.click('#watchTabBtn');

  await expect(page.locator('#historyList .history-item')).toHaveCount(2);
  await expect(page.locator('#totalCount')).toHaveText('2');

  page.on('dialog', (dialog) => dialog.accept());
  await page.locator('#historyList .history-item .delete-btn').first().click();

  await expect(page.locator('#historyList .history-item')).toHaveCount(1);
  await expect(page.locator('#totalCount')).toHaveText('1');
});

test('continue watching upsert remains deduped by media key', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });
  await page.goto('/movies/watch/viewer.html?id=447365', { waitUntil: 'domcontentloaded' });

  const count = await page.evaluate(() => {
    localStorage.setItem('bilm-continue-watching', '[]');
    const update = window.upsertContinueWatchingItem;
    if (typeof update !== 'function') return -1;
    const now = Date.now();
    const base = {
      provider: 'tmdb',
      type: 'movie',
      key: 'tmdb:movie:447365',
      id: 447365,
      tmdbId: 447365,
      title: 'Guardians of the Galaxy Vol. 3',
      link: '/movies/show.html?id=447365',
      updatedAt: now
    };
    update(base);
    update({ ...base, updatedAt: now + 1000 });
    const parsed = JSON.parse(localStorage.getItem('bilm-continue-watching') || '[]');
    return Array.isArray(parsed) ? parsed.length : -1;
  });

  expect(count).toBe(1);
});
