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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/anilist') {
    await handleAniListProxy(req, res);
    return;
  }
  await serveStatic(req, res, url.pathname);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`BILM server listening on http://0.0.0.0:${port}`);
});
