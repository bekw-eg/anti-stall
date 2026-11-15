/**
 * Swagger / OpenAPI 3: спецификация строится из ЖИВЫХ маршрутов роутера (не разойдётся с кодом),
 * описания — из таблиц backend/docs/API.md (единственный источник текста). GET /api/openapi.json, UI — GET /api/docs.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DOCS = fileURLToPath(new URL('../../docs/API.md', import.meta.url));

/** «| POST | `/api/rooms/:id/join` | участник | описание |» → Map('POST /api/rooms/:id/join' → { who, text }) */
export function parseApiDocs(markdown) {
  const out = new Map();
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^\|\s*(GET|POST|PATCH|PUT|DELETE)\b[^|]*\|\s*`([^`]+)`\s*\|(.*)\|\s*$/.exec(line);
    if (!m) continue;
    const rest = m[3].split('|').map((s) => s.trim());
    // 3 колонки: метод | путь | описание; 4: метод | путь | кто может | описание (в описании бывают «|» внутри `…`)
    const [who, ...text] = rest.length > 1 ? rest : [null, ...rest];
    out.set(`${m[1]} ${m[2].split('?')[0]}`, { who, text: text.join(' | ') });
  }
  return out;
}

const TAGS = [
  ['/api/auth', 'Аккаунт'], ['/api/users', 'Пользователь'], ['/api/friends', 'Друзья'],
  ['/td', 'Tower Defense'], ['/harvest', 'Harvest'], ['/social', 'Помощь и шутки'], ['/chat', 'Чат'],
  ['/voice', 'Голос'], ['/roadmap', 'Карта и цель'], ['/api/rooms', 'Комнаты и таймер'],
];
const tagOf = (path) => (TAGS.find(([p]) => path.includes(p)) ?? [null, 'Служебное'])[1];

const ERROR = {
  description: 'Ошибка: проверка сервера не пройдена',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
};

/** routes — router.routes ({ method, pattern, auth }); extra — маршруты вне роутера (метрики, ошибки клиента). */
export function buildOpenApi(routes, { demoMode = false, extra = [] } = {}) {
  const docs = existsSync(DOCS) ? parseApiDocs(readFileSync(DOCS, 'utf8')) : new Map();
  const paths = {};
  for (const r of [...routes, ...extra]) {
    const path = r.pattern.replace(/:([a-zA-Z]+)/g, '{$1}');
    const params = [...r.pattern.matchAll(/:([a-zA-Z]+)/g)].map(([, name]) => ({
      name, in: 'path', required: true, schema: { type: 'string' },
      description: name === 'id' ? 'id или код комнаты (6 символов)' : undefined,
    }));
    const doc = docs.get(`${r.method} ${r.pattern}`);
    const op = {
      tags: [tagOf(r.pattern)],
      summary: doc?.text?.replace(/`/g, '').slice(0, 120) || `${r.method} ${r.pattern}`,
      description: [doc?.who && `**Кто может:** ${doc.who}`, doc?.text].filter(Boolean).join('\n\n') || undefined,
      parameters: params.length ? params : undefined,
      security: r.auth === false ? [] : [{ bearer: [] }],
      responses: {
        200: { description: 'Успех (JSON)', content: { 'application/json': { schema: { type: 'object' } } } },
        400: ERROR, 401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 429: ERROR,
      },
    };
    if (r.method === 'POST' || r.method === 'PATCH' || r.method === 'PUT') {
      op.requestBody = { required: false, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } };
    }
    (paths[path] ??= {})[r.method.toLowerCase()] = op;
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'AntiStall API',
      version: '1.0',
      description: [
        'Коллективный Pomodoro с игрой на перерывах. Всё решает сервер: таймер, награды, игровые действия.',
        'Авторизация: `POST /api/users` (гость) или `POST /api/auth/login` → `token`, затем кнопка **Authorize** — Bearer-токен.',
        'События в реальном времени — WebSocket `/ws` (см. `backend/docs/API.md`).',
        demoMode ? '**Демо-сервер:** ускоренное время, только песочные аккаунты (`sandbox: true`).' : '',
      ].filter(Boolean).join('\n\n'),
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'Токен из POST /api/users, /api/auth/login или /api/users/transfer' } },
      schemas: {
        Error: {
          type: 'object',
          properties: { error: { type: 'object', properties: { code: { type: 'string', example: 'WRONG_PHASE' }, message: { type: 'string' }, details: { type: 'object' }, requestId: { type: 'string' } } } },
        },
      },
    },
    paths,
  };
}

/** Страница Swagger UI (скрипты с CDN jsdelivr, версия зафиксирована). */
export const SWAGGER_HTML = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AntiStall API — Swagger</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui.css">
<style>body{margin:0;background:#fff}.topbar{display:none}</style></head>
<body><div id="ui"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: '/api/openapi.json', dom_id: '#ui', persistAuthorization: true, docExpansion: 'none', filter: true, tryItOutEnabled: true });</script>
</body></html>`;
