import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const rootDir = path.resolve(process.cwd());
const port = Number(process.env.PORT || 8080);
const STATIC_CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=86400';
const DEFAULT_HEALTH_CHECK_ALLOWED_HOSTS = new Set([
  'storage-api.watchbilm.org',
  'data-api.watchbilm.org',
  'graphql.anilist.co',
  'api.themoviedb.org',
  'www.omdbapi.com',
  'api.tvmaze.com'
]);
const DEFAULT_CORS_ALLOWED_ORIGINS = new Set([
  'https://watchbilm.org',
  'https://www.watchbilm.org',
  'https://direct.watchbilm.org',
  'https://bilm.fly.dev',
  'https://inspecting.github.io',
  'https://cdn.jsdelivr.net'
]);

function resolveHealthCheckAllowedHosts() {
  const envValue = String(process.env.HEALTH_CHECK_ALLOWED_HOSTS || '').trim();
  const hosts = new Set([...DEFAULT_HEALTH_CHECK_ALLOWED_HOSTS]);
  if (!envValue) return hosts;
  envValue
    .split(',')
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean)
    .forEach((entry) => hosts.add(entry));
  return hosts;
}

function resolveCorsAllowedOrigins() {
  const envValue = String(process.env.CORS_ALLOWED_ORIGINS || '').trim();
  const origins = new Set([...DEFAULT_CORS_ALLOWED_ORIGINS]);
  if (!envValue) return origins;
  envValue
    .split(',')
    .map((entry) => normalizeRequestOrigin(entry))
    .filter(Boolean)
    .forEach((entry) => origins.add(entry));
  return origins;
}

function parseEnvInt(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const rawValue = Number(process.env[name]);
  if (!Number.isFinite(rawValue)) return fallback;
  const normalized = Math.floor(rawValue);
  if (normalized < min || normalized > max) return fallback;
  return normalized;
}

const HEALTH_CHECK_ALLOWED_HOSTS = resolveHealthCheckAllowedHosts();
const RATE_LIMIT_STORE = new Map();
let nextRateLimitSweepAtMs = 0;
const RATE_LIMIT_STORE_SOFT_CAP = 5000;
const TMDB_PATH_SEGMENT_RE = /^[a-z0-9_-]+$/i;
const TMDB_QUERY_KEY_RE = /^[a-z0-9_.-]+$/i;
const ANILIST_ALLOWED_PAYLOAD_KEYS = new Set(['query', 'variables', 'operationName', 'extensions']);
const RATE_LIMITS = Object.freeze({
  tmdb: Object.freeze({
    limit: parseEnvInt('TMDB_PROXY_RATE_LIMIT', 120, { min: 10, max: 5000 }),
    windowMs: parseEnvInt('TMDB_PROXY_RATE_WINDOW_MS', 60_000, { min: 1000, max: 3_600_000 })
  }),
  anilist: Object.freeze({
    limit: parseEnvInt('ANILIST_PROXY_RATE_LIMIT', 60, { min: 10, max: 5000 }),
    windowMs: parseEnvInt('ANILIST_PROXY_RATE_WINDOW_MS', 60_000, { min: 1000, max: 3_600_000 })
  }),
  healthcheck: Object.freeze({
    limit: parseEnvInt('HEALTH_CHECK_RATE_LIMIT', 20, { min: 5, max: 2000 }),
    windowMs: parseEnvInt('HEALTH_CHECK_RATE_WINDOW_MS', 60_000, { min: 1000, max: 3_600_000 })
  })
});
const CORS_ALLOWED_ORIGINS = resolveCorsAllowedOrigins();

const BASE_SECURITY_HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'SAMEORIGIN',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()'
});

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

function sendNoContent(res, status = 204, headers = {}) {
  res.writeHead(status, {
    ...BASE_SECURITY_HEADERS,
    ...headers
  });
  res.end();
}

function sendRedirect(res, location, status = 302, headers = {}) {
  const safeLocation = String(location || '/');
  res.writeHead(status, {
    ...BASE_SECURITY_HEADERS,
    ...headers,
    location: safeLocation
  });
  res.end();
}

function normalizeClientIp(rawValue) {
  const rawText = String(rawValue || '').trim();
  if (!rawText) return '';

  let value = rawText;
  if (value.startsWith('[') && value.includes(']')) {
    value = value.slice(1, value.indexOf(']'));
  }
  if (value.startsWith('::ffff:')) {
    value = value.slice(7);
  }
  if (value === '::1') {
    return '127.0.0.1';
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}$/.test(value)) {
    value = value.split(':')[0];
  }
  return value.toLowerCase();
}

function getClientIp(req) {
  const flyClientIp = normalizeClientIp(req.headers['fly-client-ip']);
  if (flyClientIp) return flyClientIp;

  const realIp = normalizeClientIp(req.headers['x-real-ip']);
  if (realIp) return realIp;

  const forwarded = String(req.headers['x-forwarded-for'] || '').trim();
  if (forwarded) {
    const chain = forwarded
      .split(',')
      .map((part) => normalizeClientIp(part))
      .filter(Boolean);
    if (chain.length) {
      // Use the right-most entry because trusted proxies append to the chain.
      return chain[chain.length - 1];
    }
  }

  return normalizeClientIp(req.socket?.remoteAddress) || 'unknown';
}

function normalizeRequestOrigin(rawOrigin) {
  const normalized = String(rawOrigin || '').trim();
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return '';
  }
}

function appendVary(existingValue, nextValue) {
  const existing = String(existingValue || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const normalizedExisting = new Set(existing.map((part) => part.toLowerCase()));
  if (!normalizedExisting.has(String(nextValue || '').toLowerCase())) {
    existing.push(nextValue);
  }
  return existing.join(', ');
}

function buildCorsHeaders(req, {
  methods = '',
  defaultAllowHeaders = 'content-type',
  includePreflight = false
} = {}) {
  const origin = normalizeRequestOrigin(req.headers.origin);
  if (!origin || !CORS_ALLOWED_ORIGINS.has(origin)) return {};

  const corsHeaders = {
    'access-control-allow-origin': origin,
    vary: 'Origin'
  };

  if (!includePreflight) return corsHeaders;

  if (methods) {
    corsHeaders['access-control-allow-methods'] = methods;
  }

  const requestedHeaders = String(req.headers['access-control-request-headers'] || '').trim().toLowerCase();
  if (requestedHeaders && /^[a-z0-9,_ -]+$/.test(requestedHeaders)) {
    corsHeaders['access-control-allow-headers'] = requestedHeaders;
    corsHeaders.vary = appendVary(corsHeaders.vary, 'Access-Control-Request-Headers');
  } else if (defaultAllowHeaders) {
    corsHeaders['access-control-allow-headers'] = defaultAllowHeaders;
  }
  corsHeaders['access-control-max-age'] = '600';
  corsHeaders.vary = appendVary(corsHeaders.vary, 'Access-Control-Request-Method');

  return corsHeaders;
}

function sweepRateLimitStore(nowMs) {
  if (nowMs < nextRateLimitSweepAtMs && RATE_LIMIT_STORE.size < RATE_LIMIT_STORE_SOFT_CAP) return;

  for (const [key, entry] of RATE_LIMIT_STORE.entries()) {
    if (nowMs >= Number(entry?.resetAtMs || 0)) {
      RATE_LIMIT_STORE.delete(key);
    }
  }
  nextRateLimitSweepAtMs = nowMs + 60_000;
}

function consumeRateLimit(bucketName, req) {
  const bucket = RATE_LIMITS[bucketName];
  if (!bucket) {
    return {
      allowed: true,
      limit: 0,
      remaining: 0,
      resetAtEpochSeconds: Math.ceil(Date.now() / 1000),
      retryAfterSeconds: 0
    };
  }

  const nowMs = Date.now();
  sweepRateLimitStore(nowMs);

  const ip = getClientIp(req);
  const key = `${bucketName}:${ip}`;
  let entry = RATE_LIMIT_STORE.get(key);
  if (!entry || nowMs >= Number(entry.resetAtMs || 0)) {
    entry = {
      count: 0,
      resetAtMs: nowMs + bucket.windowMs
    };
  }

  if (entry.count >= bucket.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAtMs - nowMs) / 1000));
    return {
      allowed: false,
      limit: bucket.limit,
      remaining: 0,
      resetAtEpochSeconds: Math.ceil(entry.resetAtMs / 1000),
      retryAfterSeconds
    };
  }

  entry.count += 1;
  RATE_LIMIT_STORE.set(key, entry);
  return {
    allowed: true,
    limit: bucket.limit,
    remaining: Math.max(0, bucket.limit - entry.count),
    resetAtEpochSeconds: Math.ceil(entry.resetAtMs / 1000),
    retryAfterSeconds: 0
  };
}

function rateLimitHeaders(rateLimitState) {
  return {
    'x-ratelimit-limit': String(Math.max(0, Number(rateLimitState?.limit || 0))),
    'x-ratelimit-remaining': String(Math.max(0, Number(rateLimitState?.remaining || 0))),
    'x-ratelimit-reset': String(Math.max(0, Number(rateLimitState?.resetAtEpochSeconds || 0)))
  };
}

function enforceRateLimit(req, res, bucketName, extraHeaders = {}) {
  const rateLimitState = consumeRateLimit(bucketName, req);
  const headers = rateLimitHeaders(rateLimitState);
  if (rateLimitState.allowed) {
    return {
      blocked: false,
      headers
    };
  }

  sendJson(res, 429, {
    error: 'Too Many Requests',
    code: `${bucketName}_rate_limited`,
    retryAfterSeconds: rateLimitState.retryAfterSeconds
  }, {
    ...extraHeaders,
    ...headers,
    'cache-control': 'no-store',
    'retry-after': String(rateLimitState.retryAfterSeconds)
  });
  return {
    blocked: true,
    headers
  };
}

function sanitizeAcceptHeader(rawValue) {
  const fallback = 'application/json, text/plain, */*';
  const value = String(rawValue || '').trim();
  if (!value) return fallback;
  if (value.length > 256) return fallback;
  if (/[\r\n]/.test(value)) return fallback;
  return value;
}

function sanitizeTmdbPath(pathname) {
  const rawPath = String(pathname || '').replace(/^\/api\/tmdb\/?/i, '');
  if (!rawPath.trim()) {
    return { error: 'TMDB path is required' };
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    return { error: 'Invalid TMDB path encoding' };
  }

  const normalizedPath = decodedPath
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '');

  if (!normalizedPath) {
    return { error: 'TMDB path is required' };
  }
  if (normalizedPath.length > 256) {
    return { error: 'TMDB path is too long' };
  }
  if (normalizedPath.includes('..')) {
    return { error: 'Invalid TMDB path' };
  }

  const segments = normalizedPath.split('/');
  if (segments.length > 8) {
    return { error: 'TMDB path depth exceeded' };
  }

  for (const segment of segments) {
    if (!segment || segment.length > 64 || !TMDB_PATH_SEGMENT_RE.test(segment)) {
      return { error: 'Invalid TMDB path segment' };
    }
  }

  return { path: normalizedPath };
}

function sanitizeTmdbSearchParams(searchParams) {
  const cleanParams = new URLSearchParams();
  let count = 0;
  let totalChars = 0;
  for (const [rawKey, rawValue] of searchParams.entries()) {
    const key = String(rawKey || '').trim();
    if (!key) continue;
    if (key.toLowerCase() === 'api_key') continue;
    if (!TMDB_QUERY_KEY_RE.test(key) || key.length > 64) {
      return { error: 'Invalid TMDB query parameter key' };
    }

    count += 1;
    if (count > 20) {
      return { error: 'Too many TMDB query parameters' };
    }

    const value = String(rawValue ?? '');
    if (value.length > 512) {
      return { error: 'TMDB query parameter value is too long' };
    }
    if (/[\u0000-\u001f\u007f]/.test(value)) {
      return { error: 'Invalid TMDB query parameter value' };
    }

    totalChars += key.length + value.length;
    if (totalChars > 2048) {
      return { error: 'TMDB query string is too large' };
    }

    cleanParams.append(key, value);
  }
  return { searchParams: cleanParams };
}

function sanitizeAniListPayload(rawBody) {
  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { error: 'Invalid JSON payload' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'AniList payload must be a JSON object' };
  }

  for (const key of Object.keys(parsed)) {
    if (!ANILIST_ALLOWED_PAYLOAD_KEYS.has(key)) {
      return { error: 'AniList payload contains unsupported keys' };
    }
  }

  const query = typeof parsed.query === 'string' ? parsed.query.trim() : '';
  if (!query) {
    return { error: 'AniList query is required' };
  }
  if (query.length > 12_000) {
    return { error: 'AniList query is too long' };
  }

  const sanitizedPayload = { query };

  if (typeof parsed.operationName !== 'undefined') {
    if (parsed.operationName === null) {
      sanitizedPayload.operationName = null;
    } else if (typeof parsed.operationName === 'string' && parsed.operationName.length <= 128) {
      sanitizedPayload.operationName = parsed.operationName;
    } else {
      return { error: 'AniList operationName is invalid' };
    }
  }

  if (typeof parsed.variables !== 'undefined') {
    const variables = parsed.variables;
    if (variables === null) {
      sanitizedPayload.variables = null;
    } else if (variables && typeof variables === 'object' && !Array.isArray(variables)) {
      const serializedVariables = JSON.stringify(variables);
      if (serializedVariables.length > 32_000) {
        return { error: 'AniList variables are too large' };
      }
      sanitizedPayload.variables = variables;
    } else {
      return { error: 'AniList variables must be an object or null' };
    }
  }

  if (typeof parsed.extensions !== 'undefined') {
    const extensions = parsed.extensions;
    if (extensions === null) {
      sanitizedPayload.extensions = null;
    } else if (extensions && typeof extensions === 'object' && !Array.isArray(extensions)) {
      const serializedExtensions = JSON.stringify(extensions);
      if (serializedExtensions.length > 8192) {
        return { error: 'AniList extensions are too large' };
      }
      sanitizedPayload.extensions = extensions;
    } else {
      return { error: 'AniList extensions must be an object or null' };
    }
  }

  return {
    body: JSON.stringify(sanitizedPayload)
  };
}

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...BASE_SECURITY_HEADERS,
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
      ...BASE_SECURITY_HEADERS
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
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    const preflightCorsHeaders = buildCorsHeaders(req, {
      methods: 'POST, OPTIONS',
      defaultAllowHeaders: 'content-type',
      includePreflight: true
    });
    sendNoContent(res, 204, {
      ...preflightCorsHeaders,
      allow: 'POST, OPTIONS',
      'cache-control': 'no-store'
    });
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed' }, {
      ...corsHeaders,
      allow: 'POST, OPTIONS',
      'cache-control': 'no-store'
    });
    return;
  }

  const { blocked, headers: rateLimitHeadersMap } = enforceRateLimit(req, res, 'anilist', corsHeaders);
  if (blocked) return;

  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    sendJson(res, 415, { error: 'Content-Type must be application/json' }, {
      ...corsHeaders,
      ...rateLimitHeadersMap,
      'cache-control': 'no-store'
    });
    return;
  }

  try {
    const body = await readRequestBody(req, 128 * 1024);
    if (!body.trim()) {
      sendJson(res, 400, { error: 'Request body is required' }, {
        ...corsHeaders,
        ...rateLimitHeadersMap,
        'cache-control': 'no-store'
      });
      return;
    }

    const sanitizedPayload = sanitizeAniListPayload(body);
    if (sanitizedPayload.error) {
      sendJson(res, 400, { error: sanitizedPayload.error }, {
        ...corsHeaders,
        ...rateLimitHeadersMap,
        'cache-control': 'no-store'
      });
      return;
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 12000);

    let upstream;
    try {
      upstream = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: sanitizedPayload.body,
        signal: abortController.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const payload = await upstream.text();
    res.writeHead(upstream.status, {
      ...BASE_SECURITY_HEADERS,
      ...corsHeaders,
      ...rateLimitHeadersMap,
      'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    });
    res.end(payload);
  } catch (error) {
    if (error?.statusCode === 413) {
      sendJson(res, 413, { error: 'Payload too large' }, {
        ...corsHeaders,
        ...rateLimitHeadersMap,
        'cache-control': 'no-store'
      });
      return;
    }
    if (error?.name === 'AbortError') {
      sendJson(res, 504, { error: 'AniList upstream timed out' }, {
        ...corsHeaders,
        ...rateLimitHeadersMap,
        'cache-control': 'no-store'
      });
      return;
    }
    sendJson(res, 502, { error: 'AniList proxy request failed' }, {
      ...corsHeaders,
      ...rateLimitHeadersMap,
      'cache-control': 'no-store'
    });
  }
}

async function handleTmdbProxy(req, res, pathname, searchParams) {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    const preflightCorsHeaders = buildCorsHeaders(req, {
      methods: 'GET, HEAD, OPTIONS',
      defaultAllowHeaders: 'accept, content-type',
      includePreflight: true
    });
    sendNoContent(res, 204, {
      ...preflightCorsHeaders,
      allow: 'GET, HEAD, OPTIONS',
      'cache-control': 'no-store'
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'Method Not Allowed' }, {
      ...corsHeaders,
      allow: 'GET, HEAD, OPTIONS',
      'cache-control': 'no-store'
    });
    return;
  }

  const { blocked, headers: rateLimitHeadersMap } = enforceRateLimit(req, res, 'tmdb', corsHeaders);
  if (blocked) return;

  const apiKey = String(process.env.TMDB_API_KEY || '').trim();
  if (!apiKey) {
    sendJson(res, 503, {
      error: 'TMDB proxy unavailable',
      code: 'tmdb_proxy_missing_api_key'
    }, {
      ...corsHeaders,
      ...rateLimitHeadersMap,
      'cache-control': 'no-store'
    });
    return;
  }

  const sanitizedPath = sanitizeTmdbPath(pathname);
  if (sanitizedPath.error) {
    sendJson(res, 400, { error: sanitizedPath.error }, {
      ...corsHeaders,
      ...rateLimitHeadersMap,
      'cache-control': 'no-store'
    });
    return;
  }

  const sanitizedSearchParams = sanitizeTmdbSearchParams(searchParams);
  if (sanitizedSearchParams.error) {
    sendJson(res, 400, { error: sanitizedSearchParams.error }, {
      ...corsHeaders,
      ...rateLimitHeadersMap,
      'cache-control': 'no-store'
    });
    return;
  }

  const upstreamUrl = new URL(`https://api.themoviedb.org/3/${sanitizedPath.path}`);
  sanitizedSearchParams.searchParams.forEach((value, key) => {
    upstreamUrl.searchParams.append(key, value);
  });
  upstreamUrl.searchParams.set('api_key', apiKey);

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 12000);
  try {
    const upstream = await fetch(upstreamUrl.toString(), {
      method: req.method,
      headers: {
        accept: sanitizeAcceptHeader(req.headers.accept)
      },
      signal: abortController.signal
    });
    const headers = {
      ...BASE_SECURITY_HEADERS,
      ...corsHeaders,
      ...rateLimitHeadersMap,
      'cache-control': 'no-store',
    };
    const contentType = upstream.headers.get('content-type');
    if (contentType) headers['content-type'] = contentType;
    res.writeHead(upstream.status, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const payload = await upstream.arrayBuffer();
    res.end(Buffer.from(payload));
  } catch (error) {
    if (error?.name === 'AbortError') {
      sendJson(res, 504, { error: 'TMDB upstream timed out' }, {
        ...corsHeaders,
        ...rateLimitHeadersMap,
        'cache-control': 'no-store'
      });
      return;
    }
    sendJson(res, 502, { error: 'TMDB proxy request failed' }, {
      ...corsHeaders,
      ...rateLimitHeadersMap,
      'cache-control': 'no-store'
    });
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
      const normalizedHost = String(parsed.hostname || '').trim().toLowerCase();
      const normalizedProtocol = String(parsed.protocol || '').trim().toLowerCase();
      const isLoopbackHost = normalizedHost === 'localhost'
        || normalizedHost === '127.0.0.1'
        || normalizedHost === '::1';
      const protocolAllowed = normalizedProtocol === 'https:' || (normalizedProtocol === 'http:' && isLoopbackHost);
      const hostAllowed = isLoopbackHost || HEALTH_CHECK_ALLOWED_HOSTS.has(normalizedHost);
      if (!protocolAllowed || !hostAllowed) {
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
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    const preflightCorsHeaders = buildCorsHeaders(req, {
      methods: 'POST, OPTIONS',
      defaultAllowHeaders: 'content-type',
      includePreflight: true
    });
    sendNoContent(res, 204, {
      ...preflightCorsHeaders,
      allow: 'POST, OPTIONS',
      'cache-control': 'no-store'
    });
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed' }, {
      ...corsHeaders,
      allow: 'POST, OPTIONS',
      'cache-control': 'no-store'
    });
    return;
  }

  const { blocked, headers: rateLimitHeadersMap } = enforceRateLimit(req, res, 'healthcheck', corsHeaders);
  if (blocked) return;

  let body;
  try {
    body = await readRequestBody(req, 128 * 1024);
  } catch (error) {
    if (error?.statusCode === 413) {
      sendJson(res, 413, { error: 'Payload too large' }, {
        ...corsHeaders,
        ...rateLimitHeadersMap,
        'cache-control': 'no-store'
      });
      return;
    }
    sendJson(res, 400, { error: 'Invalid request payload' }, {
      ...corsHeaders,
      ...rateLimitHeadersMap,
      'cache-control': 'no-store'
    });
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(body || '{}');
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON payload' }, {
      ...corsHeaders,
      ...rateLimitHeadersMap,
      'cache-control': 'no-store'
    });
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
  }, {
    ...corsHeaders,
    ...rateLimitHeadersMap,
    'cache-control': 'no-store'
  });
}

async function routeRequest(req, res) {
  const rawRequestTarget = String(req.url || '/');
  const querySeparatorIndex = rawRequestTarget.indexOf('?');
  const rawPathname = querySeparatorIndex >= 0
    ? rawRequestTarget.slice(0, querySeparatorIndex)
    : rawRequestTarget;
  const apiCorsHeaders = buildCorsHeaders(req);

  let url;
  try {
    url = new URL(rawRequestTarget || '/', 'http://localhost');
  } catch {
    sendJson(res, 400, { error: 'Bad Request' }, { 'cache-control': 'no-store' });
    return;
  }

  if (rawPathname === '/api/anilist') {
    await handleAniListProxy(req, res);
    return;
  }
  if (rawPathname === '/api/health/check') {
    await handleHealthCheck(req, res);
    return;
  }
  if (rawPathname === '/api/tmdb' || rawPathname.startsWith('/api/tmdb/')) {
    await handleTmdbProxy(req, res, rawPathname, url.searchParams);
    return;
  }
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: 'Not Found' }, {
      ...apiCorsHeaders,
      'cache-control': 'no-store'
    });
    return;
  }
  await serveStatic(req, res, url.pathname);
}

const server = http.createServer((req, res) => {
  routeRequest(req, res).catch((error) => {
    console.error('Unhandled request error:', error);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    sendJson(res, 500, { error: 'Internal Server Error' }, { 'cache-control': 'no-store' });
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`BILM server listening on http://0.0.0.0:${port}`);
});
