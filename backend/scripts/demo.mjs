/**
 * Сквозная демонстрация для жюри на РЕАЛЬНЫХ часах и реальном сервере.
 *   1) TOMATO_DEMO=1 npm start          (сервер с ускоренными комнатами)
 *   2) npm run demo                      (этот скрипт)
 * Переменные: API=http://localhost:8787  FOCUS=25  BREAK=15
 */
import WebSocket from 'ws';

const API = process.env.API || 'http://localhost:8787';
const FOCUS = Number(process.env.FOCUS || 25);
const BREAK = Number(process.env.BREAK || 15);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const h = (t) => log(`\n\x1b[1m── ${t}\x1b[0m`);

async function call(method, path, body, token) {
  const res = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}
async function player(name) {
  const { body } = await call('POST', '/api/users', { name });
  const p = { name, id: body.user.id, token: body.token, events: [] };
  p.get = (path) => call('GET', path, undefined, p.token);
  p.post = (path, b = {}) => call('POST', path, b, p.token);
  p.progress = async () => (await p.get('/api/users/me/progress')).body;
  p.ws = new WebSocket(API.replace('http', 'ws') + '/ws');
  await new Promise((r) => p.ws.once('open', r));
  p.ws.on('message', (raw) => p.events.push(JSON.parse(String(raw))));
  p.ws.send(JSON.stringify({ type: 'auth', token: p.token }));
  return p;
}
const expect = (cond, msg) => { log(`${cond ? '  ✔' : '  ✘ ПРОВАЛ:'} ${msg}`); if (!cond) process.exitCode = 1; };

const lotti = await player('Лотти');
const anya = await player('Аня');
const boris = await player('Боря');
const all = [lotti, anya, boris];
const beat = setInterval(() => all.forEach((p) => p.post('/api/heartbeat')), 5000);

h('1. Комната и участники');
const created = await lotti.post('/api/rooms', { name: 'Боталка к экзамену', demo: true, focusSeconds: FOCUS, breakSeconds: BREAK });
if (created.status !== 201) { log(created.body); log('Запустите сервер с TOMATO_DEMO=1'); process.exit(1); }
const room = created.body.room;
const R = (p = '') => `/api/rooms/${room.id}${p}`;
for (const p of [anya, boris]) await p.post('/api/rooms/join', { code: room.code });
for (const p of all) p.ws.send(JSON.stringify({ type: 'subscribe', roomId: room.id }));
await lotti.post(R('/task'), { title: 'Математика' });
await anya.post(R('/task'), { title: 'Английский' });
await boris.post(R('/task'), { title: 'Физика' });
const view = (await anya.get(R())).body;
log(`  код комнаты ${room.code}; участники: ${view.members.map((m) => `${m.name} (${m.task})`).join(', ')}`);
expect(view.members.length === 3, 'все трое видят друг друга');

async function cycle(n, { abortAnya }) {
  h(`${n}. Общая фокус-сессия (${FOCUS} с вместо 25 минут)`);
  const s = await lotti.post(R('/start'));
  expect(s.body.room.phase === 'focus', 'таймер запущен сервером, фаза Focus у всех');
  const views = await Promise.all(all.map((p) => p.get(R())));
  const ends = new Set(views.map((v) => v.body.room.phaseEndsAt));
  expect(ends.size === 1, `у всех один phaseEndsAt, осталось ${Math.round(views[0].body.room.remainingMs / 1000)} с`);
  if (abortAnya) {
    await sleep(2000);
    const a = await anya.post(R('/session/abort'));
    expect(a.body.status === 'aborted', 'Аня завершила сессию досрочно — остальные продолжают');
  }
  const xp0 = await Promise.all(all.map((p) => p.progress()));
  while ((await lotti.get(R())).body.room.phase === 'focus') await sleep(500);
  const xp1 = await Promise.all(all.map((p) => p.progress()));
  all.forEach((p, i) => log(`  ${p.name}: +${xp1[i].xp - xp0[i].xp} XP, монет ${xp1[i].coins}, уровень ${xp1[i].level}`));
  if (abortAnya) expect(xp1[1].xp === xp0[1].xp, 'досрочно вышедшая Аня награды за сессию не получила');
  expect(xp1[0].xp - xp0[0].xp >= 100, 'завершившие получили XP');
}

await cycle(2, { abortAnya: true });

h('3. Перерыв: помощь и пакость');
const help = await lotti.post(R('/social/help'), { targetUserId: anya.id, type: 'boost' });
expect(help.status === 201, `Лотти помог Ане: +${help.body.xpBonusPct}% XP к следующей сессии`);
const prank = await lotti.post(R('/social/prank'), { targetUserId: boris.id, type: 'fog' });
expect(prank.status === 201, 'Лотти отправил Боре шуточный «туман» (эффект заканчивается к концу перерыва)');
const again = await lotti.post(R('/social/prank'), { targetUserId: boris.id, type: 'fog' });
expect(again.status !== 201, `повтор того же эффекта отклонён: ${again.body.error?.code}`);
await boris.post('/api/users/me', {}); // no-op
const off = await call('PATCH', '/api/users/me', { prankEnabled: false }, anya.token);
expect(off.body.prankEnabled === false, 'Аня отключила пакости');
await sleep(1200);
const refused = await boris.post(R('/social/prank'), { targetUserId: anya.id, type: 'sticker' });
expect(refused.body.error?.code === 'PRANKS_DISABLED', 'пакость Ане отклонена: получатель их отключил');

h('4. Защита от читов');
const hack = await call('PATCH', '/api/users/me', { xp: 99999, coins: 99999 }, boris.token);
expect(hack.body.xp < 1000, 'подмена xp/coins через профиль не сработала');
const fake = await boris.post(R('/complete'), {});
expect(fake.status === 404, '«завершить сессию» с клиента — такого маршрута нет');
const noMoney = await call('POST', '/api/users/me/upgrades/team_aura/purchase', {}, boris.token);
expect(noMoney.status >= 400, `покупка улучшения, закрытого по уровню: ${noMoney.body.error?.code}`);
const par = await Promise.all(Array.from({ length: 6 }, () => boris.post('/api/users/me/upgrades/base_walls/purchase', { expectedLevel: 0 })));
expect(par.filter((r) => r.status === 200).length <= 1, 'параллельные покупки: прошла не более одной');
const early = await lotti.post(R('/start'));
expect(early.body.error?.code === 'WRONG_PHASE', 'запуск Focus во время перерыва отклонён');

while ((await lotti.get(R())).body.room.phase === 'break') await sleep(500);
await cycle(5, { abortAnya: false });
while ((await lotti.get(R())).body.room.phase === 'break') await sleep(500);
await cycle(6, { abortAnya: false });

h('7. Командное испытание и достижения');
const road = (await lotti.get(R('/roadmap'))).body;
log(`  ${road.title}: ${road.points}/${road.goal}; позиция: ${road.positionNodeId}; вклад: ${road.contributions.map((c) => `${c.name}=${c.points}`).join(', ')}`);
expect(road.completed, 'команда достигла цели и получила награду');
const lp = await lotti.progress();
log('  достижения Лотти:', lp.achievements.filter((a) => a.unlocked).map((a) => a.title).join(', '));
const tx = (await lotti.get('/api/users/me/transactions?limit=200')).body.transactions;
expect(tx.filter((t) => t.kind === 'team_challenge').length === 1, 'командная награда выдана ровно один раз');
const ev = lotti.events.map((e) => e.type);
log('  WS-события Лотти:', [...new Set(ev)].join(', '));

clearInterval(beat);
all.forEach((p) => p.ws.close());
log(process.exitCode ? '\nЕСТЬ ПРОВАЛЫ' : '\nВсе проверки демо пройдены');
