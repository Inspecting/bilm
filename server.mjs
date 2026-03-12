import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const rootDir = path.resolve(process.cwd());
const port = Number(process.env.PORT || 8080);
const STATIC_CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=86400';

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.map', 'application/json; charset=utf-8']
]);

function safeJoin(base, target) {
  const normalizedBase = path.resolve(base);
  const normalizedTarget = path.resolve(normalizedBase, `.${String(target || '')}`);
  if (normalizedTarget === normalizedBase || normalizedTarget.startsWith(`${normalizedBase}${path.sep}`)) {
    return normalizedTarget;
  }
  return null;
}

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    ...headers
  });
  res.end(JSON.stringify(payload));
}

function staticHeaders(filePath, stat) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes.get(ext) || 'application/octet-stream';
  const etag = `W/"${Number(stat.size || 0)}-${Math.trunc(Number(stat.mtimeMs || 0))}"`;
  const isHtml = ext === '.html';
  return {
    etag,
    headers: {
      'content-type': contentType,
      'cache-control': isHtml ? 'no-cache' : STATIC_CACHE_CONTROL,
      'last-modified': stat.mtime.toUTCString(),
      etag,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin'
    }
  };
}

function streamFile(req, res, filePath, stat) {
  const { etag, headers } = staticHeaders(filePath, stat);
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'Failed to read static file' }, { 'cache-control': 'no-store' });
      return;
    }
    res.destroy();
  });
  stream.pipe(res);
}

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'Method Not Allowed' }, {
      allow: 'GET, HEAD',
      'cache-control': 'no-store'
    });
    return;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname || '/');
  } catch {
    sendJson(res, 400, { error: 'Bad Request' }, { 'cache-control': 'no-store' });
    return;
  }

  const rel = decodedPath === '/' ? '/index.html' : decodedPath;
  const candidate = safeJoin(rootDir, rel);
  if (!candidate) {
    sendJson(res, 403, { error: 'Forbidden' }, { 'cache-control': 'no-store' });
    return;
  }

  let filePath = candidate;
  let stat;
  try {
    stat = await fsp.stat(candidate);
  } catch {
    const folderCandidate = safeJoin(rootDir, path.join(rel, 'index.html'));
    if (!folderCandidate) {
      sendJson(res, 404, { error: 'Not Found' }, { 'cache-control': 'no-store' });
      return;
    }
    try {
      filePath = folderCandidate;
      stat = await fsp.stat(filePath);
    } catch {
      sendJson(res, 404, { error: 'Not Found' }, { 'cache-control': 'no-store' });
      return;
    }
  }

  if (stat.isDirectory()) {
    filePath = path.join(candidate, 'index.html');
    try {
      stat = await fsp.stat(filePath);
    } catch {
      sendJson(res, 404, { error: 'Not Found' }, { 'cache-control': 'no-store' });
      return;
    }
  }

  if (!stat.isFile()) {
    sendJson(res, 404, { error: 'Not Found' }, { 'cache-control': 'no-store' });
    return;
  }

  streamFile(req, res, filePath, stat);
}

async function readRequestBody(req, maxBytes = 256 * 1024) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      const error = new Error('Payload too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString('utf-8');
}

async function handleAniListProxy(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      allow: 'POST, OPTIONS',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    });
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed' }, {
      allow: 'POST, OPTIONS',
      'cache-control': 'no-store'
    });
    return;
  }

  try {
    const body = await readRequestBody(req);
    if (!body.trim()) {
      sendJson(res, 400, { error: 'Request body is required' }, { 'cache-control': 'no-store' });
      return;
    }

    try {
      JSON.parse(body);
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON payload' }, { 'cache-control': 'no-store' });
      return;
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 12000);

    let upstream;
    try {
      upstream = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body,
        signal: abortController.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const payload = await upstream.text();
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    });
    res.end(payload);
  } catch (error) {
    if (error?.statusCode === 413) {
      sendJson(res, 413, { error: 'Payload too large' }, { 'cache-control': 'no-store' });
      return;
    }
    if (error?.name === 'AbortError') {
      sendJson(res, 504, { error: 'AniList upstream timed out' }, { 'cache-control': 'no-store' });
      return;
    }
    sendJson(res, 502, { error: 'AniList proxy request failed' }, { 'cache-control': 'no-store' });
  }
}

async function handleTmdbProxy(req, res, pathname, searchParams) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'Method Not Allowed' }, {
      allow: 'GET, HEAD',
      'cache-control': 'no-store'
    });
    return;
  }

  const apiKey = String(process.env.TMDB_API_KEY || '').trim();
  if (!apiKey) {
    sendJson(res, 503, {
      error: 'TMDB proxy unavailable',
      code: 'tmdb_proxy_missing_api_key'
    }, { 'cache-control': 'no-store' });
    return;
  }

  const relativePath = String(pathname || '').replace(/^\/api\/tmdb\/?/i, '').trim();
  if (!relativePath) {
    sendJson(res, 400, { error: 'TMDB path is required' }, { 'cache-control': 'no-store' });
    return;
  }

  const upstreamUrl = new URL(`https://api.themoviedb.org/3/${relativePath}`);
  searchParams.forEach((value, key) => {
    if (String(key || '').toLowerCase() === 'api_key') return;
    upstreamUrl.searchParams.append(key, value);
  });
  upstreamUrl.searchParams.set('api_key', apiKey);

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 12000);
  try {
    const upstream = await fetch(upstreamUrl.toString(), {
      method: req.method,
      headers: {
        accept: req.headers.accept || 'application/json, text/plain, */*'
      },
      signal: abortController.signal
    });
    const payload = await upstream.arrayBuffer();
    const headers = {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    };
    const contentType = upstream.headers.get('content-type');
    if (contentType) headers['content-type'] = contentType;
    res.writeHead(upstream.status, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(Buffer.from(payload));
  } catch (error) {
    if (error?.name === 'AbortError') {
      sendJson(res, 504, { error: 'TMDB upstream timed out' }, { 'cache-control': 'no-store' });
      return;
    }
    sendJson(res, 502, { error: 'TMDB proxy request failed' }, { 'cache-control': 'no-store' });
  } finally {
    clearTimeout(timeoutId);
  }
}

function sanitizeHealthTargets(rawTargets = []) {
  if (!Array.isArray(rawTargets)) return [];
  const allowedMethods = new Set(['HEAD', 'GET', 'POST', 'OPTIONS']);
  return rawTargets
    .slice(0, 20)
    .map((target) => {
      const label = String(target?.label || '').trim();
      const rawUrl = String(target?.url || '').trim();
      if (!label || !rawUrl) return null;
      let parsed;
      try {
        parsed = new URL(rawUrl);
      } catch {
        return {
          label,
          url: rawUrl,
          invalid: true
        };
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return {
          label,
          url: rawUrl,
          invalid: true
        };
      }
      const requestedMethod = String(target?.method || 'HEAD').trim().toUpperCase();
      const method = allowedMethods.has(requestedMethod) ? requestedMethod : 'HEAD';
      const timeoutMsRaw = Number(target?.timeoutMs || 7000);
      const timeoutMs = Number.isFinite(timeoutMsRaw)
        ? Math.max(1000, Math.min(15000, Math.floor(timeoutMsRaw)))
        : 7000;
      const expectedStatuses = Array.isArray(target?.expectedStatuses)
        ? [...new Set(
          target.expectedStatuses
            .map((status) => Number(status || 0))
            .filter((status) => Number.isInteger(status) && status >= 100 && status <= 599)
            .slice(0, 10)
        )]
        : [];
      let headers = null;
      if (target?.headers && typeof target.headers === 'object' && !Array.isArray(target.headers)) {
        headers = {};
        for (const [rawKey, rawValue] of Object.entries(target.headers)) {
          const headerKey = String(rawKey || '').trim().toLowerCase();
          if (!headerKey || !/^[a-z0-9-]+$/.test(headerKey)) continue;
          headers[headerKey] = String(rawValue ?? '').slice(0, 1024);
        }
      }
      let body = null;
      if (method === 'POST' || method === 'OPTIONS') {
        if (typeof target?.body === 'string') {
          body = target.body.slice(0, 8192);
        } else if (typeof target?.body !== 'undefined') {
          try {
            body = JSON.stringify(target.body).slice(0, 8192);
            if (headers && typeof headers['content-type'] === 'undefined') {
              headers['content-type'] = 'application/json';
            }
          } catch {
            body = null;
          }
        }
      }
      return {
        label,
        url: parsed.toString(),
        method,
        timeoutMs,
        headers,
        body,
        expectedStatuses,
        invalid: false
      };
    })
    .filter(Boolean);
}

async function checkHealthTarget(target) {
  if (target.invalid) {
    return {
      label: target.label,
      url: target.url,
      ok: false,
      status: null,
      latencyMs: 0,
      error: 'invalid_target'
    };
  }

  const startedAt = Date.now();
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), Number(target.timeoutMs || 7000));
  try {
    const requestHeaders = {
      accept: 'application/json, text/plain, */*',
      ...(target.headers || {})
    };
    const requestInit = {
      method: target.method || 'HEAD',
      redirect: 'follow',
      signal: abortController.signal,
      headers: requestHeaders
    };
    if ((requestInit.method === 'POST' || requestInit.method === 'OPTIONS') && typeof target.body === 'string') {
      requestInit.body = target.body;
    }

    let response = await fetch(target.url, requestInit);

    if ((target.method || 'HEAD') === 'HEAD' && (response.status === 405 || response.status === 501)) {
      response = await fetch(target.url, {
        method: 'GET',
        redirect: 'follow',
        signal: abortController.signal,
        headers: requestHeaders
      });
    }
    const expectedStatuses = Array.isArray(target.expectedStatuses) ? target.expectedStatuses : [];
    const ok = expectedStatuses.length
      ? expectedStatuses.includes(Number(response.status || 0))
      : response.ok;

    return {
      label: target.label,
      url: target.url,
      method: target.method || 'HEAD',
      ok,
      status: response.status,
      latencyMs: Math.max(1, Date.now() - startedAt),
      error: ok ? null : `http_${response.status}`
    };
  } catch (error) {
    return {
      label: target.label,
      url: target.url,
      method: target.method || 'HEAD',
      ok: false,
      status: null,
      latencyMs: Math.max(1, Date.now() - startedAt),
      error: error?.name === 'AbortError' ? 'timeout' : 'request_failed'
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function handleHealthCheck(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      allow: 'POST, OPTIONS',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    });
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed' }, {
      allow: 'POST, OPTIONS',
      'cache-control': 'no-store'
    });
    return;
  }

  let body;
  try {
    body = await readRequestBody(req, 128 * 1024);
  } catch (error) {
    if (error?.statusCode === 413) {
      sendJson(res, 413, { error: 'Payload too large' }, { 'cache-control': 'no-store' });
      return;
    }
    sendJson(res, 400, { error: 'Invalid request payload' }, { 'cache-control': 'no-store' });
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(body || '{}');
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON payload' }, { 'cache-control': 'no-store' });
    return;
  }

  const targets = sanitizeHealthTargets(parsed?.targets || []);
  const results = [];
  for (const target of targets) {
    // Run sequentially to avoid burst traffic.
    // eslint-disable-next-line no-await-in-loop
    const result = await checkHealthTarget(target);
    results.push(result);
  }

  sendJson(res, 200, {
    ok: true,
    checkedAtMs: Date.now(),
    results
  }, { 'cache-control': 'no-store' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/anilist') {
    await handleAniListProxy(req, res);
    return;
  }
  if (url.pathname === '/api/health/check') {
    await handleHealthCheck(req, res);
    return;
  }
  if (url.pathname.startsWith('/api/tmdb/')) {
    await handleTmdbProxy(req, res, url.pathname, url.searchParams);
    return;
  }
  await serveStatic(req, res, url.pathname);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`BILM server listening on http://0.0.0.0:${port}`);
});
