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
  await serveStatic(req, res, url.pathname);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`BILM server listening on http://0.0.0.0:${port}`);
});
