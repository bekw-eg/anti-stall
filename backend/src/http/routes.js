import { ACHIEVEMENTS, BASE_HP, HELP_TYPES, PRANK_TYPES, ROADMAP, UPGRADES, upgradeCost, xpForLevel } from '../catalog.js';
import { E } from '../errors.js';
import { reqInt, reqObject } from '../validate.js';
import { Router } from './router.js';

/** Привязка REST-маршрутов к сервисам. Здесь нет бизнес-логики: только разбор запроса. */
export function buildRoutes({ config, users, rooms, game, social, td, db, clock }) {
  const r = new Router();
  const ok = (body, status = 200) => ({ status, body });

  r.add('GET', '/api/health', () => ok({ status: 'ok', serverTime: clock.now(), demoMode: config.demoMode }), { auth: false });

  r.add('GET', '/api/config', () => ok({
    serverTime: clock.now(),
    demoMode: config.demoMode,
    pomodoro: { focusMinutes: config.limits.focusMinutes, breakMinutes: config.limits.breakMinutes, defaults: { focusMinutes: 25, breakMinutes: 5 } },
    economy: { ...config.economy, levelFormula: 'xp(level) = 50 * level * (level - 1)', xpForLevel: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(xpForLevel) },
    social: { help: HELP_TYPES, prank: PRANK_TYPES, boost: config.social.boost, shield: config.social.shield, prankRules: { cooldownMs: config.social.prank.cooldownMs, maxPerBreak: config.social.prank.maxPerBreak } },
    presence: { onlineWindowMs: config.onlineWindowMs, graceMs: config.graceMs, broadcastTickMs: config.broadcastTickMs },
    upgrades: Object.values(UPGRADES).map((u) => ({ ...u, costs: Array.from({ length: u.maxLevel }, (_, i) => upgradeCost(u, i)) })),
    achievements: Object.values(ACHIEVEMENTS).map(({ condition, ...a }) => a),
    roadmap: { ...ROADMAP, baseHp: BASE_HP },
  }), { auth: false });

  // ---- пользователи
  r.add('POST', '/api/users', ({ body }) => ok(users.create(body), 201), { auth: false });
  r.add('GET', '/api/users/me', ({ user }) => ok(users.me(user.id)));
  r.add('PATCH', '/api/users/me', ({ user, body }) => ok(users.update(user.id, body)));
  r.add('GET', '/api/users/me/progress', ({ user }) => ok(game.progress(user.id)));
  r.add('GET', '/api/users/me/sessions', ({ user, query }) => ok({ sessions: users.sessions(user.id, query) }));
  r.add('GET', '/api/users/me/achievements', ({ user }) => ok({ achievements: game.listAchievements(user.id) }));
  r.add('GET', '/api/users/me/upgrades', ({ user }) => ok({ upgrades: game.listUpgrades(user.id) }));
  r.add('POST', '/api/users/me/upgrades/:id/purchase', ({ user, params, body }) => {
    const b = reqObject(body);
    const expected = b.expectedLevel === undefined ? undefined : reqInt(b.expectedLevel, 'expectedLevel', { min: 0, max: 100 });
    return ok(game.purchaseUpgrade(user.id, params.id, expected));
  });
  r.add('GET', '/api/users/me/transactions', ({ user, query }) => ok({ transactions: users.transactions(user.id, query) }));
  r.add('POST', '/api/heartbeat', ({ user }) => ok({ serverTime: clock.now(), userId: user.id }));

  // ---- комнаты
  r.add('POST', '/api/rooms', ({ user, body }) => ok(rooms.create(user, body), 201));
  r.add('POST', '/api/rooms/join', ({ user, body }) => {
    const b = reqObject(body);
    if (typeof b.code !== 'string') throw E.badRequest('INVALID_FIELD', 'Поле code обязательно', { field: 'code' });
    return ok(rooms.join(user, b.code));
  });
  r.add('GET', '/api/rooms/:id', ({ user, params }) => {
    rooms.advance(rooms.findRoom(params.id).id);
    const room = rooms.findRoom(params.id);
    rooms.requireMember(room, user);
    return ok(rooms.snapshot(room.id, user.id));
  });
  r.add('POST', '/api/rooms/:id/join', ({ user, params }) => ok(rooms.join(user, params.id)));
  r.add('POST', '/api/rooms/:id/leave', ({ user, params }) => ok(rooms.leave(user, params.id)));
  r.add('POST', '/api/rooms/:id/close', ({ user, params }) => ok(rooms.close(user, params.id)));
  r.add('PATCH', '/api/rooms/:id/settings', ({ user, params, body }) => ok(rooms.updateSettings(user, params.id, body)));
  r.add('POST', '/api/rooms/:id/team', ({ user, params, body }) => ok(rooms.setTeam(user, params.id, body)));
  r.add('POST', '/api/rooms/:id/task', ({ user, params, body }) => ok(rooms.setTask(user, params.id, body)));
  r.add('POST', '/api/rooms/:id/start', ({ user, params }) => ok(rooms.startFocus(user, params.id)));
  r.add('POST', '/api/rooms/:id/session/abort', ({ user, params }) => ok(rooms.abortSession(user, params.id)));
  r.add('POST', '/api/rooms/:id/session/result', ({ user, params, body }) => ok(rooms.recordResult(user, params.id, body)));
  r.add('POST', '/api/rooms/:id/skip-break', ({ user, params }) => ok(rooms.skipBreak(user, params.id)));
  r.add('POST', '/api/rooms/:id/heartbeat', ({ user, params }) => {
    rooms.requireMember(rooms.findRoom(params.id), user);
    return ok({ serverTime: clock.now() });
  });
  r.add('GET', '/api/rooms/:id/roadmap', ({ user, params }) => {
    const room = rooms.findRoom(params.id);
    rooms.requireMember(room, user);
    return ok(game.roadmapView(room.id, user.id));
  });
  r.add('GET', '/api/rooms/:id/game', ({ user, params }) => {
    const room = rooms.findRoom(params.id);
    rooms.requireMember(room, user);
    return ok(game.gameView(room.id));
  });
  // ---- Tower Defense (только на перерыве; всё решает сервер)
  r.add('GET', '/api/rooms/:id/td', ({ user, params }) => ok(td.get(user, params.id)));
  r.add('POST', '/api/rooms/:id/td/join', ({ user, params }) => ok(td.join(user, params.id)));
  r.add('POST', '/api/rooms/:id/td/start', ({ user, params, body }) => ok(td.start(user, params.id, body)));
  r.add('POST', '/api/rooms/:id/td/build', ({ user, params, body }) => ok(td.build(user, params.id, body), 201));
  r.add('POST', '/api/rooms/:id/td/upgrade', ({ user, params, body }) => ok(td.upgrade(user, params.id, body)));
  r.add('GET', '/api/rooms/:id/social', ({ user, params }) => ok({ actions: social.recent(user, params.id) }));
  r.add('POST', '/api/rooms/:id/social/help', ({ user, params, body }) => ok(social.help(user, params.id, body), 201));
  r.add('POST', '/api/rooms/:id/social/prank', ({ user, params, body }) => ok(social.prank(user, params.id, body), 201));

  return r;
}
