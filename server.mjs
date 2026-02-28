import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const port = Number(process.env.PORT || 8080);

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
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
  const targetPath = path.normalize(path.join(base, target));
  return targetPath.startsWith(base) ? targetPath : null;
}

function parseProxyTarget(prefix, pathname) {
  if (!pathname.startsWith(prefix)) return null;
  const encoded = pathname.slice(prefix.length);
  if (!encoded) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  try {
    return new URL(decoded);
  } catch {
    return null;
  }
}

function buildProxyUrl(url) {
  return `/scramjet/${encodeURIComponent(url)}`;
}

function rewriteHtml(html, baseUrl) {
  const baseTag = `<base href="${baseUrl.toString()}">`;
  let out = html;
  if (/<head[^>]*>/i.test(out) && !/<base\s/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  }

  out = out.replace(/\b(href|src|action)=(["'])([^"']+)\2/gi, (match, attr, quote, value) => {
    if (
      value.startsWith('data:') ||
      value.startsWith('blob:') ||
      value.startsWith('javascript:') ||
      value.startsWith('#')
    ) {
      return match;
    }

    let absolute;
    try {
      absolute = new URL(value, baseUrl).toString();
    } catch {
      return match;
    }

    return `${attr}=${quote}${buildProxyUrl(absolute)}${quote}`;
  });

  return out;
}

async function handleProxy(req, res, targetUrl) {
  const bodyAllowed = !['GET', 'HEAD'].includes(req.method || 'GET');
  const reqHeaders = new Headers();
  for (const [key, val] of Object.entries(req.headers)) {
    if (!val) continue;
    const lower = key.toLowerCase();
    if (['host', 'content-length'].includes(lower)) continue;
    if (Array.isArray(val)) {
      reqHeaders.set(key, val.join(', '));
    } else {
      reqHeaders.set(key, val);
    }
  }

  reqHeaders.set('origin', targetUrl.origin);
  reqHeaders.set('referer', targetUrl.toString());

  let upstream;
  try {
    upstream = await fetch(targetUrl, {
      method: req.method,
      headers: reqHeaders,
      body: bodyAllowed ? req : undefined,
      redirect: 'follow',
      duplex: bodyAllowed ? 'half' : undefined
    });
  } catch (error) {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Proxy upstream error: ${error?.message || 'unknown error'}`);
    return;
  }

  const headers = {};
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (
      [
        'content-security-policy',
        'x-frame-options',
        'content-encoding',
        'content-length',
        'transfer-encoding',
        'connection'
      ].includes(lower)
    ) {
      return;
    }
    if (lower === 'location') {
      try {
        const absolute = new URL(value, targetUrl).toString();
        headers.location = buildProxyUrl(absolute);
      } catch {
        headers.location = value;
      }
      return;
    }
    headers[key] = value;
  });

  const contentType = upstream.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    const html = await upstream.text();
    const rewritten = rewriteHtml(html, targetUrl);
    headers['content-type'] = 'text/html; charset=utf-8';
    headers['content-length'] = Buffer.byteLength(rewritten).toString();
    res.writeHead(upstream.status, headers);
    res.end(rewritten);
    return;
  }

  res.writeHead(upstream.status, headers);
  if (!upstream.body) {
    res.end();
    return;
  }
  const stream = upstream.body;
  stream.pipeTo(new WritableStream({
    write(chunk) {
      res.write(Buffer.from(chunk));
    },
    close() {
      res.end();
    },
    abort() {
      res.destroy();
    }
  })).catch(() => {
    res.destroy();
  });
}

async function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const candidate = safeJoin(rootDir, rel);
  if (!candidate) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  let stat;
  try {
    stat = await fsp.stat(candidate);
  } catch {
    // try folder index
    const folderCandidate = safeJoin(rootDir, path.join(rel, 'index.html'));
    if (!folderCandidate) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    try {
      stat = await fsp.stat(folderCandidate);
      if (stat.isFile()) {
        const ext = path.extname(folderCandidate).toLowerCase();
        const type = mimeTypes.get(ext) || 'application/octet-stream';
        res.writeHead(200, { 'content-type': type });
        fs.createReadStream(folderCandidate).pipe(res);
        return;
      }
    } catch {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
  }

  let filePath = candidate;
  if (stat.isDirectory()) {
    filePath = path.join(candidate, 'index.html');
  }

  try {
    const ext = path.extname(filePath).toLowerCase();
    const type = mimeTypes.get(ext) || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    fs.createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  const scramjetTarget = parseProxyTarget('/scramjet/', pathname);
  if (scramjetTarget) {
    await handleProxy(req, res, scramjetTarget);
    return;
  }

  const uvTarget = parseProxyTarget('/uv/service/', pathname);
  if (uvTarget) {
    await handleProxy(req, res, uvTarget);
    return;
  }

  await serveStatic(req, res, pathname);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`BILM server listening on http://0.0.0.0:${port}`);
});
