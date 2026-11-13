import { AppError, E } from '../errors.js';

/** Минимальный роутер: '/api/rooms/:id/join' → regex + params. */
export class Router {
  constructor() {
    this.routes = [];
  }
  add(method, pattern, handler, { auth = true } = {}) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
    this.routes.push({ method, re, keys, handler, auth, pattern });
  }
  match(method, path) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
    if (pathMatched) throw new AppError(405, 'METHOD_NOT_ALLOWED', 'Метод не поддерживается');
    throw E.notFound('NOT_FOUND', 'Маршрут не найден');
  }
}

export async function readJson(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new AppError(413, 'BODY_TOO_LARGE', 'Слишком большое тело запроса');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw E.badRequest('INVALID_JSON', 'Некорректный JSON');
  }
}
