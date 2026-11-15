import { randomInt, randomUUID } from 'node:crypto';
import { E } from '../errors.js';
import { reqObject } from '../validate.js';
import { HV, KINDS, clampX, coversItem, createBots, makeRain, scoreTeam, stepBots } from '../harvest/engine.js';

const DAY = 86_400_000;

/**
 * Harvest («Урожай») — мини-игра чётных перерывов (Tower Defense — на нечётных, см. config.breakGames).
 *
 * Сервер — единственный источник истины, при этом не гоняет физику корзин:
 *  - «дождь» задаётся зерном раунда (makeRain): у каждого помидора заранее известны место и момент,
 *    когда он пересечёт край корзины (crossT). Клиенты рисуют тот же дождь из того же зерна;
 *  - игрок сообщает «поймал помидор N, корзина в точке x» (REST). Сервер проверяет окно времени вокруг crossT,
 *    что корзина накрывает помидор, что она не «телепортировалась» (скорость от последней известной позиции)
 *    и что игрок не заморожен. Помидор засчитывается команде один раз;
 *  - счёт, комбо и личные очки пересчитываются по журналу поимок (scoreTeam): подделать их нечем;
 *  - позиции корзин приходят по WebSocket (harvest_move) только для показа другим игрокам и для проверки скорости;
 *  - если у команды нет живых игроков (комната без команд или пустая команда), за неё играют детерминированные боты;
 *  - итог: опыт участникам (суточный потолок), победа двигает карту команды как победа в TD,
 *    статистика игрока открывает вещи образа (соломенная шляпа, бусы-черри).
 */
export function createHarvest(ctx, game) {
  const { db, clock, config } = ctx;
  const cfg = config.economy.harvest;
  let rooms = null;
  /** Живое состояние раунда в памяти: дождь, симуляция ботов, последние позиции корзин. Восстанавливается из БД. */
  const live = new Map();

  // ------------------------------------------------------------------ какая игра на перерыве
  /** Игра перерыва после цикла cycleNo: при 'alternate' — TD после нечётного, Harvest после чётного. */
  const gameOfCycle = (cycleNo) => (config.breakGames === 'alternate' ? ((cycleNo ?? 1) % 2 === 0 ? 'harvest' : 'td') : config.breakGames);
  const gameOf = (room) => gameOfCycle(room.cycle_no);

  // ------------------------------------------------------------------ команды
  const humansOf = (roomId, team) => db.all(
    `SELECT m.user_id id, u.name FROM room_members m JOIN users u ON u.id = m.user_id
     WHERE m.room_id = ? AND m.team_key = ? AND m.left_at IS NULL ORDER BY m.joined_at, m.rowid`, roomId, team,
  );
  const teamOfUser = (room, userId) => db.get('SELECT team_key FROM room_members WHERE room_id = ? AND user_id = ? AND left_at IS NULL', room.id, userId)?.team_key ?? null;
  const teamName = (key) => (key === 'A' ? 'Красные' : key === 'B' ? 'Синие' : key === 'bots' ? 'Огородники' : 'Команда');

  // ------------------------------------------------------------------ раунд
  const parse = (row) => ({ ...row, state: JSON.parse(row.state), result: row.result ? JSON.parse(row.result) : null });
  const roundOf = (room) => {
    if (!room.cycle_id) return null;
    const row = db.get('SELECT * FROM harvest_rounds WHERE room_id = ? AND cycle_id = ?', room.id, room.cycle_id);
    return row ? parse(row) : null;
  };
  const save = (round) => db.run('UPDATE harvest_rounds SET state = ? WHERE id = ?', JSON.stringify(round.state), round.id);
  const secOf = (round, ms) => (ms - round.started_at) / 1000;

  /** Создаёт раунд в начале Harvest-перерыва: отсчёт countdownSec, длительность — сколько позволяет перерыв. */
  function ensureRound(room, now) {
    if (room.phase !== 'break' || gameOf(room) !== 'harvest' || !room.cycle_id) return null;
    const existing = roundOf(room);
    if (existing) return existing;
    const startedAt = room.phase_started_at + cfg.countdownSec * 1000;
    const room_left = (room.phase_ends_at - startedAt) / 1000 - cfg.settleSec - cfg.resultsSec;
    const duration = Math.floor(Math.min(cfg.roundSec, room_left));
    if (duration < cfg.minRoundSec) return null; // перерыв слишком короткий — играть некогда
    const teams = room.mode === 'teams' ? ['A', 'B'] : ['shared', 'bots'];
    // Пустая команда в режиме Красные/Синие — за неё играют боты
    const botTeam = room.mode === 'teams' ? teams.find((k) => humansOf(room.id, k).length === 0) ?? null : 'bots';
    const humanCount = teams.filter((k) => k !== botTeam).reduce((n, k) => n + humansOf(room.id, k).length, 0);
    const state = {
      // ботов столько же, сколько живых игроков в команде соперника (1 на 1, 3 на 3…), не больше 5
      teams, botTeam, botCount: Math.max(1, Math.min(HV.BOT_COUNT, humanCount)),
      caught: Object.fromEntries(teams.map((k) => [k, {}])), effects: [], charges: {}, participants: [],
    };
    const row = {
      id: randomUUID(), room_id: room.id, cycle_id: room.cycle_id, seed: randomInt(1, 2 ** 31 - 1),
      started_at: startedAt, ends_at: startedAt + duration * 1000, duration, status: 'running', state: JSON.stringify(state),
    };
    const ins = db.run(
      'INSERT OR IGNORE INTO harvest_rounds(id, room_id, cycle_id, seed, started_at, ends_at, duration, status, state) VALUES (?,?,?,?,?,?,?,?,?)',
      row.id, row.room_id, row.cycle_id, row.seed, row.started_at, row.ends_at, row.duration, row.status, row.state,
    );
    if (ins.changes === 0) return roundOf(room);
    db.emit({ scope: 'room', roomId: room.id, type: 'harvest_started', data: { roundId: row.id, startedAt, endsAt: row.ends_at, duration } });
    return parse(row);
  }

  /** Живое состояние: дождь и боты (пересчитываются из зерна и журнала шуток — после рестарта тоже). */
  function liveOf(round) {
    let L = live.get(round.id);
    if (!L) {
      const rain = makeRain(round.seed, round.duration);
      const sim = round.state.botTeam ? createBots(round.seed, round.state.botCount) : null;
      L = { rain, sim, pos: new Map(), roomId: round.room_id };
      live.set(round.id, L);
    }
    return L;
  }

  /** Боты догоняют момент now; их шутки над живой командой записываются в журнал (один раз). */
  function stepBotsTo(round, room, now) {
    const L = liveOf(round);
    if (!L.sim) return false;
    const t = Math.min(round.duration, Math.max(0, secOf(round, now)));
    let changed = false;
    stepBots(L.sim, L.rain, t, round.state.effects, (p) => {
      if (round.state.effects.some((e) => e.from === p.from && e.at === p.at)) return; // уже применена до рестарта
      const humanTeam = round.state.teams.find((k) => k !== round.state.botTeam);
      const humans = humansOf(room.id, humanTeam);
      if (!humans.length) return;
      const scores = scoreTeam(L.rain, caughtMap(round, humanTeam), Infinity).players;
      const leader = [...humans].sort((a, b) => (scores[b.id]?.pts ?? 0) - (scores[a.id]?.pts ?? 0))[0];
      const target = p.pickLeader ? leader : humans[Math.floor(p.roll * humans.length)];
      if (activeEffect(round, target.id, p.kind, p.at)) return;
      const dur = p.kind === 'freeze' ? HV.FREEZE_SEC.human : HV.SPLAT_SEC.human;
      round.state.effects.push({ target: target.id, kind: p.kind, from: p.from, at: p.at, until: p.at + dur });
      const botName = L.sim.bots.find((b) => b.id === p.from)?.name ?? 'Огородник';
      db.emit({ scope: 'room', roomId: room.id, type: 'harvest_prank', data: { roundId: round.id, from: p.from, fromName: botName, to: target.id, toName: target.name, kind: p.kind, at: p.at, until: p.at + dur } });
      changed = true;
    });
    if (changed) save(round);
    return changed;
  }

  const caughtMap = (round, team) => {
    if (team === round.state.botTeam) return live.get(round.id)?.sim?.caught ?? new Map();
    return new Map(Object.entries(round.state.caught[team] ?? {}).map(([k, v]) => [Number(k), v]));
  };
  const activeEffect = (round, target, kind, t) => round.state.effects.find((e) => e.target === target && e.kind === kind && e.at <= t && t < e.until);
  const chargesOf = (round, userId) => round.state.charges[userId] ?? HV.START_CHARGES;
  const markParticipant = (round, userId) => { if (!round.state.participants.includes(userId)) round.state.participants.push(userId); };

  // ------------------------------------------------------------------ итог
  function finalize(round, room, at) {
    const L = liveOf(round);
    if (L.sim) stepBotsTo(round, room, round.ends_at);
    const teams = {};
    for (const k of round.state.teams) teams[k] = scoreTeam(L.rain, caughtMap(round, k), Infinity);
    const [a, b] = round.state.teams;
    const winner = teams[a].score === teams[b].score ? 'draw' : teams[a].score > teams[b].score ? a : b;
    const rewards = {};
    const r = cfg.reward;
    for (const team of round.state.teams) {
      if (team === round.state.botTeam) continue;
      const won = winner === team;
      for (const uid of round.state.participants) {
        if (teamOfUser(room, uid) !== team && !teams[team].players[uid]) continue;
        const p = teams[team].players[uid] ?? { pts: 0, caught: 0, golden: 0 };
        db.run('INSERT OR IGNORE INTO harvest_players(round_id, user_id, team_key, pts, caught, golden, won) VALUES (?,?,?,?,?,?,?)', round.id, uid, team, p.pts, p.caught, p.golden, won ? 1 : 0);
        const cap = room.demo ? cfg.demoDailyRewardedRounds : cfg.dailyRewardedRounds;
        const today = db.get("SELECT COUNT(*) c FROM reward_transactions WHERE user_id = ? AND kind = 'harvest_round' AND created_at > ?", uid, clock.now() - DAY).c;
        if (today >= cap) continue; // суточный потолок наград за игру
        const xp = r.base + Math.min(r.maxPointsXp, Math.max(0, p.pts) * r.perPoint) + (won ? r.win : 0);
        game.grant(uid, `harvest:${round.id}:${uid}`, 'harvest_round', { xp }, { roomId: room.id, team, won, pts: p.pts });
        rewards[uid] = { xp };
        game.checkAchievements(uid);
      }
    }
    const result = {
      winner,
      teams: Object.fromEntries(round.state.teams.map((k) => [k, { score: teams[k].score, bestCombo: teams[k].bestCombo, missed: teams[k].missed, players: teams[k].players }])),
      rewards,
    };
    const upd = db.run("UPDATE harvest_rounds SET status = 'finished', result = ?, finished_at = ?, state = ? WHERE id = ? AND status = 'running'", JSON.stringify(result), at, JSON.stringify(round.state), round.id);
    if (upd.changes === 0) return;
    // Победа живой команды двигает её по карте, как победа в этапе TD (иначе при чередовании игр до крепости не дойти)
    if (winner !== 'draw' && winner !== round.state.botTeam) {
      const participants = round.state.participants.filter((uid) => teamOfUser(room, uid) === winner);
      game.recordStageVictory(room, winner, game.currentStageOf(room.id, winner), participants);
    }
    db.emit({ scope: 'room', roomId: room.id, type: 'harvest_finished', data: { roundId: round.id, ...result } });
    live.delete(round.id);
  }

  /** Вызывается из rooms.advance (внутри транзакции) на перерыве: создаёт раунд, двигает ботов, подводит итог. */
  function tick(room, now) {
    const round = ensureRound(room, now);
    if (!round || round.status !== 'running') return;
    stepBotsTo(round, room, now);
    if (now >= round.ends_at + cfg.settleSec * 1000) finalize(round, room, now);
  }
  /** Перерыв закончился — незавершённый раунд подводится сразу (пропуски окончательны). */
  function closeRounds(room, at) {
    for (const row of db.all("SELECT * FROM harvest_rounds WHERE room_id = ? AND status = 'running'", room.id)) finalize(parse(row), room, at);
  }

  // ------------------------------------------------------------------ представление
  function dynamicView(round, now) {
    const L = liveOf(round);
    const t = secOf(round, now);
    const settled = round.status === 'running' ? t - cfg.settleSec : Infinity;
    const teams = round.state.teams.map((k) => {
      const caught = caughtMap(round, k);
      const s = scoreTeam(L.rain, caught, settled);
      const bots = k === round.state.botTeam;
      const players = bots
        ? (L.sim?.bots ?? []).map((b) => ({ id: b.id, name: b.name, bot: true, x: Math.round(b.x), ...(s.players[b.id] ?? { pts: 0, caught: 0, golden: 0, rotten: 0 }) }))
        : humansOf(round.room_id, k).map((h) => ({ id: h.id, name: h.name, bot: false, x: L.pos.get(h.id)?.x ?? null, ...(s.players[h.id] ?? { pts: 0, caught: 0, golden: 0, rotten: 0 }) }));
      return { key: k, name: teamName(k), bots, score: s.score, combo: s.combo, mult: s.mult, bestCombo: s.bestCombo, missed: s.missed, caught: [...caught.keys()], players };
    });
    const effects = round.state.effects.filter((e) => t < e.until).map((e) => ({ ...e, untilMs: round.started_at + e.until * 1000 }));
    return { roundId: round.id, t: Math.round(t * 1000) / 1000, serverTime: now, status: round.status, teams, effects, charges: round.state.charges };
  }

  function view(room, userId) {
    const now = clock.now();
    const enabled = room.phase === 'break' && gameOf(room) === 'harvest';
    const round = enabled ? roundOf(room) : null;
    const myTeam = teamOfUser(room, userId);
    const out = { enabled, game: gameOf(room), nextGame: gameOfCycle((room.cycle_no ?? 0) + 1), myTeam, serverTime: now, round: null };
    if (!round) return out;
    out.round = {
      id: round.id, seed: round.seed, startedAt: round.started_at, endsAt: round.ends_at, duration: round.duration, status: round.status,
      result: round.result, botTeam: round.state.botTeam, teams: round.state.teams,
    };
    out.charges = chargesOf(round, userId);
    out.live = dynamicView(round, now);
    return out;
  }

  // ------------------------------------------------------------------ действия
  function context(user, roomKey) {
    const found = rooms.findRoom(roomKey);
    rooms.advance(found.id);
    const room = rooms.findRoom(found.id);
    rooms.requireMember(room, user);
    return room;
  }
  function runningRound(room, user) {
    rooms.requirePhase(room, 'break');
    if (gameOf(room) !== 'harvest') throw E.conflict('WRONG_GAME', 'На этом перерыве — Tower Defense');
    if (db.get("SELECT 1 x FROM focus_sessions WHERE user_id = ? AND status = 'active'", user.id)) throw E.conflict('FOCUS_ACTIVE', 'Игра недоступна во время вашей фокус-сессии');
    const round = roundOf(room);
    if (!round || round.status !== 'running') throw E.conflict('HARVEST_NOT_RUNNING', 'Раунд Harvest не идёт');
    const team = teamOfUser(room, user.id);
    if (!team || team === round.state.botTeam || !round.state.teams.includes(team)) throw E.forbidden('NOT_IN_GAME', 'Вы не в команде этого раунда');
    return { round, team };
  }

  function get(user, roomKey) {
    const room = context(user, roomKey);
    return view(room, user.id);
  }

  /**
   * «Поймал»: помидор itemId, корзина в точке x. Принимается, только если:
   * заявка пришла в окне [crossT − earlySec; crossT + lateSec], корзина накрывает помидор, игрок не заморожен,
   * корзина не двигалась быстрее, чем позволяет управление, и помидор ещё не засчитан команде.
   */
  function catchItem(user, roomKey, body) {
    return db.tx(() => {
      const room = context(user, roomKey);
      const { round, team } = runningRound(room, user);
      const b = reqObject(body);
      const L = liveOf(round);
      const it = Number.isInteger(b.itemId) ? L.rain.byId.get(b.itemId) : undefined;
      if (!it) throw E.badRequest('UNKNOWN_ITEM', 'Такого помидора в этом раунде нет', { field: 'itemId' });
      if (typeof b.x !== 'number' || !Number.isFinite(b.x)) throw E.badRequest('INVALID_FIELD', 'x: число', { field: 'x' });
      const x = clampX(b.x);
      const t = secOf(round, clock.now());
      if (t < it.crossT - cfg.earlySec) throw E.conflict('TOO_EARLY', 'Помидор ещё не долетел до корзины');
      if (t > it.crossT + cfg.lateSec) throw E.conflict('TOO_LATE', 'Заявка опоздала');
      if (round.state.caught[team][it.id]) throw E.conflict('ALREADY_CAUGHT', 'Этот помидор уже пойман командой');
      if (!coversItem(it, x)) throw E.conflict('MISSED', 'Корзина не под помидором');
      const prev = L.pos.get(user.id);
      if (activeEffect(round, user.id, 'freeze', it.crossT) && (!prev || Math.abs(x - prev.x) > 24)) throw E.conflict('FROZEN', 'Корзина заморожена');
      if (prev && Math.abs(x - prev.x) > HV.PLAYER_SPEED * Math.max(0.05, Math.abs(it.crossT - prev.t)) + 80) throw E.conflict('TOO_FAST', 'Корзина не успела бы туда доехать');

      round.state.caught[team][it.id] = user.id;
      if (it.kind === 'golden') round.state.charges[user.id] = Math.min(HV.MAX_CHARGES, chargesOf(round, user.id) + 1);
      markParticipant(round, user.id);
      L.pos.set(user.id, { x, t: it.crossT });
      save(round);
      const s = scoreTeam(L.rain, caughtMap(round, team), t - cfg.settleSec);
      return { ok: true, itemId: it.id, kind: it.kind, team, score: s.score, combo: s.combo, mult: s.mult, charges: chargesOf(round, user.id) };
    });
  }

  /** Шутка над соперником: «Брызги» (помидоры на экране) или «Заморозка» (корзина стоит). Тратит заряд. */
  function prank(user, roomKey, body) {
    return db.tx(() => {
      const room = context(user, roomKey);
      const { round, team } = runningRound(room, user);
      const b = reqObject(body);
      if (b.kind !== 'freeze' && b.kind !== 'splat') throw E.badRequest('INVALID_FIELD', 'kind: freeze | splat', { field: 'kind' });
      const t = secOf(round, clock.now());
      if (t < 0 || t >= round.duration) throw E.conflict('HARVEST_NOT_RUNNING', 'Раунд ещё не начался или уже закончился');
      const rival = round.state.teams.find((k) => k !== team);
      const L = liveOf(round);
      const bots = rival === round.state.botTeam;
      if (bots) stepBotsTo(round, room, clock.now());
      const target = bots ? L.sim.bots.find((x) => x.id === b.targetId) : humansOf(room.id, rival).find((h) => h.id === b.targetId);
      if (!target) throw E.badRequest('INVALID_TARGET', 'Шутить можно только над командой соперника', { field: 'targetId' });
      if (chargesOf(round, user.id) <= 0) throw E.conflict('NO_CHARGES', 'Шуток не осталось — поймайте золотой помидор');
      if (activeEffect(round, target.id, b.kind, t)) throw E.conflict('ALREADY_APPLIED', 'Эта шутка на нём уже действует');
      const dur = b.kind === 'freeze' ? (bots ? HV.FREEZE_SEC.bot : HV.FREEZE_SEC.human) : (bots ? HV.SPLAT_SEC.bot : HV.SPLAT_SEC.human);
      const at = bots ? L.sim.t : Math.round(t * 1000) / 1000; // для ботов — с их текущего шага симуляции
      round.state.effects.push({ target: target.id, kind: b.kind, from: user.id, at, until: at + dur });
      round.state.charges[user.id] = chargesOf(round, user.id) - 1;
      markParticipant(round, user.id);
      save(round);
      db.emit({ scope: 'room', roomId: room.id, type: 'harvest_prank', data: { roundId: round.id, from: user.id, fromName: user.name, to: target.id, toName: target.name, kind: b.kind, at, until: at + dur } });
      return { ok: true, charges: round.state.charges[user.id], target: target.id, kind: b.kind, until: at + dur };
    });
  }

  /**
   * Позиция корзины по WebSocket: только для показа и для проверки скорости (не меняет счёт).
   * Слишком большой прыжок обрезается до допустимой скорости, замороженная корзина стоит.
   */
  function move(userId, roomId, rawX) {
    if (typeof rawX !== 'number' || !Number.isFinite(rawX)) return;
    const room = rooms.loadRoom(roomId);
    if (!room || room.phase !== 'break' || gameOf(room) !== 'harvest') return;
    const round = roundOf(room);
    if (!round || round.status !== 'running') return;
    const team = teamOfUser(room, userId);
    if (!team || team === round.state.botTeam) return;
    const L = liveOf(round);
    const t = secOf(round, clock.now());
    const prev = L.pos.get(userId);
    let x = clampX(rawX);
    if (prev) {
      if (activeEffect(round, userId, 'freeze', t)) x = prev.x;
      const max = HV.PLAYER_SPEED * Math.max(0.05, t - prev.t) + 40;
      x = Math.max(prev.x - max, Math.min(prev.x + max, x));
    }
    L.pos.set(userId, { x, t });
  }

  /**
   * Кадр для рассылки по WebSocket (раз в harvestFrameMs): корзины, счёт, пойманные помидоры, шутки.
   * Двигает ботов вне транзакции запроса; их шутки пишутся в БД отдельной транзакцией.
   */
  function frames() {
    const now = clock.now();
    const out = [];
    for (const [roundId, L] of live) {
      const row = db.get('SELECT * FROM harvest_rounds WHERE id = ?', roundId);
      if (!row || row.status !== 'running') { live.delete(roundId); continue; }
      const round = parse(row);
      const room = rooms.loadRoom(L.roomId);
      if (!room || room.phase !== 'break') continue;
      if (L.sim) db.tx(() => stepBotsTo(round, room, now));
      out.push({ roomId: L.roomId, data: dynamicView(round, now) });
    }
    return out;
  }

  /** Статистика игрока для достижений и вещей образа. */
  function playerStats(userId) {
    const r = db.get('SELECT COUNT(*) rounds, COALESCE(SUM(won),0) wins, COALESCE(SUM(golden),0) golden, COALESCE(SUM(caught),0) caught FROM harvest_players WHERE user_id = ?', userId);
    return { harvestRounds: r.rounds, harvestWins: r.wins, harvestGolden: r.golden, harvestCaught: r.caught };
  }

  return {
    setRooms: (r) => { rooms = r; }, gameOf, gameOfCycle, tick, closeRounds, get, catchItem, prank, move, frames, playerStats, KINDS,
  };
}
