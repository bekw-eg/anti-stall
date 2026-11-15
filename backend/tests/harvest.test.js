import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { makeRain, scoreTeam, createBots, stepBots, HV } from '../src/harvest/engine.js';
import { boot, lobby, runBreak, runFocus } from './helpers.js';

/** Доходим до перерыва после 2-го цикла — при чередовании там Harvest. */
async function toHarvestBreak(w, L) {
  await runFocus(w, L); // перерыв 1 — Tower Defense
  const s1 = (await L.host.get(L.path())).body;
  assert.equal(s1.room.phase, 'break');
  assert.equal(s1.room.breakGame, 'td');
  await runBreak(w, L); // следующий фокус стартует сам
  await runFocus(w, L); // перерыв 2 — Harvest
  const s2 = (await L.host.get(L.path())).body;
  assert.equal(s2.room.breakGame, 'harvest');
  return s2;
}
/** Ставит серверные часы на момент sec от старта раунда. */
const at = (w, round, sec) => w.clock.set(round.startedAt + Math.round(sec * 1000));
const kindsOf = async (u, kind) => (await u.get('/api/users/me/transactions?limit=200')).body.transactions.filter((t) => t.kind === kind);

describe('Harvest: движок', () => {
  test('дождь детерминирован и отсортирован по моменту пересечения края корзины', () => {
    const a = makeRain(1234, 60), b = makeRain(1234, 60), c = makeRain(1235, 60);
    assert.deepEqual(a.items, b.items);
    assert.notDeepEqual(a.items, c.items);
    assert.ok(a.items.length > 50);
    for (let i = 1; i < a.items.length; i++) assert.ok(a.items[i].crossT >= a.items[i - 1].crossT);
    assert.ok(a.items.every((it) => it.crossT <= 60 && it.groundT > it.crossT));
  });

  test('счёт: множитель за серию, гнилой −2 и сброс, пропуск сбрасывает серию только когда он окончательный', () => {
    const rain = makeRain(7, 60);
    const good = rain.items.filter((i) => i.kind === 'good').slice(0, 6);
    const caught = new Map(good.map((i) => [i.id, 'u1']));
    const s = scoreTeam({ ...rain, items: good }, caught, Infinity);
    assert.equal(s.score, 5 + 2, 'пять по 1, шестой — с множителем ×2');
    assert.equal(s.players.u1.pts, 6, 'личные очки — без множителя');
    const rotten = rain.items.find((i) => i.kind === 'rotten');
    const s2 = scoreTeam({ ...rain, items: [rotten] }, new Map([[rotten.id, 'u1']]), Infinity);
    assert.equal(s2.score, 0, 'счёт не уходит в минус');
    const missedEarly = scoreTeam({ ...rain, items: good }, new Map(), good[0].groundT - 0.01);
    assert.equal(missedEarly.missed, 0);
    assert.equal(scoreTeam({ ...rain, items: good }, new Map(), Infinity).missed, 6);
  });

  test('боты ловят сами, детерминированно; заморозка останавливает бота', () => {
    const rain = makeRain(99, 60);
    const run = (effects) => { const sim = createBots(99, 5); stepBots(sim, rain, 60, effects); return sim; };
    const a = run([]), b = run([]);
    assert.deepEqual([...a.caught], [...b.caught]);
    assert.ok(a.caught.size > 10, `боты поймали ${a.caught.size}`);
    const frozen = run(a.bots.map((x) => ({ target: x.id, kind: 'freeze', at: 0, until: 60 })));
    assert.ok(frozen.caught.size < a.caught.size, 'замороженные боты ловят меньше');
  });
});

describe('Harvest: чередование с Tower Defense и проверки сервера', () => {
  let w;
  // узлы карты здесь двигают только победы в игре (правило «N фокусов» проверяет roadmap.test.js)
  before(async () => { w = await boot({ config: { breakGames: 'alternate', economy: { focusesPerStagePerMember: 100 } } }); });
  after(() => w.close());

  test('Красные против Синих: поимки проверяет сервер, шутки тратят заряд, итог — опыт, карта, вещи образа', async () => {
    const L = await lobby(w, ['Лотти', 'Аня'], { teamMode: true });
    const [lotti, anya] = L.users;
    // перерыв 1 — TD, Harvest закрыт
    await runFocus(w, L);
    const h1 = (await lotti.get(L.path('/harvest'))).body;
    assert.equal(h1.enabled, false);
    assert.equal(h1.game, 'td');
    assert.equal(h1.nextGame, 'harvest');
    await runBreak(w, L);
    await runFocus(w, L);
    assert.equal((await lotti.get(L.path())).body.room.breakGame, 'harvest');
    // TD на этом перерыве закрыт
    assert.equal((await lotti.post(L.path('/td/join'))).body.error.code, 'WRONG_GAME');

    const v = (await lotti.get(L.path('/harvest'))).body;
    assert.equal(v.enabled, true);
    assert.equal(v.myTeam, 'A');
    const round = v.round;
    assert.ok(round && round.status === 'running');
    assert.deepEqual(round.teams, ['A', 'B']);
    assert.equal(round.botTeam, null, 'в обеих командах есть живые игроки — ботов нет');
    const rain = makeRain(round.seed, round.duration);
    const goods = rain.items.filter((i) => i.kind === 'good');
    const catchIt = (u, it, x = it.x) => u.post(L.path('/harvest/catch'), { itemId: it.id, x });

    // раньше времени нельзя
    const g1 = goods[0];
    at(w, round, g1.crossT - 1);
    assert.equal((await catchIt(lotti, g1)).body.error.code, 'TOO_EARLY');
    at(w, round, g1.crossT);
    assert.equal((await catchIt(lotti, g1, g1.x + (g1.x < HV.W / 2 ? 90 : -90))).body.error.code, 'MISSED', 'корзина не под помидором');
    const ok = await catchIt(lotti, g1);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.score, 1);
    assert.equal((await catchIt(lotti, g1)).body.error.code, 'ALREADY_CAUGHT');
    assert.equal((await catchIt(anya, g1)).status, 200, 'у Синих своё поле — тот же помидор можно поймать');
    assert.equal((await lotti.post(L.path('/harvest/catch'), { itemId: 99999, x: 500 })).body.error.code, 'UNKNOWN_ITEM');

    // заявка опоздала
    const g2 = goods.find((i) => i.crossT > g1.crossT + 0.5);
    at(w, round, g2.crossT + 3);
    assert.equal((await catchIt(lotti, g2)).body.error.code, 'TOO_LATE');

    // «телепорт» корзины: последняя позиция далеко, до помидора за это время не доехать
    const now = (w.clock.now() - round.startedAt) / 1000;
    const g3 = goods.find((i) => i.crossT > now + 1);
    at(w, round, g3.crossT - 0.1);
    w.app.services.harvest.move(lotti.id, L.room.id, g3.x > 500 ? 60 : 940);
    at(w, round, g3.crossT);
    assert.equal((await catchIt(lotti, g3)).body.error.code, 'TOO_FAST');

    // шутки: только по сопернику, тратят заряд; кто выключил шутки — не цель (кейс §5.5)
    assert.equal((await lotti.post(L.path('/harvest/prank'), { targetId: lotti.id, kind: 'freeze' })).body.error.code, 'INVALID_TARGET');
    await anya.patch('/api/users/me', { prankEnabled: false });
    assert.equal((await lotti.post(L.path('/harvest/prank'), { targetId: anya.id, kind: 'freeze' })).body.error.code, 'PRANKS_DISABLED');
    assert.equal((await anya.post(L.path('/harvest/prank'), { targetId: lotti.id, kind: 'freeze' })).body.error.code, 'PRANKS_DISABLED_SELF');
    await anya.patch('/api/users/me', { prankEnabled: true });
    const pr = await lotti.post(L.path('/harvest/prank'), { targetId: anya.id, kind: 'freeze' });
    assert.equal(pr.status, 201);
    assert.equal(pr.body.charges, 0);
    assert.equal((await lotti.post(L.path('/harvest/prank'), { targetId: anya.id, kind: 'splat' })).body.error.code, 'NO_CHARGES');
    // замороженная корзина стоит, сколько ни двигай
    const before = (await anya.get(L.path('/harvest'))).body.live.teams.find((t) => t.key === 'B').players[0].x;
    w.app.services.harvest.move(anya.id, L.room.id, before + 300);
    const afterX = (await anya.get(L.path('/harvest'))).body.live.teams.find((t) => t.key === 'B').players[0].x;
    assert.equal(afterX, before, 'замороженная корзина не сдвинулась');
    // кадры для WebSocket собираются по живым раундам
    const frames = w.app.services.harvest.frames();
    assert.equal(frames.length, 1);
    assert.equal(frames[0].roomId, L.room.id);

    // Лотти ловит ещё три помидора (до каждого успевает доехать) — Красные впереди
    let last = g3.crossT;
    for (const it of goods.filter((i) => i.crossT > g3.crossT + 1.3)) {
      if (it.crossT < last + 1.3) continue;
      at(w, round, it.crossT);
      const r = await catchIt(lotti, it);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      last = it.crossT;
      if ((await lotti.get(L.path('/harvest'))).body.live.teams[0].players[0].caught >= 4) break;
    }

    // конец раунда + время на запоздалые заявки → итог
    w.clock.set(round.endsAt + 3000);
    w.app.tick();
    const fin = (await lotti.get(L.path('/harvest'))).body.round;
    assert.equal(fin.status, 'finished');
    assert.equal(fin.result.winner, 'A');
    assert.ok(fin.result.teams.A.score > fin.result.teams.B.score);

    // опыт (без монет), победа двигает карту Красных, достижение и шляпа за победу
    const lx = await kindsOf(lotti, 'harvest_round');
    assert.equal(lx.length, 1);
    assert.ok(lx[0].xp >= 10 + 15);
    assert.equal(lx[0].coins, 0);
    assert.equal((await kindsOf(anya, 'harvest_round')).length, 1, 'проигравший участник тоже получает опыт');
    const road = (await lotti.get(L.path())).body.challenge.teams;
    assert.equal(road.find((t) => t.key === 'A').points, 1, 'победа в Harvest — шаг по карте');
    assert.equal(road.find((t) => t.key === 'B').points, 0);
    const ach = (await lotti.get('/api/users/me/achievements')).body.achievements.find((a) => a.id === 'harvest_win');
    assert.equal(ach.unlocked, true);
    assert.ok((await lotti.get('/api/users/me')).body.avatarUnlocked.items.includes('straw'));
    assert.equal((await lotti.patch('/api/users/me', { avatar: { skin: 'pink', head: 'straw' } })).status, 200);
    assert.equal((await anya.patch('/api/users/me', { avatar: { skin: 'pink', head: 'straw' } })).body.error.code, 'AVATAR_LOCKED');
  });

  test('Красные без людей играют ботами, и их победа двигает Красных по карте (наград никому)', async () => {
    const L = await lobby(w, ['Ира', 'Оля'], { teamMode: true });
    for (const u of L.users) assert.equal((await u.post(L.path('/team'), { team: 'B' })).status, 200);
    const [ira] = L.users;
    const pointsOf = async (k) => (await ira.get(L.path('/roadmap'))).body.teams.find((t) => t.key === k).points;
    await toHarvestBreak(w, L);
    const v = (await ira.get(L.path('/harvest'))).body;
    assert.equal(v.round.botTeam, 'A');
    const before = await pointsOf('A');
    w.clock.set(v.round.endsAt + 3000);
    w.app.tick();
    const fin = (await ira.get(L.path('/harvest'))).body.round;
    assert.equal(fin.result.winner, 'A', 'Синие ничего не ловили — победили боты-Красные');
    assert.equal(await pointsOf('A'), before + 1, 'победа ботов засчитана на карте');
    assert.equal(await pointsOf('B'), 0);
  });

  test('комната без команд играет против ботов-огородников; шутка по боту действует', async () => {
    const L = await lobby(w, ['Вера'], {});
    const [vera] = L.users;
    await toHarvestBreak(w, L);
    const v = (await vera.get(L.path('/harvest'))).body;
    assert.deepEqual(v.round.teams, ['shared', 'bots']);
    assert.equal(v.round.botTeam, 'bots');
    const bots = v.live.teams.find((t) => t.key === 'bots').players;
    assert.equal(bots.length, 1, 'ботов столько же, сколько живых игроков: 1 на 1');
    at(w, v.round, 5);
    const pr = await vera.post(L.path('/harvest/prank'), { targetId: bots[0].id, kind: 'freeze' });
    assert.equal(pr.status, 201, JSON.stringify(pr.body));
    assert.equal(pr.body.until - (pr.body.until - HV.FREEZE_SEC.bot), HV.FREEZE_SEC.bot);
    w.clock.set(v.round.endsAt + 3000);
    w.app.tick();
    const fin = (await vera.get(L.path('/harvest'))).body.round;
    assert.equal(fin.status, 'finished');
    assert.ok(fin.result.teams.bots.score > 0, 'боты ловили');
    assert.equal(fin.result.winner, 'bots', 'Вера ничего не ловила — победили боты');
    assert.equal((await kindsOf(vera, 'harvest_round')).length, 1, 'за участие (шутка) — опыт');
  });
});
