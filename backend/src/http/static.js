import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
};

/**
 * Раздача собранного фронтенда (TOMATO_STATIC_DIR) для единого образа.
 *  - файлы только внутри корня: «..», абсолютные пути и нулевые байты не выходят за его пределы;
 *  - путь без расширения, которого нет на диске, → index.html (SPA-маршруты клиента);
 *  - /assets/* (имена с хешем от сборщика) кешируются навсегда, index.html — всегда перепроверяется.
 */
export function createStaticHandler(dir) {
  const root = resolve(dir);
  const indexPath = resolve(root, 'index.html');

  async function fileAt(path) {
    try {
      const st = await stat(path);
      return st.isFile() ? st : null;
    } catch {
      return null;
    }
  }

  function send(req, res, status, path, st) {
    const type = TYPES[extname(path).toLowerCase()] || 'application/octet-stream';
    const rel = path.slice(root.length).split(sep).join('/');
    const cache = path === indexPath ? 'no-cache' : rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
    res.writeHead(status, {
      'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff', 'Last-Modified': st.mtime.toUTCString(),
    });
    if (req.method === 'HEAD') return res.end();
    const stream = createReadStream(path);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
    return undefined;
  }

  function plain(req, res, status, text) {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : text);
  }

  return async function serveStatic(req, res, pathname) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return plain(req, res, 400, 'Bad Request');
    }
    if (decoded.includes('\0')) return plain(req, res, 400, 'Bad Request');
    // Ведущие слэши/обратные слэши срезаются, resolve нормализует «..»; затем строгая проверка, что путь внутри корня
    const target = resolve(root, '.' + sep + decoded.replace(/^[/\\]+/, ''));
    if (target !== root && !target.startsWith(root + sep)) return plain(req, res, 404, 'Not Found');

    const direct = target === root ? null : await fileAt(target);
    if (direct) return send(req, res, 200, target, direct);
    // SPA-fallback: «/room/ABC123» → index.html; отсутствующий файл с расширением («/assets/x.js») → 404
    if (target === root || !extname(target)) {
      const index = await fileAt(indexPath);
      if (index) return send(req, res, 200, indexPath, index);
    }
    return plain(req, res, 404, 'Not Found');
  };
}
