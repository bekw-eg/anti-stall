/**
 * Сквозная демонстрация для жюри на РЕАЛЬНЫХ часах и реальном сервере.
 *   1) npm run start:demo                (сервер с ускоренными комнатами; = node src/server.js --demo)
 *   2) npm run demo                      (этот скрипт)
 * Игроки — песочные аккаунты (sandbox): только они могут играть в демо-комнатах, и их прогресс
 * не существует на сервере без демо-режима.
 * Переменные: API=http://localhost:8787 (или --api URL)  FOCUS=25  BREAK=15
 */
import WebSocket from 'ws';
import { API, requireDemoServer } from './lib/client.mjs';

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
  const { status, body } = await call('POST', '/api/users', { name, sandbox: true });
  if (status !== 201) { log(body); process.exit(1); }
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

await requireDemoServer();
const lotti = await player('Лотти');
const anya = await player('Аня');
const boris = await player('Боря');
const all = [lotti, anya, boris];
const beat = setInterval(() => all.forEach((p) => p.post('/api/heartbeat')), 5000);

h('1. Комната и участники');
const created = await lotti.post('/api/rooms', { name: 'Боталка к экзамену', demo: true, focusSeconds: FOCUS, breakSeconds: BREAK });
if (created.status !== 201) { log(created.body); log('Запустите сервер: npm run start:demo'); process.exit(1); }
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

async function cycle(n, { abortAnya, rate = false }) {
  h(`${n}. Общая фокус-сессия (${FOCUS} с вместо 25 минут)`);
  // Фокус стартует, когда готовы все участники в сети. Следующие циклы плана сервер запускает сам после перерыва.
  const now = (await lotti.get(R())).body.room.phase;
  if (now === 'waiting') {
    for (const p of all) await p.post(R('/ready'), { ready: true });
    const s = await lotti.post(R('/start'));
    expect(s.status === 200 && s.body.room.phase === 'focus', `хост запустил фокус, таймер ведёт сервер, фаза Focus у всех (${s.status} ${s.body?.error?.code ?? ''})`);
  } else {
    expect(now === 'focus', 'следующий фокус плана запущен сервером сам, фаза Focus у всех');
  }
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
  if (rate) {
    const rs = await Promise.all([lotti, boris].map((p) => p.post(R('/session/rating'), { stars: 5 })));
    expect(rs[0].status === 200 && rs[1].status === 200, 'Лотти и Боря оценили свою работу на 5★ (Аня не отвечает — для расчёта это 3★)');
    const stranger = await boris.post(R('/session/rating'), { stars: 1, sessionId: (await anya.get(R())).body.me.session.id });
    expect(stranger.status === 403, `чужую сессию оценить нельзя: ${stranger.body.error?.code}`);
    const again = await lotti.post(R('/session/rating'), { stars: 1 });
    expect(again.body.error?.code === 'ALREADY_RATED', 'повторная оценка отклонена: ALREADY_RATED');
  }
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
const regular = (await call('POST', '/api/users', { name: 'Обычный' })).body;
const intruder = await call('POST', '/api/rooms/join', { code: room.code }, regular.token);
expect(intruder.body.error?.code === 'DEMO_SANDBOX_ONLY', 'обычный аккаунт в демо-комнату не попадает (ускоренные награды — только песочнице)');
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
await cycle(5, { abortAnya: false, rate: true });
while ((await lotti.get(R())).body.room.phase === 'break') await sleep(500);
// в конце перерыва — командный бонус по средней оценке: Аня не отвечала (3★), остальные 5★ → (5+5+3)/3 ≈ 4,3★ → 100 × 0,43 = 43 XP
const bonus = async (p) => (await p.get('/api/users/me/transactions?limit=200')).body.transactions.filter((t) => t.kind === 'rating_bonus');
const [bl, bb, ba] = await Promise.all([bonus(lotti), bonus(boris), bonus(anya)]);
// бонус — по одному на каждый цикл с наградой: у Лотти и Бори их два (первый цикл — без оценок, 3★ → 30 XP; второй — 43 XP),
// у Ани один (в первом цикле она вышла досрочно — награды, а значит и бонуса, нет); ключ журнала не даёт начислить дважды
const uniq = (l) => new Set(l.map((t) => t.key)).size === l.length;
expect(bl.length === 2 && bb.length === 2 && ba.length === 1 && [bl, bb, ba].every(uniq), `бонус за оценку: по одному на цикл с наградой (Лотти ${bl.length}, Боря ${bb.length}, Аня ${ba.length}), повторов нет`);
expect(bl[0]?.xp === 43 && bb[0]?.xp === 43 && ba[0]?.xp === 54, `средняя ≈ 4,3★: Лотти +${bl[0]?.xp} XP, Боря +${bb[0]?.xp} XP, Аня +${ba[0]?.xp} XP (база × 0,43)`);
expect(bl[1]?.xp === 30, `первый цикл без оценок — все считаются как 3★: +${bl[1]?.xp} XP (база 100 × 0,3)`);
await cycle(6, { abortAnya: false });

h('7. Командное испытание и достижения');
const road = (await lotti.get(R('/roadmap'))).body;
log(`  ${road.title}: ${road.points}/${road.goal}; позиция: ${road.positionNodeId}; вклад: ${road.contributions.map((c) => `${c.name}=${c.points}`).join(', ')}`);
// узел карты открывает победа в игре или 2 × участники завершённых фокусов; цель — 4 узла, за три коротких цикла её не взять
expect(road.points >= 1 && !road.completed, `завершённые фокусы открыли узел без игры (${road.points}/${road.goal}), цель — впереди`);
const lp = await lotti.progress();
log('  достижения Лотти:', lp.achievements.filter((a) => a.unlocked).map((a) => a.title).join(', '));
const tx = (await lotti.get('/api/users/me/transactions?limit=200')).body.transactions;
expect(tx.filter((t) => t.kind === 'team_challenge').length === (road.completed ? 1 : 0), 'командная награда за цель не выдана раньше времени');
const ev = lotti.events.map((e) => e.type);
log('  WS-события Лотти:', [...new Set(ev)].join(', '));

clearInterval(beat);
all.forEach((p) => p.ws.close());
log(process.exitCode ? '\nЕСТЬ ПРОВАЛЫ' : '\nВсе проверки демо пройдены');
