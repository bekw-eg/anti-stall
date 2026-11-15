import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boot } from './helpers.js';

/** Swagger: спецификация из живых маршрутов, у каждого — описание из API.md, UI на /api/docs. */
test('OpenAPI: все маршруты сервера описаны, приватные — с Bearer, UI отдаётся', async () => {
  const w = await boot();
  try {
    const spec = await (await fetch(`${w.url}/api/openapi.json`)).json();
    assert.equal(spec.openapi, '3.0.3');
    const ops = Object.entries(spec.paths).flatMap(([p, m]) => Object.entries(m).map(([k, o]) => ({ id: `${k.toUpperCase()} ${p}`, o })));
    assert.ok(ops.length >= 60, `операций в спецификации: ${ops.length}`);
    for (const p of ['/api/rooms/{id}/skip-focus', '/api/metrics', '/api/client-errors', '/api/rooms/{id}/chat']) assert.ok(spec.paths[p], p);
    const undocumented = ops.filter(({ o }) => !o.description).map(({ id }) => id);
    assert.deepEqual(undocumented, [], 'каждый маршрут описан в backend/docs/API.md');
    assert.deepEqual(spec.paths['/api/health'].get.security, []);
    assert.deepEqual(spec.paths['/api/rooms/{id}/join'].post.security, [{ bearer: [] }]);
    assert.equal(spec.paths['/api/rooms/{id}/join'].post.parameters[0].name, 'id');
    const ui = await fetch(`${w.url}/api/docs`);
    assert.equal(ui.status, 200);
    assert.match(await ui.text(), /swagger-ui-dist@5\.17\.14/);
  } finally { await w.close(); }
});
