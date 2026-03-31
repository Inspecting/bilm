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
    const shellStyles = shell ? getComputedStyle(shell) : null;
    const containerStyles = container ? getComputedStyle(container) : null;
    return {
      shellRadius: shellStyles?.borderRadius || '',
      shellBackground: shellStyles?.backgroundColor || '',
      containerRadius: containerStyles?.borderRadius || '',
      containerBackground: containerStyles?.backgroundColor || ''
    };
  });
  expect(simulatedStyles.shellRadius).toBe('0px');
  expect(simulatedStyles.containerRadius).toBe('0px');
  expect(simulatedStyles.shellBackground).toBe('rgb(0, 0, 0)');
  expect(simulatedStyles.containerBackground).toBe('rgb(0, 0, 0)');

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
    const shellStyles = shell ? getComputedStyle(shell) : null;
    const containerStyles = container ? getComputedStyle(container) : null;
    return {
      shellRadius: shellStyles?.borderRadius || '',
      shellBackground: shellStyles?.backgroundColor || '',
      containerRadius: containerStyles?.borderRadius || '',
      containerBackground: containerStyles?.backgroundColor || ''
    };
  });
  expect(simulatedStyles.shellRadius).toBe('0px');
  expect(simulatedStyles.containerRadius).toBe('0px');
  expect(simulatedStyles.shellBackground).toBe('rgb(0, 0, 0)');
  expect(simulatedStyles.containerBackground).toBe('rgb(0, 0, 0)');

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
    const shellStyles = shell ? getComputedStyle(shell) : null;
    return {
      htmlHasNativeClass,
      shellRadius: shellStyles?.borderRadius || '',
      shellBackground: shellStyles?.backgroundColor || ''
    };
  });
  expect(nativeStyles.htmlHasNativeClass).toBe(true);
  expect(nativeStyles.shellRadius).toBe('0px');
  expect(nativeStyles.shellBackground).toBe('rgb(0, 0, 0)');
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
    const shellStyles = shell ? getComputedStyle(shell) : null;
    const containerStyles = container ? getComputedStyle(container) : null;
    return {
      shellRadius: shellStyles?.borderRadius || '',
      shellBackground: shellStyles?.backgroundColor || '',
      containerRadius: containerStyles?.borderRadius || '',
      containerBackground: containerStyles?.backgroundColor || ''
    };
  });
  expect(styles.shellRadius).toBe('0px');
  expect(styles.containerRadius).toBe('0px');
  expect(styles.shellBackground).toBe('rgb(0, 0, 0)');
  expect(styles.containerBackground).toBe('rgb(0, 0, 0)');
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

test('games routes redirect to home', async ({ page }) => {
  await mockAuthScript(page, { loggedIn: false });
  await page.goto('/games/', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/home\/?$/);

  await page.goto('/games/play.html?from=test', { waitUntil: 'domcontentloaded' });
  const redirectedUrl = new URL(page.url());
  expect(redirectedUrl.pathname.endsWith('/home/')).toBe(true);
  expect(redirectedUrl.searchParams.get('from')).toBe('test');
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
