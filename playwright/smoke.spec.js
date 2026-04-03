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

async function mockNativeFullscreenFailure(page) {
  await page.evaluate(() => {
    const setMethod = (obj, name, fn) => {
      if (!obj) return;
      try {
        obj[name] = fn;
        return;
      } catch {
        // Fall through to defineProperty.
      }
      try {
        Object.defineProperty(obj, name, {
          configurable: true,
          writable: true,
          value: fn
        });
      } catch {
        // Ignore unsupported descriptor updates in test stubs.
      }
    };
    const setGetter = (obj, name, getter) => {
      try {
        Object.defineProperty(obj, name, {
          configurable: true,
          get: getter
        });
      } catch {
        // Ignore unsupported descriptor updates in test stubs.
      }
    };
    let activeElement = null;
    const failRequest = () => Promise.reject(new Error('fullscreen blocked by test'));
    const targets = ['#videoPlayer', '#playerContainer', '#playerWithControls']
      .map((selector) => document.querySelector(selector))
      .filter(Boolean);

    setGetter(document, 'fullscreenElement', () => activeElement);
    setGetter(document, 'webkitFullscreenElement', () => activeElement);
    setGetter(document, 'msFullscreenElement', () => activeElement);

    targets.forEach((element) => {
      setMethod(element, 'requestFullscreen', failRequest);
      setMethod(element, 'webkitRequestFullscreen', failRequest);
      setMethod(element, 'msRequestFullscreen', failRequest);
    });

    const exit = () => {
      activeElement = null;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    };
    setMethod(document, 'exitFullscreen', exit);
    setMethod(document, 'webkitExitFullscreen', exit);
    setMethod(document, 'msExitFullscreen', exit);
  });
}

async function mockNativeFullscreenSuccess(page, targetSelector = '#videoPlayer') {
  await page.evaluate((selector) => {
    const setMethod = (obj, name, fn) => {
      if (!obj) return;
      try {
        obj[name] = fn;
        return;
      } catch {
        // Fall through to defineProperty.
      }
      try {
        Object.defineProperty(obj, name, {
          configurable: true,
          writable: true,
          value: fn
        });
      } catch {
        // Ignore unsupported descriptor updates in test stubs.
      }
    };
    const setGetter = (obj, name, getter) => {
      try {
        Object.defineProperty(obj, name, {
          configurable: true,
          get: getter
        });
      } catch {
        // Ignore unsupported descriptor updates in test stubs.
      }
    };
    let activeElement = null;
    window.__bilmFullscreenMock = {
      requestCount: 0,
      exitCount: 0
    };

    setGetter(document, 'fullscreenElement', () => activeElement);
    setGetter(document, 'webkitFullscreenElement', () => activeElement);
    setGetter(document, 'msFullscreenElement', () => activeElement);

    const failRequest = () => Promise.reject(new Error('fullscreen blocked by test'));
    const targets = ['#videoPlayer', '#playerContainer', '#playerWithControls']
      .map((entry) => document.querySelector(entry))
      .filter(Boolean);
    targets.forEach((element) => {
      setMethod(element, 'requestFullscreen', failRequest);
      setMethod(element, 'webkitRequestFullscreen', failRequest);
      setMethod(element, 'msRequestFullscreen', failRequest);
    });

    const target = document.querySelector(selector);
    if (target) {
      const succeedRequest = function succeedRequest() {
        window.__bilmFullscreenMock.requestCount += 1;
        activeElement = this;
        document.dispatchEvent(new Event('fullscreenchange'));
        return Promise.resolve();
      };
      setMethod(target, 'requestFullscreen', succeedRequest);
      setMethod(target, 'webkitRequestFullscreen', succeedRequest);
      setMethod(target, 'msRequestFullscreen', succeedRequest);
    }

    const exit = () => {
      window.__bilmFullscreenMock.exitCount += 1;
      activeElement = null;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    };
    setMethod(document, 'exitFullscreen', exit);
    setMethod(document, 'webkitExitFullscreen', exit);
    setMethod(document, 'msExitFullscreen', exit);
  }, targetSelector);
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

test('home shows and dismisses new season indicator after opening the title', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });

  await setLocalJson(page, 'bilm-continue-watching', [
    {
      provider: 'tmdb',
      type: 'tv',
      key: 'tmdb:tv:1399',
      id: 1399,
      tmdbId: 1399,
      title: 'Game of Thrones',
      link: '/tv/show.html?id=1399',
      poster: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
      source: 'TMDB',
      rating: 8.4,
      certification: 'TV-MA',
      season: 2,
      knownSeasonCount: 2,
      latestSeasonCount: 2,
      updatedAt: Date.now()
    }
  ]);

  await page.route('**/storage-api.watchbilm.org/**', async (route) => {
    const url = route.request().url();
    if (/\/media\/tmdb\/tv\/1399(?:\?.*)?$/i.test(url)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 1399,
          name: 'Game of Thrones',
          first_air_date: '2011-04-17',
          vote_average: 8.4,
          number_of_seasons: 3,
          genres: [{ id: 10765, name: 'Sci-Fi & Fantasy' }],
          seasons: [
            { season_number: 1, episode_count: 10 },
            { season_number: 2, episode_count: 10 },
            { season_number: 3, episode_count: 10 }
          ]
        })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] })
    });
  });

  await page.goto('/home/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.card-new-season-badge')).toHaveCount(1);

  await page.locator('#continueItems .movie-card').first().click();
  await expect(page).toHaveURL(/\/tv\/show\.html\?id=1399/);

  const seenSeasonCount = await page.evaluate(() => {
    const parsed = JSON.parse(localStorage.getItem('bilm-new-season-seen') || '{}');
    return Number(parsed['tmdb:tv:1399'] || 0) || 0;
  });
  expect(seenSeasonCount).toBe(3);

  await page.goto('/home/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.card-new-season-badge')).toHaveCount(0);
});

test('search uses backup providers when storage search exceeds 2 seconds', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });
  const pngBody = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7n2x0AAAAASUVORK5CYII=', 'base64');

  let tmdbBackupHits = 0;
  let omdbBackupHits = 0;
  let tvmazeBackupHits = 0;

  await page.route('**/image.tmdb.org/t/p/w500/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: pngBody
    });
  });

  await page.route('**/storage-api.watchbilm.org/media/tmdb/search/movie**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2_600));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] })
    });
  });

  await page.route('**/storage-api.watchbilm.org/media/tmdb/search/tv**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2_600));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] })
    });
  });

  await page.route('**/storage-api.watchbilm.org/media/omdb**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2_600));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ Search: [] })
    });
  });

  await page.route('**/storage-api.watchbilm.org/media/tvmaze/search/shows**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2_600));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([])
    });
  });

  await page.route('**/api/tmdb/search/movie**', async (route) => {
    tmdbBackupHits += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{
          id: 99123,
          title: 'Fast Backup Movie',
          release_date: '2024-05-10',
          poster_path: '/fast-backup-movie.png',
          vote_average: 8.1,
          popularity: 99
        }]
      })
    });
  });

  await page.route('**/api/tmdb/search/tv**', async (route) => {
    tmdbBackupHits += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] })
    });
  });

  await page.route('https://www.omdbapi.com/**', async (route) => {
    omdbBackupHits += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ Search: [] })
    });
  });

  await page.route('https://api.tvmaze.com/**', async (route) => {
    tvmazeBackupHits += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([])
    });
  });

  const startMs = Date.now();
  await page.goto('/search/?q=backup-speed', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.movie-card .card-title', { hasText: 'Fast Backup Movie' })).toBeVisible({ timeout: 10_000 });

  expect(tmdbBackupHits).toBeGreaterThan(0);
  expect(omdbBackupHits).toBeGreaterThan(0);
  expect(tvmazeBackupHits).toBeGreaterThan(0);
  expect(Date.now() - startMs).toBeLessThan(10_000);
});

test('search shows tmdb results before delayed enrichment finishes', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });
  const pngBody = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7n2x0AAAAASUVORK5CYII=', 'base64');

  await page.route('**/image.tmdb.org/t/p/w500/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: pngBody
    });
  });

  await page.route('**/storage-api.watchbilm.org/media/tmdb/search/movie**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{
          id: 77531,
          title: 'Immediate TMDB Result',
          release_date: '2025-04-03',
          poster_path: '/immediate-result.png',
          vote_average: 7.4,
          popularity: 55
        }]
      })
    });
  });

  await page.route('**/storage-api.watchbilm.org/media/tmdb/search/tv**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] })
    });
  });

  await page.route('**/storage-api.watchbilm.org/media/omdb**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        Search: [{
          Title: 'Slow Enrichment Movie',
          Year: '2024',
          imdbID: 'tt1234567',
          Poster: 'https://example.com/slow-enrichment.jpg'
        }]
      })
    });
  });

  await page.route('**/storage-api.watchbilm.org/media/tvmaze/search/shows**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([])
    });
  });

  await page.route('**/storage-api.watchbilm.org/media/tmdb/find/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4_500));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ movie_results: [] })
    });
  });

  const startMs = Date.now();
  await page.goto('/search/?q=immediate tmdb', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.movie-card .card-title', { hasText: 'Immediate TMDB Result' })).toBeVisible({ timeout: 4_000 });
  expect(Date.now() - startMs).toBeLessThan(4_000);
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

test('tv watch applies synced season/episode progress and playback note updates', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: true, email: 'sync-tv@watchbilm.org' });

  await page.route('**/storage-api.watchbilm.org/media/tmdb/tv/1399/external_ids', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ imdb_id: 'tt0944947' })
    });
  });

  await page.route('**/storage-api.watchbilm.org/media/tmdb/tv/1399/content_ratings', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] })
    });
  });

  await page.route('**/storage-api.watchbilm.org/media/tmdb/tv/1399/similar**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] })
    });
  });

  await page.route('**/storage-api.watchbilm.org/media/tmdb/tv/1399/recommendations**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] })
    });
  });

  await page.route(/https:\/\/storage-api\.watchbilm\.org\/media\/tmdb\/tv\/1399(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 1399,
        name: 'Game of Thrones',
        first_air_date: '2011-04-17',
        vote_average: 8.4,
        number_of_seasons: 4,
        poster_path: '/u3bZgnGQ9T01sWNhyveQz0wH0Hl.jpg',
        genres: [{ id: 10765, name: 'Sci-Fi & Fantasy' }],
        seasons: [
          { season_number: 1, episode_count: 10 },
          { season_number: 2, episode_count: 10 },
          { season_number: 3, episode_count: 10 },
          { season_number: 4, episode_count: 10 }
        ]
      })
    });
  });

  await page.goto('/tv/watch/viewer.html?id=1399', { waitUntil: 'domcontentloaded' });

  await expect.poll(async () => {
    return page.evaluate(() => document.querySelectorAll('#seasonSelect option').length);
  }).toBeGreaterThan(0);

  await page.evaluate(() => {
    const progressKey = 'bilm-tv-progress-tmdb-1399';
    localStorage.setItem(progressKey, JSON.stringify({
      season: 2,
      episode: 3,
      seasonEpisodes: { 2: 3, 1: 1 }
    }));
    localStorage.setItem('bilm-playback-note', JSON.stringify({
      'tmdb:tv:1399-s2-e3': '1:15'
    }));
    window.dispatchEvent(new CustomEvent('bilm:sync-applied', {
      detail: {
        source: 'sector-sync',
        listKeys: [],
        storageKeys: [progressKey, 'bilm-playback-note']
      }
    }));
  });

  await expect.poll(async () => {
    return page.evaluate(() => ({
      season: document.querySelector('#seasonSelect')?.value || '',
      episode: document.querySelector('#episodeSelect')?.value || '',
      hours: document.querySelector('#playbackNoteHours')?.value || '',
      minutes: document.querySelector('#playbackNoteMinutes')?.value || ''
    }));
  }).toEqual({
    season: '2',
    episode: '3',
    hours: '1',
    minutes: '15'
  });
});

test('anime watch keeps subtitles disabled', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });
  await page.goto('/tv/watch/viewer.html?anime=1&aid=21459&type=tv');
  await expect(page.locator('#playexBar')).toBeVisible();
  await expect(page.locator('#subtitleBtn')).toBeHidden();
  await expect(page.locator('#autoplayBtn')).toHaveCount(0);
});

test('movie watch fullscreen falls back to simulated shell when native fullscreen fails', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });
  await page.goto('/movies/watch/viewer.html?id=447365', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#fullscreenBtn')).toBeVisible();
  await expect(page.locator('#playexBar')).toBeVisible();

  await mockNativeFullscreenFailure(page);
  await page.click('#fullscreenBtn');

  await expect(page.locator('#playerWithControls')).toHaveClass(/(^| )simulated-fullscreen( |$)/);
  await expect(page.locator('#mediaHeader')).toBeHidden();
  await expect(page.locator('#playexBar')).toBeHidden();
  await expect(page.locator('#navbarContainer')).toHaveClass(/(^| )hide-navbar( |$)/);
  await expect(page.locator('#closeBtn')).toBeVisible();
  const simulatedStyles = await page.evaluate(() => {
    const shell = document.getElementById('playerWithControls');
    const container = document.getElementById('playerContainer');
    const shield = document.getElementById('clickShield');
    const shellStyles = shell ? getComputedStyle(shell) : null;
    const containerStyles = container ? getComputedStyle(container) : null;
    const shieldStyles = shield ? getComputedStyle(shield) : null;
    return {
      shellRadius: shellStyles?.borderRadius || '',
      shellBackground: shellStyles?.backgroundColor || '',
      containerRadius: containerStyles?.borderRadius || '',
      containerBackground: containerStyles?.backgroundColor || '',
      shieldBackground: shieldStyles?.backgroundColor || ''
    };
  });
  expect(simulatedStyles.shellRadius).toBe('0px');
  expect(simulatedStyles.containerRadius).toBe('0px');
  expect(simulatedStyles.shellBackground).toBe('rgb(0, 0, 0)');
  expect(simulatedStyles.containerBackground).toBe('rgb(0, 0, 0)');
  expect(['rgba(0, 0, 0, 0)', 'transparent']).toContain(simulatedStyles.shieldBackground);

  await page.click('#closeBtn');
  await expect(page.locator('#playerWithControls')).not.toHaveClass(/(^| )simulated-fullscreen( |$)/);
  await expect(page.locator('#closeBtn')).toBeHidden();
  await expect(page.locator('#navbarContainer')).not.toHaveClass(/(^| )hide-navbar( |$)/);
});

test('tv watch fullscreen fallback hides compact controls and restores on close', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });
  await page.goto('/tv/watch/viewer.html?id=1399', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#fullscreenBtn')).toBeVisible();
  await expect(page.locator('#controlsCompact')).toBeVisible();

  await mockNativeFullscreenFailure(page);
  await page.click('#fullscreenBtn');

  await expect(page.locator('#playerWithControls')).toHaveClass(/(^| )simulated-fullscreen( |$)/);
  await expect(page.locator('#controlsCompact')).toBeHidden();
  await expect(page.locator('#playexBar')).toBeHidden();
  await expect(page.locator('#closeBtn')).toBeVisible();
  const simulatedStyles = await page.evaluate(() => {
    const shell = document.getElementById('playerWithControls');
    const container = document.getElementById('playerContainer');
    const shield = document.getElementById('clickShield');
    const shellStyles = shell ? getComputedStyle(shell) : null;
    const containerStyles = container ? getComputedStyle(container) : null;
    const shieldStyles = shield ? getComputedStyle(shield) : null;
    return {
      shellRadius: shellStyles?.borderRadius || '',
      shellBackground: shellStyles?.backgroundColor || '',
      containerRadius: containerStyles?.borderRadius || '',
      containerBackground: containerStyles?.backgroundColor || '',
      shieldBackground: shieldStyles?.backgroundColor || ''
    };
  });
  expect(simulatedStyles.shellRadius).toBe('0px');
  expect(simulatedStyles.containerRadius).toBe('0px');
  expect(simulatedStyles.shellBackground).toBe('rgb(0, 0, 0)');
  expect(simulatedStyles.containerBackground).toBe('rgb(0, 0, 0)');
  expect(['rgba(0, 0, 0, 0)', 'transparent']).toContain(simulatedStyles.shieldBackground);

  await page.click('#closeBtn');
  await expect(page.locator('#playerWithControls')).not.toHaveClass(/(^| )simulated-fullscreen( |$)/);
  await expect(page.locator('#controlsCompact')).toBeVisible();
  await expect(page.locator('#closeBtn')).toBeHidden();
});

test('watch fullscreen prefers native fullscreen before simulated fallback', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });
  await page.goto('/movies/watch/viewer.html?id=447365', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#fullscreenBtn')).toBeVisible();

  await mockNativeFullscreenSuccess(page, '#videoPlayer');
  await page.click('#fullscreenBtn');

  await expect(page.locator('#playerWithControls')).not.toHaveClass(/(^| )simulated-fullscreen( |$)/);
  await expect(page.locator('#navbarContainer')).toHaveClass(/(^| )hide-navbar( |$)/);
  const nativeStyles = await page.evaluate(() => {
    const htmlHasNativeClass = document.documentElement.classList.contains('native-fullscreen-active');
    const shell = document.getElementById('playerWithControls');
    const shield = document.getElementById('clickShield');
    const shellStyles = shell ? getComputedStyle(shell) : null;
    const shieldStyles = shield ? getComputedStyle(shield) : null;
    return {
      htmlHasNativeClass,
      shellRadius: shellStyles?.borderRadius || '',
      shellBackground: shellStyles?.backgroundColor || '',
      shieldBackground: shieldStyles?.backgroundColor || ''
    };
  });
  expect(nativeStyles.htmlHasNativeClass).toBe(true);
  expect(nativeStyles.shellRadius).toBe('0px');
  expect(nativeStyles.shellBackground).toBe('rgb(0, 0, 0)');
  expect(['rgba(0, 0, 0, 0)', 'transparent']).toContain(nativeStyles.shieldBackground);
  const enterStats = await page.evaluate(() => window.__bilmFullscreenMock);
  expect(enterStats?.requestCount ?? 0).toBeGreaterThan(0);

  await expect(page.locator('#closeBtn')).toBeVisible();
  await page.click('#closeBtn');

  const exitStats = await page.evaluate(() => window.__bilmFullscreenMock);
  expect(exitStats?.exitCount ?? 0).toBeGreaterThan(0);
  await expect(page.locator('#navbarContainer')).not.toHaveClass(/(^| )hide-navbar( |$)/);
  await expect(page.locator('#closeBtn')).toBeHidden();
});

test('anime watch fullscreen fallback uses the same black no-radius shell', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });
  await page.goto('/tv/watch/viewer.html?anime=1&aid=21459&type=tv', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#fullscreenBtn')).toBeVisible();

  await mockNativeFullscreenFailure(page);
  await page.click('#fullscreenBtn');

  await expect(page.locator('#playerWithControls')).toHaveClass(/(^| )simulated-fullscreen( |$)/);
  const styles = await page.evaluate(() => {
    const shell = document.getElementById('playerWithControls');
    const container = document.getElementById('playerContainer');
    const shield = document.getElementById('clickShield');
    const shellStyles = shell ? getComputedStyle(shell) : null;
    const containerStyles = container ? getComputedStyle(container) : null;
    const shieldStyles = shield ? getComputedStyle(shield) : null;
    return {
      shellRadius: shellStyles?.borderRadius || '',
      shellBackground: shellStyles?.backgroundColor || '',
      containerRadius: containerStyles?.borderRadius || '',
      containerBackground: containerStyles?.backgroundColor || '',
      shieldBackground: shieldStyles?.backgroundColor || ''
    };
  });
  expect(styles.shellRadius).toBe('0px');
  expect(styles.containerRadius).toBe('0px');
  expect(styles.shellBackground).toBe('rgb(0, 0, 0)');
  expect(styles.containerBackground).toBe('rgb(0, 0, 0)');
  expect(['rgba(0, 0, 0, 0)', 'transparent']).toContain(styles.shieldBackground);
});

test('movie filter drawer apply navigates to canonical URL-driven results', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });
  await page.route('**/storage-api.watchbilm.org/media/tmdb/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/genre/movie/list')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          genres: [
            { id: 28, name: 'Action' },
            { id: 18, name: 'Drama' }
          ]
        })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] })
    });
  });

  await page.goto('/movies/', { waitUntil: 'domcontentloaded' });
  await page.click('#filtersToggleBtn');
  await expect(page.locator('#filtersDrawer')).toBeVisible();
  await expect(page.locator('#filterGenreOptions .filter-option', { hasText: 'Action' })).toBeVisible();

  await page.locator('#filterGenreOptions .filter-option', { hasText: 'Action' }).click();
  await page.locator('#filterAgeRatingOptions .filter-option', { hasText: 'PG-13' }).click();
  await page.fill('#filterYearMin', '1995');
  await page.fill('#filterYearMax', '2005');
  await page.selectOption('#filterRatingMin', '7');
  await page.click('#applyFiltersBtn');

  await expect(page).toHaveURL(/\/movies\/category\.html\?/);
  const appliedUrl = new URL(page.url());
  expect(appliedUrl.searchParams.get('mode')).toBe('regular');
  expect(appliedUrl.searchParams.get('genre')).toBe('action');
  expect(appliedUrl.searchParams.get('age')).toBe('PG-13');
  expect(appliedUrl.searchParams.get('year_min')).toBe('1995');
  expect(appliedUrl.searchParams.get('year_max')).toBe('2005');
  expect(appliedUrl.searchParams.get('rating_min')).toBe('7');
});

test('movie quick chips deep-link to category URLs instead of in-page scroll', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });
  await page.route('**/storage-api.watchbilm.org/media/tmdb/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/genre/movie/list')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          genres: [{ id: 28, name: 'Action' }]
        })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] })
    });
  });

  await page.goto('/movies/', { waitUntil: 'domcontentloaded' });
  const actionChip = page.locator('#quickFilters a.filter-chip', { hasText: 'Action' }).first();
  await expect(actionChip).toBeVisible();
  const chipHref = await actionChip.getAttribute('href');
  expect(chipHref || '').toContain('/movies/category.html?');
  expect(chipHref || '').toContain('genre=action');
  expect(chipHref || '').not.toContain('#');

  await actionChip.click();
  await expect(page).toHaveURL(/\/movies\/category\.html\?/);
  const targetUrl = new URL(page.url());
  expect(targetUrl.searchParams.get('mode')).toBe('regular');
  expect(targetUrl.searchParams.get('genre')).toBe('action');
});

test('movies category regular mode forwards URL filters into TMDB discover query', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });
  const discoverRequests = [];

  await page.route('**/storage-api.watchbilm.org/media/tmdb/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/genre/movie/list')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          genres: [{ id: 28, name: 'Action' }]
        })
      });
      return;
    }
    if (url.pathname.endsWith('/discover/movie')) {
      discoverRequests.push(url.toString());
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] })
    });
  });

  await page.goto('/movies/category.html?mode=regular&genre=action&year_min=1995&year_max=2000&rating_min=7&age=PG-13&title=Filtered%20Movies', {
    waitUntil: 'domcontentloaded'
  });

  await expect.poll(() => discoverRequests.length).toBeGreaterThan(0);
  const discoverUrl = new URL(discoverRequests[0]);
  expect(discoverUrl.searchParams.get('with_genres')).toBe('28');
  expect(discoverUrl.searchParams.get('primary_release_date.gte')).toBe('1995-01-01');
  expect(discoverUrl.searchParams.get('primary_release_date.lte')).toBe('2000-12-31');
  expect(discoverUrl.searchParams.get('vote_average.gte')).toBe('7');
  expect(discoverUrl.searchParams.get('vote_count.gte')).toBe('50');
  expect(discoverUrl.searchParams.get('certification_country')).toBe('US');
  expect(discoverUrl.searchParams.get('certification')).toBe('PG-13');
});

test('movies category anime mode continues paged fetch while filtering', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });
  const pagesRequested = [];

  await page.route('**/storage-api.watchbilm.org/media/anilist', async (route) => {
    const payload = JSON.parse(route.request().postData() || '{}');
    const requestPage = Number(payload?.variables?.page || 0) || 0;
    pagesRequested.push(requestPage);

    let media = [];
    if (requestPage === 1) {
      media = Array.from({ length: 20 }, (_, index) => ({
        id: 10_000 + index,
        title: { romaji: `Adult ${index}`, english: `Adult ${index}` },
        averageScore: 78,
        isAdult: true,
        startDate: { year: 2020 },
        coverImage: { large: 'https://example.com/poster.jpg', medium: 'https://example.com/poster.jpg' }
      }));
    } else if (requestPage === 2) {
      media = [{
        id: 20_001,
        title: { romaji: 'Safe Anime', english: 'Safe Anime' },
        averageScore: 82,
        isAdult: false,
        startDate: { year: 2021 },
        coverImage: { large: 'https://example.com/poster.jpg', medium: 'https://example.com/poster.jpg' }
      }];
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          Page: { media }
        }
      })
    });
  });

  await page.goto('/movies/category.html?mode=anime&genre=action&age=not_adult&title=Anime%20Action', {
    waitUntil: 'domcontentloaded'
  });

  await expect.poll(() => Math.max(0, ...pagesRequested)).toBeGreaterThan(1);
  await expect.poll(async () => page.locator('#categoryGrid .movie-card').count()).toBeGreaterThan(0);
});

test('anime sections include view more links on movies and tv browse pages', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });
  await page.route('**/storage-api.watchbilm.org/media/tmdb/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/genre/movie/list')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ genres: [{ id: 28, name: 'Action' }] })
      });
      return;
    }
    if (url.pathname.endsWith('/genre/tv/list')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ genres: [{ id: 16, name: 'Animation' }] })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] })
    });
  });
  await page.route('**/storage-api.watchbilm.org/media/anilist', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { Page: { media: [] } } })
    });
  });

  await page.goto('/movies/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    document.getElementById('animeModeButton')?.click();
  });
  const movieAnimeViewMore = page.locator('#animeSections .view-more-button').first();
  await expect(movieAnimeViewMore).toBeVisible();
  const movieHref = await movieAnimeViewMore.getAttribute('href');
  expect(movieHref || '').toContain('/movies/category.html?mode=anime');

  await page.goto('/tv/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    document.getElementById('animeModeButton')?.click();
  });
  const tvAnimeViewMore = page.locator('#animeSections .view-more-button').first();
  await expect(tvAnimeViewMore).toBeVisible();
  const tvHref = await tvAnimeViewMore.getAttribute('href');
  expect(tvHref || '').toContain('/tv/category.html?mode=anime');
});

test('tv browse defers anime API traffic until anime mode is selected', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });
  let anilistRequests = 0;
  await page.route('**/storage-api.watchbilm.org/media/tmdb/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/genre/tv/list')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ genres: [{ id: 16, name: 'Animation' }] })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] })
    });
  });
  await page.route('**/storage-api.watchbilm.org/media/anilist', async (route) => {
    anilistRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { Page: { media: [] } } })
    });
  });

  await page.goto('/tv/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  expect(anilistRequests).toBe(0);

  await page.evaluate(() => {
    document.getElementById('animeModeButton')?.click();
  });
  await expect.poll(() => anilistRequests).toBeGreaterThan(0);
});

test('tv category age filtering keeps content-rating request concurrency bounded', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile-'), 'Desktop pass covers bounded concurrency instrumentation for this flow.');
  await mockAuthScript(page, { loggedIn: false });
  let inflightRatings = 0;
  let maxInflightRatings = 0;
  const discoverResults = Array.from({ length: 20 }, (_, index) => ({
    id: 9000 + index,
    name: `Show ${index + 1}`,
    first_air_date: '2020-01-01',
    vote_average: 8.1,
    poster_path: `/poster-${index + 1}.jpg`
  }));

  const tmdbHandler = async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/discover/tv')) {
      const requestPage = Number(url.searchParams.get('page') || '1');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: requestPage === 1 ? discoverResults : [],
          total_pages: 1
        })
      });
      return;
    }

    if (url.pathname.includes('/content_ratings')) {
      inflightRatings += 1;
      maxInflightRatings = Math.max(maxInflightRatings, inflightRatings);
      await new Promise((resolve) => setTimeout(resolve, 40));
      inflightRatings -= 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [{ iso_3166_1: 'US', rating: 'TV-14' }]
        })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] })
    });
  };
  await page.route('**/storage-api.watchbilm.org/media/tmdb/**', tmdbHandler);
  await page.route('**/api/tmdb/**', tmdbHandler);

  await page.goto('/tv/category.html?mode=regular&section=trending&age=TV-14&title=TV-14', {
    waitUntil: 'domcontentloaded'
  });

  await expect.poll(() => maxInflightRatings).toBeGreaterThan(0);
  expect(maxInflightRatings).toBeLessThanOrEqual(4);
});

test('navbar removes games/chat controls and clears legacy chat storage keys', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });
  await page.route('**/storage-api.watchbilm.org/media/tmdb/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/genre/movie/list')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ genres: [] })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] })
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem('bilm-shared-chat', JSON.stringify([{ id: 'legacy-msg', text: 'hello' }]));
    localStorage.setItem('bilm-sync-meta', JSON.stringify({
      lastChatSyncCursorMs: 12345,
      userSyncState: {
        'test-user': {
          lastChatSyncCursorMs: 777,
          keep: true
        }
      }
    }));
  });

  await page.goto('/movies/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#navbarContainer')).toBeAttached();

  const navbarState = await page.evaluate(() => {
    const root = document.querySelector('#navbarContainer')?.shadowRoot;
    const hasGamesButton = Boolean(root?.querySelector('button[data-page="games"]'));
    const hasChatWidget = Boolean(root?.querySelector('#sharedChatWidget, .shared-chat-widget, [data-chat-widget]'));

    const chatStorage = localStorage.getItem('bilm-shared-chat');
    const syncMeta = JSON.parse(localStorage.getItem('bilm-sync-meta') || '{}');
    const hasTopLevelChatCursor = Object.prototype.hasOwnProperty.call(syncMeta, 'lastChatSyncCursorMs');
    const scopedState = syncMeta?.userSyncState?.['test-user'] || {};
    const hasScopedChatCursor = Object.prototype.hasOwnProperty.call(scopedState, 'lastChatSyncCursorMs');
    return {
      hasGamesButton,
      hasChatWidget,
      chatStorage,
      hasTopLevelChatCursor,
      hasScopedChatCursor
    };
  });

  expect(navbarState.hasGamesButton).toBe(false);
  expect(navbarState.hasChatWidget).toBe(false);
  expect(navbarState.chatStorage).toBeNull();
  expect(navbarState.hasTopLevelChatCursor).toBe(false);
  expect(navbarState.hasScopedChatCursor).toBe(false);
});

test('games routes show removed page with home action', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });
  await page.goto('/games/', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/games\/?$/);
  await expect(page.getByRole('heading', { name: 'Games Removed' })).toBeVisible();
  await expect(page.locator('#goHomeLink')).toHaveAttribute('href', /\/home\/?$/);

  await page.goto('/games/play.html?from=test', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/games\/play\.html\?from=test$/);
  await expect(page.getByRole('heading', { name: 'Games Removed' })).toBeVisible();
  await expect(page.locator('#goHomeLink')).toHaveAttribute('href', /\/home\/?$/);
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

test('settings shows proxied control immediately for guests in disabled state', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });
  await setThemeSettings(page, { proxied: true });
  await page.goto('/settings/');
  await expect(page.locator('#proxiedControlRow')).toBeVisible();
  await expect(page.locator('#proxiedToggle')).toBeDisabled();
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

test('settings and account auth actions open shared navbar auth modal', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });

  await page.goto('/settings/', { waitUntil: 'domcontentloaded' });
  await page.click('#openSignInBtn');

  await expect.poll(async () => page.evaluate(() => {
    const root = document.querySelector('#navbarContainer')?.shadowRoot;
    const modal = root?.getElementById('navbarAuthModal');
    return Boolean(modal && !modal.hidden);
  })).toBe(true);

  await expect.poll(async () => page.evaluate(() => {
    const root = document.querySelector('#navbarContainer')?.shadowRoot;
    return Boolean(root?.getElementById('navbarAuthPasswordToggleBtn'));
  })).toBe(true);

  const panelWidth = await page.evaluate(() => {
    const root = document.querySelector('#navbarContainer')?.shadowRoot;
    const panel = root?.querySelector('.navbar-auth-panel');
    return panel ? Number.parseFloat(getComputedStyle(panel).width) : 0;
  });
  expect(panelWidth).toBeGreaterThan(360);

  await page.goto('/settings/account/', { waitUntil: 'domcontentloaded' });
  await page.click('#openLoginModalBtn');

  await expect.poll(async () => page.evaluate(() => {
    const root = document.querySelector('#navbarContainer')?.shadowRoot;
    const modal = root?.getElementById('navbarAuthModal');
    return Boolean(modal && !modal.hidden);
  })).toBe(true);
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
