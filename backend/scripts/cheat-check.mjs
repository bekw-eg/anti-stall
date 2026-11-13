/**
 * Проверка защиты от читов на ЖИВОМ демо-сервере (npm run start:demo):
 *   npm run cheat-check [-- --api http://localhost:8787]
 * Скрипт сам создаёт песочных игроков, демо-комнаты (фокус 5 с) и обычный аккаунт, выполняет атаки
 * и печатает таблицу «Атака | Ожидание | Факт | PASS/FAIL». Код выхода 1, если хоть одна атака прошла.
 * Те же атаки детерминированно (FakeClock) проверяет tests/security.test.js.
 */
import { API, call, connectWs, createPlayer, printTable, requireDemoServer, sleep, waitPhase } from './lib/client.mjs';

const FOCUS = 5;
const BREAK = 40;
const demoRoom = (name) => ({ name, demo: true, focusSeconds: FOCUS, breakSeconds: BREAK });
const code = (r) => r.body?.error?.code ?? `HTTP ${r.status}`;
const rows = [];
let rid = 0;
const reqId = () => `cheat-${Date.now().toString(36)}-${++rid}`;
const txOf = async (u, kind) => (await u.get('/api/users/me/transactions?limit=200')).body.transactions.filter((t) => t.kind === kind);

/** Одна атака: fn возвращает {ok, fact}. Исключение = FAIL. */
async function attack(name, expected, fn) {
  try {
    const { ok, fact } = await fn();
    rows.push([name, expected, fact, ok ? 'PASS' : 'FAIL']);
  } catch (e) {
    rows.push([name, expected, `исключение: ${e.message}`, 'FAIL']);
  }
}

await requireDemoServer();
console.log(`Проверка защиты на ${API} (демо-комнаты: фокус ${FOCUS} с)…`);

// ---------------------------------------------------------------- подготовка
const tag = Date.now().toString(36).slice(-4);
const H = await createPlayer(`Хост-${tag}`);
const G1 = await createPlayer(`Гость1-${tag}`);
const G2 = await createPlayer(`Гость2-${tag}`);
const G3 = await createPlayer(`Гость3-${tag}`);
const P = await createPlayer(`Покупатель-${tag}`);
const N = await createPlayer(`Обычный-${tag}`, { sandbox: false });
const all = [H, G1, G2, G3, P];
const beat = setInterval(() => all.forEach((u) => u.post('/api/heartbeat').catch(() => {})), 5000);

const A = (await H.post('/api/rooms', demoRoom(`A-${tag}`))).body.room;
const B = (await P.post('/api/rooms', demoRoom(`B-${tag}`))).body.room;
if (!A || !B) { console.error('Не удалось создать демо-комнаты'); process.exit(1); }
const pa = (p = '') => `/api/rooms/${A.id}${p}`;
const pb = (p = '') => `/api/rooms/${B.id}${p}`;
for (const g of [G1, G2, G3]) await g.post('/api/rooms/join', { code: A.code });
await G3.post('/api/rooms/join', { code: B.code }); // Гость-3 состоит и в B
await H.post(pa('/task'), { title: `Секретная задача ${tag}` });
await G3.patch('/api/users/me', { prankEnabled: false });

// ---------------------------------------------------------------- изоляция песочницы
await attack('Песочница: обычный аккаунт входит в демо-комнату по коду', '403 DEMO_SANDBOX_ONLY', async () => {
  const r = await N.post('/api/rooms/join', { code: A.code });
  const r2 = await N.post(`/api/rooms/${A.id}/join`);
  return { ok: r.status === 403 && code(r) === 'DEMO_SANDBOX_ONLY' && code(r2) === 'DEMO_SANDBOX_ONLY', fact: `${r.status} ${code(r)} / по id: ${code(r2)}` };
});
await attack('Песочница: обычный аккаунт создаёт демо-комнату', '403 DEMO_SANDBOX_ONLY', async () => {
  const r = await N.post('/api/rooms', demoRoom('Хочу быстро'));
  return { ok: r.status === 403 && code(r) === 'DEMO_SANDBOX_ONLY', fact: `${r.status} ${code(r)}` };
});
await attack('Песочница: песочный аккаунт в обычной комнате (создать / войти)', '403 SANDBOX_DEMO_ONLY', async () => {
  const normalRoom = (await N.post('/api/rooms', { name: `Обычная-${tag}` })).body.room;
  const r1 = await H.post('/api/rooms', { name: 'Обычная' });
  const r2 = await H.post('/api/rooms/join', { code: normalRoom.code });
  await N.post(`/api/rooms/${normalRoom.id}/leave`);
  return { ok: code(r1) === 'SANDBOX_DEMO_ONLY' && code(r2) === 'SANDBOX_DEMO_ONLY', fact: `создать: ${code(r1)}, войти: ${code(r2)}` };
});
await attack('Песочница: превратить обычную комнату в демо настройками', '403 DEMO_SANDBOX_ONLY', async () => {
  const room = (await N.post('/api/rooms', { name: `Обычная2-${tag}` })).body.room;
  const r = await N.patch(`/api/rooms/${room.id}/settings`, { demo: true, focusSeconds: 5 });
  const after = (await N.get(`/api/rooms/${room.id}`)).body.room;
  await N.post(`/api/rooms/${room.id}/leave`);
  return { ok: code(r) === 'DEMO_SANDBOX_ONLY' && after.demo === false && after.settings.focusSec >= 600, fact: `${code(r)}, demo=${after.demo}, focusSec=${after.settings.focusSec}` };
});

// ---------------------------------------------------------------- несанкционированные действия
await attack('Без токена / с поддельным токеном', '401 UNAUTHORIZED', async () => {
  const r1 = await call('POST', pa('/start'));
  const r2 = await call('GET', '/api/users/me', undefined, 'x'.repeat(43));
  const r3 = await call('POST', pa('/start'), {}, H.token + 'x');
  return { ok: [r1, r2, r3].every((r) => r.status === 401), fact: [r1, r2, r3].map((r) => r.status).join(', ') };
});
await attack('Не-хост запускает цикл (подставив userId/hostId хоста)', '403 NOT_HOST', async () => {
  const r = await G1.post(pa('/start'), { userId: H.id, hostId: G1.id });
  const r2 = await G1.post(pa('/close'));
  return { ok: code(r) === 'NOT_HOST' && code(r2) === 'NOT_HOST', fact: `start: ${r.status} ${code(r)}, close: ${code(r2)}` };
});
await attack('Не-участник действует в чужой комнате (снимок, задача, abort, help, TD)', '403 NOT_A_MEMBER ×5', async () => {
  const rs = [
    await P.get(pa()),
    await P.post(pa('/task'), { title: 'x' }),
    await P.post(pa('/session/abort')),
    await P.post(pa('/social/help'), { targetUserId: H.id, type: 'boost' }),
    await P.post(pa('/td/build'), { slotId: 's1', type: 'arrow', requestId: reqId() }),
  ];
  return { ok: rs.every((r) => code(r) === 'NOT_A_MEMBER'), fact: [...new Set(rs.map(code))].join(', ') };
});
await attack('WS: запрещённые события и подписка на чужую комнату', 'UNKNOWN_EVENT ×2, NOT_A_MEMBER', async () => {
  const c = await connectWs(P);
  c.send({ type: 'give_me_coins', amount: 1000, reqId: 1 });
  c.send({ type: 'complete_session', reqId: 2 });
  c.send({ type: 'subscribe', roomId: A.id, reqId: 3 });
  const got = [];
  for (const n of [1, 2, 3]) got.push((await c.wait((m) => m.reqId === n)).data?.code);
  c.close();
  const coins = (await P.progress()).coins;
  return { ok: got[0] === 'UNKNOWN_EVENT' && got[1] === 'UNKNOWN_EVENT' && got[2] === 'NOT_A_MEMBER' && coins === 0, fact: `${got.join(', ')}; монет ${coins}` };
});

// ---------------------------------------------------------------- подмена клиентских данных
await attack('Подмена xp/coins/level при регистрации и в профиле', 'игнорируются: 0 XP, 0 монет, ур. 1', async () => {
  const reg = await call('POST', '/api/users', { name: `Хакер-${tag}`, sandbox: true, xp: 99999, coins: 99999, level: 50, id: H.id });
  const p = await G1.patch('/api/users/me', { xp: 99999, coins: 99999, level: 50, sandbox: false });
  const ok = reg.status === 201 && reg.body.user.id !== H.id && reg.body.user.xp === 0 && reg.body.user.coins === 0
    && p.body.xp === 0 && p.body.coins === 0 && p.body.level === 1 && p.body.sandbox === true;
  return { ok, fact: `рег.: xp=${reg.body.user.xp} coins=${reg.body.user.coins}; профиль: xp=${p.body.xp} coins=${p.body.coins} ур.=${p.body.level} sandbox=${p.body.sandbox}` };
});

// ---------------------------------------------------------------- фокус: длительность, мульти-сессия, досрочный выход
let startA;
await attack('Подмена длительности при старте (focusSec/endsAt/durationSec в теле)', `фокус ровно ${FOCUS} с из настроек комнаты`, async () => {
  startA = await H.post(pa('/start'), { focusSec: 1, endsAt: 0, durationSec: 9999, now: 0, userId: G1.id });
  const len = startA.body.room ? startA.body.room.phaseEndsAt - startA.body.room.phaseStartedAt : null;
  return { ok: startA.status === 200 && len === FOCUS * 1000, fact: `${startA.status}, длительность ${len} мс` };
});
await attack('Мульти-сессия: игрок, занятый в A, при старте B', 'пропущен busy_elsewhere', async () => {
  const s = await P.post(pb('/start'));
  const sk = s.body.start?.skipped ?? [];
  return { ok: s.status === 200 && sk.some((x) => x.userId === G3.id && x.reason === 'busy_elsewhere'), fact: JSON.stringify(sk.map((x) => x.reason)) };
});
await attack('Мульти-сессия: хост A запускает вторую комнату во время фокуса', '409 ALREADY_FOCUSING', async () => {
  const C = (await H.post('/api/rooms', demoRoom(`C-${tag}`))).body.room;
  const r = await H.post(`/api/rooms/${C.id}/start`);
  await H.post(`/api/rooms/${C.id}/leave`);
  return { ok: r.status === 409 && code(r) === 'ALREADY_FOCUSING', fact: `${r.status} ${code(r)}` };
});
await attack('Пакость во время фокуса', '409 WRONG_PHASE', async () => {
  const r = await H.post(pa('/social/prank'), { targetUserId: G1.id, type: 'fog' });
  return { ok: r.status === 409 && code(r) === 'WRONG_PHASE', fact: `${r.status} ${code(r)}` };
});
await attack('Покупка улучшения во время своей фокус-сессии', '409 FOCUS_ACTIVE', async () => {
  const r = await H.post('/api/users/me/upgrades/base_walls/purchase', {});
  return { ok: code(r) === 'FOCUS_ACTIVE', fact: `${r.status} ${code(r)}` };
});
await sleep(1000);
const abort = await G1.post(pa('/session/abort'));
const left = await G2.post(pa('/leave'));
await waitPhase(H, A.id, 'break', 30_000);
await waitPhase(P, B.id, 'break', 30_000);

await attack('Награда без завершённой сессии: досрочный выход (abort)', 'сессия aborted, 0 XP, 0 монет', async () => {
  const s = (await G1.get('/api/users/me/sessions')).body.sessions[0];
  const p = await G1.progress();
  return { ok: abort.status === 200 && s.status === 'aborted' && !s.rewarded && p.xp === 0 && p.coins === 0, fact: `${s.status}, rewarded=${s.rewarded}, xp=${p.xp}, монет ${p.coins}` };
});
await attack('Награда без завершённой сессии: уход из комнаты во время фокуса', 'aborted/left_room, 0 XP', async () => {
  const s = (await G2.get('/api/users/me/sessions')).body.sessions[0];
  const p = await G2.progress();
  return { ok: left.status === 200 && s.status === 'aborted' && s.endReason === 'left_room' && p.xp === 0, fact: `${s.status}/${s.endReason}, xp=${p.xp}` };
});
await attack('«Завершить» сессию с клиента (/complete, /session/complete, /reward, /claim)', '404 — таких маршрутов нет, XP не меняется', async () => {
  const st = [];
  for (const p of ['/complete', '/session/complete', '/reward', '/claim']) st.push((await G1.post(pa(p), { xp: 100 })).status);
  st.push((await G1.post('/api/users/me/reward', { xp: 100 })).status);
  const xp = (await G1.progress()).xp;
  return { ok: st.every((s) => s === 404) && xp === 0, fact: `${st.join(', ')}; xp=${xp}` };
});
await attack('Сверка: завершивший сессию получил награду', '≥ 100 XP у хоста и Гостя-3', async () => {
  const h = await H.progress();
  const g = await G3.progress();
  return { ok: h.xp >= 100 && g.xp >= 100, fact: `хост ${h.xp} XP, Гость-3 ${g.xp} XP` };
});
await attack('Повторный запрос результата сессии (+ xp/coins/rewarded в теле)', 'XP/монеты не меняются, 1 начисление', async () => {
  const before = await G3.progress();
  const st = [];
  for (let i = 0; i < 3; i++) st.push((await G3.post(pa('/session/result'), { result: 'done', xp: 1000, coins: 1000, rewarded: true })).status);
  const after = await G3.progress();
  const n = (await txOf(G3, 'focus_session')).length;
  return { ok: st.every((s) => s === 200) && after.xp === before.xp && after.coins === before.coins && n === 1, fact: `xp ${before.xp}→${after.xp}, монет ${before.coins}→${after.coins}, начислений ${n}` };
});
await attack('Пакость игроку с отключёнными пакостями', '409 PRANKS_DISABLED', async () => {
  const r = await H.post(pa('/social/prank'), { targetUserId: G3.id, type: 'fog' });
  return { ok: r.status === 409 && code(r) === 'PRANKS_DISABLED', fact: `${r.status} ${code(r)}` };
});

// ---------------------------------------------------------------- повторы и цены
await attack('Повтор requestId постройки башни (1 + повтор + 5 параллельно), cost:0 в теле', 'списано один раз 15 монет (цена каталога)', async () => {
  const c0 = (await H.progress()).coins;
  const id = reqId();
  const first = await H.post(pa('/td/build'), { slotId: 's1', type: 'arrow', requestId: id, cost: 0, price: 0 });
  const again = await H.post(pa('/td/build'), { slotId: 's1', type: 'arrow', requestId: id });
  const par = await Promise.all(Array.from({ length: 5 }, () => H.post(pa('/td/build'), { slotId: 's1', type: 'arrow', requestId: id })));
  const c1 = (await H.progress()).coins;
  const n = (await txOf(H, 'td_build')).length;
  const ok = first.status === 201 && first.body.cost === 15 && again.body.replayed === true && par.every((x) => x.body.replayed === true) && c1 === c0 - 15 && n === 1;
  return { ok, fact: `монет ${c0}→${c1}, списаний ${n}, повторы replayed=${again.body.replayed}` };
});
await attack('Повтор покупки улучшения (тот же expectedLevel), price:-1000 в теле', 'вторая — 409 STALE_LEVEL, цена 30 из каталога', async () => {
  const c0 = (await H.progress()).coins;
  const r1 = await H.post('/api/users/me/upgrades/base_walls/purchase', { expectedLevel: 0, price: -1000, cost: 0 });
  const r2 = await H.post('/api/users/me/upgrades/base_walls/purchase', { expectedLevel: 0 });
  const c1 = (await H.progress()).coins;
  const n = (await txOf(H, 'upgrade_purchase')).length;
  return { ok: r1.status === 200 && r1.body.cost === 30 && code(r2) === 'STALE_LEVEL' && n === 1 && c1 === c0 - 30 + 15, fact: `цена ${r1.body.cost}, повтор ${code(r2)}, монет ${c0}→${c1} (+15 за «Прокачку»), покупок ${n}` };
});
await attack('10 параллельных покупок при деньгах на одну', 'успешна 1, остальные INSUFFICIENT_FUNDS, баланс ≥ 0', async () => {
  const c0 = (await P.progress()).coins;
  const res = await Promise.all(Array.from({ length: 10 }, () => P.post('/api/users/me/upgrades/base_walls/purchase', {})));
  const okN = res.filter((r) => r.status === 200).length;
  const others = [...new Set(res.filter((r) => r.status !== 200).map(code))];
  const p = await P.progress();
  const n = (await txOf(P, 'upgrade_purchase')).length;
  const ok = c0 >= 30 && c0 < 90 && okN === 1 && others.every((c) => c === 'INSUFFICIENT_FUNDS') && p.coins >= 0 && n === 1;
  return { ok, fact: `было ${c0}, успешных ${okN}, отказы ${others.join('/')}, стало ${p.coins}, покупок ${n}` };
});

// ---------------------------------------------------------------- изоляция комнат
await attack('Изоляция комнат: прогресс, башни, задачи, соц-действия A не влияют на B', 'B: 1 очко, 0 башен, без задач и действий A', async () => {
  const ra = (await H.get(pa('/roadmap'))).body;
  const rb = (await P.get(pb('/roadmap'))).body;
  const tdB = (await P.get(pb('/td'))).body;
  const snapB = (await P.get(pb())).body;
  const socB = (await P.get(pb('/social'))).body.actions;
  const leak = snapB.members.some((m) => m.task === `Секретная задача ${tag}`);
  // и обратно: постройка в B не появляется в A
  await P.post(pb('/td/build'), { slotId: 's2', type: 'arrow', requestId: reqId() });
  const towersA = (await H.get(pa('/td'))).body.towers.map((t) => t.slot);
  const ok = ra.points === 2 && rb.points === 1 && tdB.towers.length === 0 && !leak && socB.length === 0 && towersA.join() === 's1';
  return { ok, fact: `очки A=${ra.points}, B=${rb.points}; башен в B ${tdB.towers.length}; задача A в B: ${leak ? 'да' : 'нет'}; действий в B ${socB.length}; башни A: ${towersA.join(',')}` };
});

clearInterval(beat);
for (const [u, room] of [[H, A], [G1, A], [G3, A], [G3, B], [P, B]]) await u.post(`/api/rooms/${room.id}/leave`).catch(() => {});

console.log();
printTable(['Атака', 'Ожидание', 'Факт', 'Итог'], rows);
const failed = rows.filter((r) => r[3] !== 'PASS').length;
console.log(`\n${failed ? `\x1b[31mFAIL: ${failed} из ${rows.length}\x1b[0m` : `\x1b[32mPASS: все ${rows.length} атак отражены\x1b[0m`}`);
process.exit(failed ? 1 : 0);
