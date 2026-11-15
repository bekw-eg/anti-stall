// @vitest-environment node
/**
 * Интеграционные тесты клиентского слоя против НАСТОЯЩЕГО backend (в памяти, управляемые часы):
 * проверяют, что контракт REST/WebSocket, на который опирается новый интерфейс, действительно работает.
 *
 * Изоляция: каждый тест получает СВОЙ backend и свои FakeClock (beforeEach). Раньше все тесты делили один сервер
 * и одни часы: долгий тест (6 циклов Team A/B) упирался в 5-секундный таймаут vitest, но его цикл `advance`
 * продолжал крутить общие часы в фоне — и соседние тесты видели «чужое» время (remainingMs 304000 вместо 900000,
 * фокус, закончившийся раньше времени, `until: timeout` в WebSocket-тесте). Долгим тестам заданы явные таймауты.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../../../backend/src/app.js";
import { FakeClock } from "../../../../backend/src/clock.js";
import { loadConfig } from "../../../../backend/src/config.js";
import { TomatoApiError, TomatoClient } from "./client";
import type { Roadmap, RoadmapNode, RoadmapTeam, RoomSnapshot, ServerEvent, TdEffect, TdEnemy, TdRound, TdShot, TdSpellCastEvent, TdStage, TdStateEvent, TdUnitSentEvent, TdView } from "./types";

interface BackendApp {
  listen(port: number, host: string): Promise<{ port: number }>;
  close(): Promise<void>;
  tick(): void;
  hub: { conns: Set<{ ws: { terminate(): void } }> };
}
interface Clock { advance(ms: number): number; now(): number }
let app: BackendApp;
let clock: Clock;
let base: string;
/** Поколение сервера: «осиротевший» после таймаута цикл advance останавливается, а не двигает чужие часы */
let generation = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | undefined | false, ms = 3000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v as T;
    if (Date.now() - t0 > ms) throw new Error("until: timeout");
    await sleep(15);
  }
}
/** Ожидает ошибку запроса и возвращает её. */
const fail = (p: Promise<unknown>) => p.then(() => { throw new Error("ожидалась ошибка"); }, (e: unknown) => e as TomatoApiError);
async function player(name: string) {
  const c = new TomatoClient({ baseUrl: base });
  await c.register(name);
  return c;
}
/** Двигает управляемые часы и тикает сервер; перечисленные клиенты «живы». */
async function advance(ms: number, alive: TomatoClient[]) {
  const gen = generation;
  for (let left = ms; left > 0; left -= 5000) {
    if (gen !== generation) throw new Error("advance: тест уже завершён (таймаут)");
    clock.advance(Math.min(5000, left));
    for (const c of alive) await c.request("POST", "/api/heartbeat", {});
    app.tick();
  }
}
let rid = 0;
const req = (tag: string) => `${tag}-${String(++rid).padStart(6, "0")}`;
const LONG = 30_000;

beforeEach(async () => {
  generation++;
  clock = new FakeClock();
  app = createApp({ config: loadConfig({}, { dbPath: ":memory:" }), clock });
  const addr = await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${addr.port}`;
});
afterEach(async () => {
  generation++;
  await app.close();
});

/** Ключи объекта, отсортированные — для сверки формы JSON сервера с типами клиента */
const keys = (o: object) => Object.keys(o).sort();
const ENEMY_KEYS: (keyof TdEnemy)[] = ["id", "type", "x", "y", "s", "hp", "maxHp", "speed", "slowed", "hasted", "armor", "isMerc"];
const SHOT_KEYS: (keyof TdShot)[] = ["id", "t", "slot", "towerType", "fromX", "fromY", "toX", "toY", "targetId", "damage", "splash", "slow"];
const EFFECT_KEYS: (keyof TdEffect)[] = ["id", "kind", "targetSlot", "expiresAtGameTime", "factor"];
const ROUND_KEYS: (keyof TdRound)[] = [
  "id", "team", "roundNo", "stageId", "status", "current", "startedAt", "endsAt", "finishedAt", "speed", "t", "wave", "waves",
  "spawned", "total", "hp", "hpMax", "kills", "leaked", "enemies", "shots", "effects", "result",
];
const VIEW_KEYS: (keyof TdView)[] = [
  "enabled", "phase", "mode", "team", "role", "defender", "breakEndsAt", "serverTime", "map", "towerTypes", "enemyTypes", "maxLevel", "stages", "defaultStageId",
  "base", "towers", "round", "rival", "duel", "me", "treasuryCoins", "mercenaries", "spells", "mercCooldownSec",
];
const ROADMAP_KEYS: (keyof Roadmap)[] = [
  "roadmapId", "title", "mode", "teamKey", "points", "goal", "focusPoints", "focusToNext", "treasuryCoins", "completed", "finished", "completedAt", "winner",
  "reward", "positionNodeId", "next", "segment", "teams", "nodes", "edges", "contributions",
];
const TEAM_KEYS: (keyof RoadmapTeam)[] = ["key", "name", "points", "positionNodeId", "finished", "completed", "focusPoints", "focusToNext", "treasuryCoins"];
const NODE_KEYS: (keyof RoadmapNode)[] = ["id", "title", "x", "y", "requiredPoints", "type", "status", "challenge", "reachedAt", "reward", "progress"];
const STAGE_KEYS: (keyof TdStage)[] = ["id", "title", "node", "nodeTitle", "unlocked", "reward", "waves", "enemies", "hpScale", "wins", "bestHpLeft"];
const sorted = (k: string[]) => [...k].sort();

describe("клиент ↔ backend: Road Map", () => {
  it("карта приходит с сервера; фокус пополняет казну, очки вклада и счёт к узлу (2 × участники), победа в TD открывает узел; node_reached доходит по WS", async () => {
    const lotti = await player("Карта-1");
    const anya = await player("Карта-2");
    const snap = await lotti.createRoom({ name: "Карта", focusMinutes: 25, breakMinutes: 5 });
    await anya.joinByCode(snap.room.code);
    const id = snap.room.id;

    const road0 = await lotti.roadmap(id);
    expect(sorted(keys(road0))).toEqual(sorted(ROADMAP_KEYS));
    expect(sorted(keys(road0.teams[0]))).toEqual(sorted(TEAM_KEYS));
    for (const n of road0.nodes) expect(sorted(keys(n))).toEqual(sorted(NODE_KEYS));
    expect(road0.positionNodeId).toBe("camp");
    expect([road0.points, road0.goal, road0.treasuryCoins, road0.focusPoints]).toEqual([0, 4, 30, 0]);
    expect(road0.next).toEqual({ nodeId: "forest", title: "Лес знаний", pointsNeeded: 1, stageId: "camp" });
    expect(road0.nodes.map((n) => n.challenge)).toEqual([
      null,
      { kind: "td_stage_win", stageId: "camp", required: 1 },
      { kind: "td_stage_win", stageId: "forest", required: 2 },
      { kind: "td_stage_win", stageId: "bridge", required: 3 },
    ]);
    expect(road0.edges).toHaveLength(3);
    expect(road0.teams).toHaveLength(1);

    const events: ServerEvent[] = [];
    const sock = anya.connect();
    sock.on("*", (e) => events.push(e));
    sock.subscribe(id);
    await until(() => events.some((e) => e.type === "room_state"));

    await lotti.startFocus(id);
    await advance(25 * 60_000 + 1000, [lotti, anya]); // обе сессии завершены
    const afterFocus = await lotti.roadmap(id);
    expect(afterFocus.positionNodeId).toBe("camp"); // один цикл двоих — 2 фокуса из 4 нужных: узел ещё закрыт
    expect(afterFocus.focusToNext).toEqual({ done: 2, need: 4 });
    expect([afterFocus.points, afterFocus.focusPoints, afterFocus.treasuryCoins]).toEqual([0, 2, 70]); // 30 + 2 × 20 монет в казну

    await lotti.tdBuild(id, "s1", "arrow", req("road-build"));
    await anya.tdBuild(id, "s3", "arrow", req("road-build"));
    await lotti.tdStart(id, "camp");
    await advance(70_000, [lotti, anya]);
    expect((await lotti.td(id)).round?.status).toBe("won");

    const [a, b] = await Promise.all([lotti.roadmap(id), anya.roadmap(id)]);
    expect(a).toEqual(b); // синхронизация между участниками
    expect(a.positionNodeId).toBe("forest");
    expect(a.points).toBe(1);
    expect(a.nodes.find((n) => n.id === "forest")?.reachedAt).toBeGreaterThan(0);
    expect(a.next).toEqual({ nodeId: "bridge", title: "Мост дедлайнов", pointsNeeded: 1, stageId: "forest" });
    expect(a.segment).toEqual({ from: "forest", to: "bridge", progress: 0 });

    const reached = await until(() => events.find((e) => e.type === "node_reached"));
    expect((reached.data as { nodeId: string }).nodeId).toBe("forest");
    expect((await lotti.progress()).xp).toBeGreaterThan(125); // 100 за сессию + награда раунда + 25 за этап (начислил сервер)
    expect((await lotti.room(id)).challenge.positionNodeId).toBe("forest"); // тот же снимок в room_state
    sock.close();
  }, LONG);
});

describe("клиент ↔ backend: Tower Defense", () => {
  it("игра закрыта вне перерыва; на перерыве: казна команды, идемпотентный повтор, заклинание и подкрепление, нехватка казны, раунд по серверному времени, реванш", async () => {
    const lotti = await player("ТД-1");
    const anya = await player("ТД-2");
    const snap = await lotti.createRoom({ name: "TD", focusMinutes: 25, breakMinutes: 5 });
    await anya.joinByCode(snap.room.code);
    const id = snap.room.id;

    // до перерыва: игра закрыта, действия отклоняются сервером
    expect((await lotti.td(id)).enabled).toBe(false);
    expect((await fail(lotti.tdBuild(id, "s1", "arrow", "req-before-break-1"))).code).toBe("WRONG_PHASE");

    await lotti.startFocus(id);
    expect((await lotti.td(id)).enabled).toBe(false); // во время Focus — тоже
    await advance(25 * 60_000 + 1000, [lotti, anya]);

    const view = await lotti.td(id);
    expect(sorted(keys(view))).toEqual(sorted(VIEW_KEYS));
    for (const st of view.stages) expect(sorted(keys(st))).toEqual(sorted(STAGE_KEYS));
    expect(view.enabled).toBe(true);
    expect(view.treasuryCoins).toBe(70); // стартовые 30 + монеты обеих фокус-сессий
    expect(view.stages.find((s) => s.id === "camp")?.unlocked).toBe(true);
    expect(view.stages.find((s) => s.id === "forest")?.unlocked).toBe(false); // узлы открывают только победы в TD
    expect(view.mercenaries.map((m) => [m.id, m.cost])).toEqual([["cherry", 2], ["ripe", 5], ["armored", 12], ["king", 25]]);
    expect(view.spells.map((s) => [s.id, s.target])).toEqual([["haste", "self"], ["repair", "self"], ["slow_towers", "rival"], ["disable_tower", "rival"], ["enrage_horde", "rival"]]);
    expect(view.rival).toBeNull();
    expect([view.role, view.defender]).toEqual([null, null]); // общий режим: ролей нет
    const personal = (await lotti.progress()).coins;

    const built = await lotti.tdBuild(id, "s1", "arrow", "req-build-s1-0001");
    expect([built.cost, built.treasuryCoins, built.level, built.type]).toEqual([15, 55, 1, "arrow"]);
    const replay = await lotti.tdBuild(id, "s1", "arrow", "req-build-s1-0001"); // повтор того же запроса
    expect(replay.replayed).toBe(true);
    expect((await lotti.td(id)).treasuryCoins).toBe(55); // повтор ничего не списал
    expect((await lotti.progress()).coins).toBe(personal); // башни оплачивает казна, а не личные монеты
    expect((await fail(anya.tdBuild(id, "s1", "cannon", "req-other-0002"))).code).toBe("SLOT_TAKEN");
    expect((await anya.tdBuild(id, "s3", "arrow", "req-build-s3-0003")).treasuryCoins).toBe(40);

    const started = await lotti.tdStart(id, "camp");
    expect(started.round?.status).toBe("running");
    expect(started.round?.roundNo).toBe(1);
    expect(started.round?.endsAt).toBe(started.breakEndsAt);
    await advance(5_000, [lotti, anya]);

    // заклинание на свою оборону и «Подкрепление волны» в общем режиме — из казны
    const haste = await anya.tdCastSpell(id, "haste", req("spell"));
    expect([haste.action, haste.spell, haste.cost, haste.target, haste.treasuryCoins]).toEqual(["spell", "haste", 10, "shared", 30]);
    const unit = await lotti.tdSendUnit(id, "cherry", req("unit"));
    expect([unit.action, unit.type, unit.cost, unit.target, unit.queued, unit.treasuryCoins]).toEqual(["send_unit", "cherry", 2, "shared", false, 28]);
    const noRival = await fail(lotti.tdCastSpell(id, "slow_towers", req("spell")));
    expect(noRival).toBeInstanceOf(TomatoApiError);
    expect([noRival.status, noRival.code]).toEqual([400, "NO_RIVAL"]);
    // казны не хватает: ошибка сервера приходит как TomatoApiError с деталями
    const broke = await fail(lotti.tdBuild(id, "s5", "cannon", req("broke")));
    expect(broke).toBeInstanceOf(TomatoApiError);
    expect([broke.status, broke.code]).toEqual([409, "INSUFFICIENT_TEAM_FUNDS"]);
    expect(broke.details).toEqual({ required: 30, treasuryCoins: 28 });

    // ловим момент, когда на поле есть враги и летят снаряды (игровое время идёт по серверным часам)
    let round = (await anya.td(id)).round!;
    for (let i = 0; i < 40 && !(round.enemies.length > 0 && round.shots.length > 0); i++) {
      await advance(1_000, [lotti, anya]);
      round = (await anya.td(id)).round!;
    }
    expect(round.status).toBe("running");
    expect(sorted(keys(round))).toEqual(sorted(ROUND_KEYS));
    expect(round.t).toBeGreaterThanOrEqual(5); // игровое время идёт по серверным часам (5 с после старта)
    expect(round.effects.map((e) => e.kind)).toContain("haste");
    for (const e of round.effects) expect(sorted(keys(e))).toEqual(sorted(EFFECT_KEYS));
    expect(round.enemies.length).toBeGreaterThan(0);
    for (const e of round.enemies) expect(sorted(keys(e))).toEqual(sorted(ENEMY_KEYS));
    expect(round.shots.length).toBeGreaterThan(0);
    for (const sh of round.shots) expect(sorted(keys(sh))).toEqual(sorted(SHOT_KEYS));

    await advance(70_000, [lotti, anya]);
    const done = await lotti.td(id);
    expect(done.round?.status).toBe("won");
    expect([done.round?.enemies, done.round?.shots, done.round?.effects]).toEqual([[], [], []]);
    expect(done.stages.find((s) => s.id === "forest")?.unlocked).toBe(true); // победа открыла следующий этап
    // клиент не может сам закрыть раунд или назначить результат
    expect((await fail(lotti.request("POST", `/api/rooms/${id}/td/finish`, { status: "won" }))).status).toBe(404);
    expect((await fail(lotti.tdStart(id, "forest"))).code).toBe("ROUND_EXISTS");
    // реванша в игре нет
    expect((await fail(lotti.request("POST", `/api/rooms/${id}/td/rematch`, {}))).status).toBe(404);
  }, LONG);

  it("WebSocket присылает состояние игры команды (с казной); после перерыва раунд закрыт сервером", async () => {
    const lotti = await player("ТД-3");
    const anya = await player("ТД-4");
    const snap = await lotti.createRoom({ name: "TD2", focusMinutes: 25, breakMinutes: 5 });
    await anya.joinByCode(snap.room.code);
    const id = snap.room.id;
    const events: ServerEvent[] = [];
    const sock = anya.connect();
    sock.on("*", (e) => events.push(e));
    sock.subscribe(id);
    await until(() => events.some((e) => e.type === "room_state"));
    await lotti.startFocus(id);
    await advance(25 * 60_000 + 1000, [lotti, anya]);
    await lotti.tdBuild(id, "s1", "arrow", "req-ws-build-0001");
    await lotti.tdStart(id, "camp");
    await advance(5_000, [lotti, anya]);
    const st = await until(() => events.find((e) => e.type === "td_state" && (e.data as TdStateEvent).round?.status === "running"));
    const data = st.data as TdStateEvent;
    expect(sorted(keys(data))).toEqual(["round", "team", "towers", "treasuryCoins"]);
    expect(data.team).toBe("shared");
    expect(data.treasuryCoins).toBe(55);
    await advance(6 * 60_000, [lotti, anya]); // перерыв закончился
    const end = await until(() => events.find((e) => e.type === "td_round_finished"));
    expect(["won", "lost", "expired"]).toContain((end.data as { status: string }).status);
    expect((await lotti.td(id)).enabled).toBe(false);
    sock.close();
  }, LONG);
});

describe("клиент ↔ backend: Team A/B", () => {
  it("режим команд: автобаланс, смена команды, раздельная карта и казна", async () => {
    const lotti = await player("Тим-1");
    const anya = await player("Тим-2");
    // Один запланированный цикл: после перерыва комната ждёт (иначе сервер сам стартует следующий фокус),
    // и смену команды «между циклами» можно проверить.
    const snap = await lotti.createRoom({ name: "A vs B", focusMinutes: 25, breakMinutes: 5, teamMode: true, cycles: 1 });
    expect(snap.room.mode).toBe("teams");
    const joined = await anya.joinByCode(snap.room.code);
    expect(joined.members.map((m) => m.team)).toEqual(["A", "B"]);
    expect(joined.me?.team).toBe("B");
    expect(joined.me?.allowedActions).toContain("set_team");
    const switched = await anya.setTeam(snap.room.id, "A");
    expect(switched.me?.team).toBe("A");
    await anya.setTeam(snap.room.id, "B");

    const id = snap.room.id;
    const mine = await lotti.roadmap(id);
    const theirs = await anya.roadmap(id);
    expect(mine.mode).toBe("teams");
    expect([mine.teamKey, theirs.teamKey]).toEqual(["A", "B"]);
    expect(mine.teams.map((t) => t.key)).toEqual(["A", "B"]);
    expect([mine.treasuryCoins, theirs.treasuryCoins]).toEqual([30, 30]); // у каждой команды своя казна

    await lotti.startFocus(id);
    await advance(25 * 60_000 + 1000, [lotti, anya]);
    const [a, b] = await Promise.all([lotti.roadmap(id), anya.roadmap(id)]);
    expect(a.teams).toEqual(b.teams); // одна и та же картина у всех
    expect(a.teams.map((t) => [t.key, t.points, t.positionNodeId])).toEqual([["A", 0, "camp"], ["B", 0, "camp"]]);
    expect([a.treasuryCoins, b.treasuryCoins]).toEqual([50, 50]); // монеты сессии ушли в казну своей команды
    expect(a.winner).toBeNull();

    await advance(5 * 60_000, [lotti, anya]); // перерыв закончился
    await lotti.setTeam(id, "B"); // между циклами (waiting) смена разрешена
    await lotti.setTeam(id, "A");
    await lotti.startFocus(id);
    expect((await fail(lotti.setTeam(id, "B"))).code).toBe("WRONG_PHASE"); // во время сессии — нет
  }, LONG);

  it("Tower Wars: защита строит, атака шлёт томатов и дебаффы на её поле; наёмник ждёт старта; чужая казна неприкосновенна; дуэль", async () => {
    const lotti = await player("Война-A");
    const anya = await player("Война-B");
    const snap = await lotti.createRoom({ name: "Tower Wars", focusMinutes: 25, breakMinutes: 5, teamMode: true });
    await anya.joinByCode(snap.room.code);
    const id = snap.room.id;
    const events: ServerEvent[] = [];
    const sock = lotti.connect(); // Лотти — команда A (защита): смотрит, что прилетает от атаки
    sock.on("*", (e) => events.push(e));
    sock.subscribe(id);
    await until(() => events.some((e) => e.type === "room_state"));

    await lotti.startFocus(id);
    await advance(25 * 60_000 + 1000, [lotti, anya]);
    const va = await lotti.td(id);
    const vb = await anya.td(id);
    expect([va.team, va.role, va.treasuryCoins, vb.team, vb.role, vb.treasuryCoins]).toEqual(["A", "defense", 50, "B", "attack", 50]);
    expect([va.defender, vb.defender]).toEqual(["A", "A"]);
    expect(va.rival).toEqual({ team: "B", towers: 0, towerList: [], treasuryCoins: 50, round: null });

    // роли проверяет сервер
    expect((await fail(anya.tdBuild(id, "s2", "arrow", req("war-build")))).code).toBe("WRONG_ROLE");
    expect((await fail(lotti.tdSendUnit(id, "cherry", req("war-unit")))).code).toBe("WRONG_ROLE");

    // раунд защиты ещё не начат: наёмник атаки ждёт старта
    const queued = await anya.tdSendUnit(id, "cherry", req("war-unit"));
    expect([queued.target, queued.queued, queued.treasuryCoins]).toEqual(["A", true, 48]);
    const sent = await until(() => events.find((e) => e.type === "td_unit_sent"));
    expect(sent.data as TdUnitSentEvent).toEqual({ team: "B", target: "A", type: "cherry", queued: true, by: vb.me.userId });

    expect((await lotti.tdBuild(id, "s1", "arrow", req("war-build"))).treasuryCoins).toBe(35);
    expect((await lotti.tdBuild(id, "s3", "arrow", req("war-build"))).treasuryCoins).toBe(20);
    expect((await anya.td(id)).treasuryCoins).toBe(48); // покупки A не трогают казну B
    expect((await anya.td(id)).rival?.towerList?.map((t) => t.slot)).toEqual(["s1", "s3"]); // атака видит башни защиты
    // дебафф, пока защита не в бою, — отказ без списания
    expect((await fail(anya.tdCastSpell(id, "slow_towers", req("war-spell")))).code).toBe("RIVAL_NOT_IN_BATTLE");

    await anya.tdStart(id, "camp"); // начать может и атака: раунд идёт на поле защиты
    expect((await fail(lotti.tdStart(id, "camp"))).code).toBe("ROUND_EXISTS");
    await advance(1_000, [lotti, anya]);
    const aRound = (await lotti.td(id)).round!;
    expect(aRound.enemies.some((e) => e.isMerc && e.type === "cherry")).toBe(true); // недоставленный наёмник вышел на поле A

    const ripe = await anya.tdSendUnit(id, "ripe", req("war-unit"));
    expect([ripe.target, ripe.queued, ripe.treasuryCoins]).toEqual(["A", false, 43]);
    const slow = await anya.tdCastSpell(id, "slow_towers", req("war-spell"));
    expect([slow.target, slow.treasuryCoins]).toEqual(["A", 33]);
    const spell = await until(() => events.find((e) => e.type === "td_spell_cast"));
    expect(spell.data as TdSpellCastEvent).toEqual({ team: "B", target: "A", spell: "slow_towers", targetSlot: null, by: vb.me.userId });
    // защита отвечает своими деньгами и не может заплатить больше, чем есть в казне
    const haste = await lotti.tdCastSpell(id, "haste", req("war-spell"));
    expect([haste.target, haste.treasuryCoins]).toEqual(["A", 10]);
    const broke = await fail(lotti.tdBuild(id, "s5", "cannon", req("war-build")));
    expect([broke.status, broke.code, broke.details]).toEqual([409, "INSUFFICIENT_TEAM_FUNDS", { required: 30, treasuryCoins: 10 }]);
    expect((await anya.td(id)).treasuryCoins).toBe(33);
    // td_state обеих команд пришли по WS вместе с казной
    await until(() => events.find((e) => e.type === "td_state" && (e.data as TdStateEvent).team === "B" && (e.data as TdStateEvent).treasuryCoins === 33));
    expect(events.some((e) => e.type === "td_state" && (e.data as TdStateEvent).team === "A" && (e.data as TdStateEvent).treasuryCoins === 10)).toBe(true);
    const aView = await lotti.td(id);
    expect(aView.round?.effects.map((e) => e.kind).sort()).toEqual(["haste", "slow_towers"]);
    expect((await anya.td(id)).rival?.round?.effects.map((e) => e.kind).sort()).toEqual(["haste", "slow_towers"]);

    await advance(70_000, [lotti, anya]);
    const [ra, rb] = await Promise.all([lotti.td(id), anya.td(id)]);
    const status = ra.round?.status;
    expect(["won", "lost"]).toContain(status);
    expect(rb.round).toBeNull(); // у атаки своего раунда нет
    expect(ra.duel).toEqual(rb.duel);
    expect([ra.duel?.winner, ra.duel?.roundNo]).toEqual([status === "won" ? "A" : "B", 1]);
    expect((await fail(anya.request("POST", `/api/rooms/${id}/td/rematch`, {}))).status).toBe(404); // реванша нет
    sock.close();
  }, LONG);
});

describe("клиент ↔ backend", () => {
  it("создание комнаты, вход по коду, одинаковое состояние у обоих", async () => {
    const lotti = await player("Лотти");
    const anya = await player("Аня");
    const created = await lotti.createRoom({ name: "Боталка", focusMinutes: 25, breakMinutes: 5 });
    expect(created.room.phase).toBe("waiting");
    expect(created.me?.isHost).toBe(true);
    const joined = await anya.joinByCode(created.room.code);
    expect(joined.members.map((m) => m.name).sort()).toEqual(["Аня", "Лотти"]);
    const a = await lotti.room(created.room.id);
    const b = await anya.room(created.room.id);
    expect(a.room.id).toBe(b.room.id);
    expect(a.me?.allowedActions).toContain("start_focus");
    expect(b.me?.allowedActions).not.toContain("start_focus");
  });

  it("общая сессия: время приходит с сервера, фазы и награды определяет сервер", async () => {
    const lotti = await player("Лотти2");
    const anya = await player("Аня2");
    const snap = await lotti.createRoom({ name: "Фокус", focusMinutes: 25, breakMinutes: 5 });
    await anya.joinByCode(snap.room.code);
    const id = snap.room.id;

    const started = await lotti.startFocus(id);
    expect(started.room.phase).toBe("focus");
    expect(started.room.phaseEndsAt! - started.room.phaseStartedAt).toBe(25 * 60_000);
    await advance(10 * 60_000, [lotti, anya]);
    const mid = await anya.room(id);
    expect(mid.room.remainingMs).toBe(15 * 60_000); // то, что рисует таймер: phaseEndsAt − serverTime
    expect(mid.room.serverTime).toBe(clock.now());

    // досрочный выход одного, второй доходит до конца
    await anya.abortSession(id);
    await advance(15 * 60_000 + 1000, [lotti, anya]);
    const end = await lotti.room(id);
    expect(end.room.phase).toBe("break");
    const [pl, pa] = await Promise.all([lotti.progress(), anya.progress()]);
    expect(pl.xp).toBe(100);
    expect(pa.xp).toBe(0);
    expect(end.challenge.focusPoints).toBe(1); // очко вклада — только за завершённую сессию
    expect(end.challenge.points).toBe(0); // карту двигают только победы в TD
    expect(end.challenge.treasuryCoins).toBe(50); // 30 стартовых + 20 за сессию Лотти
    expect(end.members.find((m) => m.name === "Аня2")?.status).toBe("aborted");
  });

  it("ошибки сервера приходят как TomatoApiError с кодом", async () => {
    const u = await player("Ошибки");
    const guest = await player("Гость");
    const s = await u.createRoom({ name: "x" });
    await guest.joinByCode(s.room.code);
    const e1 = await fail(guest.startFocus(s.room.id));
    expect(e1).toBeInstanceOf(TomatoApiError);
    expect(e1.code).toBe("NOT_HOST");
    const e2 = await fail(u.help(s.room.id, "someone", "boost"));
    expect(e2.code).toBe("WRONG_PHASE");
    const e3 = await fail(new TomatoClient({ baseUrl: base }).me());
    expect(e3.status).toBe(401);
  });

  it("WebSocket: подписка, события комнаты, личные события и восстановление после обрыва", async () => {
    const lotti = await player("WS-1");
    const anya = await player("WS-2");
    const snap = await lotti.createRoom({ name: "WS", focusMinutes: 25, breakMinutes: 5 });
    await anya.joinByCode(snap.room.code);
    const id = snap.room.id;

    const states: RoomSnapshot[] = [];
    const events: ServerEvent[] = [];
    const sock = lotti.connect();
    sock.on("room_state", (e) => states.push(e.data as RoomSnapshot));
    sock.on("*", (e) => events.push(e));
    sock.subscribe(id);
    await until(() => states.length > 0);
    expect(sock.clockOffset).toBeTypeOf("number");

    await lotti.startFocus(id);
    await until(() => states.some((s) => s.room.phase === "focus"));
    expect(events.some((e) => e.type === "timer_started")).toBe(true);

    // обрыв: сервер рвёт соединения → клиент сам переподключается и подписывается заново
    const before = states.length;
    for (const c of [...app.hub.conns]) c.ws.terminate();
    await until(() => events.some((e) => e.type === "disconnected"));
    await until(() => states.length > before, 6000);
    expect(states.at(-1)!.room.phase).toBe("focus"); // состояние восстановлено без потери сессии

    // конец фокуса: reward_granted приходит ровно один раз и не повторяется после реконнекта
    await advance(25 * 60_000 + 1000, [lotti, anya]);
    await until(() => states.at(-1)?.room.phase === "break", 4000);
    await until(() => events.filter((e) => e.type === "reward_granted").length >= 1);
    for (const c of [...app.hub.conns]) c.ws.terminate();
    await sleep(1800);
    expect(events.filter((e) => e.type === "reward_granted" && (e.data as { kind: string }).kind === "focus_session")).toHaveLength(1);
    expect((await lotti.progress()).xp).toBe(100); // только за сессию: карта от фокуса больше не двигается
    sock.close();
  }, LONG);

  it("WebSocket отклоняет клиентские «команды-награды»", async () => {
    const u = await player("Читер");
    const sock = u.connect();
    const errors: ServerEvent[] = [];
    sock.on("error", (e) => errors.push(e));
    await until(() => (sock as unknown as { ws?: { readyState: number } }).ws?.readyState === 1);
    (sock as unknown as { ws: { send(m: string): void } }).ws.send(JSON.stringify({ type: "give_me_coins", amount: 999999 }));
    await until(() => errors.length > 0);
    expect((errors[0].data as { code: string }).code).toBe("UNKNOWN_EVENT");
    expect((await u.progress()).coins).toBe(0);
    sock.close();
  });
});

describe("клиент ↔ backend: демо-песочница", () => {
  let demoApp: BackendApp;
  let demoBase: string;
  beforeAll(async () => {
    demoApp = createApp({ config: loadConfig({ TOMATO_DEMO: "1" }, { dbPath: ":memory:" }), clock: new FakeClock() });
    demoBase = `http://127.0.0.1:${(await demoApp.listen(0, "127.0.0.1")).port}`;
  });
  afterAll(() => demoApp.close());

  it("песочный аккаунт — только на демо-сервере и только в демо-комнатах; обычный аккаунт в демо-комнату не попадает", async () => {
    const sandbox = new TomatoClient({ baseUrl: demoBase });
    expect((await sandbox.health()).demoMode).toBe(true);
    const u = await sandbox.register("Песок", { sandbox: true });
    expect(u.sandbox).toBe(true);
    expect((await sandbox.me()).sandbox).toBe(true);
    expect((await fail(sandbox.createRoom({ name: "Обычная", focusMinutes: 25, breakMinutes: 5 }))).code).toBe("SANDBOX_DEMO_ONLY");
    const demo = await sandbox.createRoom({ name: "Демо", demo: true, focusSeconds: 25, breakSeconds: 15 });
    expect(demo.room.demo).toBe(true);

    const regular = new TomatoClient({ baseUrl: demoBase });
    expect((await regular.register("Обычный")).sandbox).toBe(false);
    expect((await fail(regular.joinByCode(demo.room.code))).code).toBe("DEMO_SANDBOX_ONLY");

    // обычный сервер: песочную регистрацию не даёт, а токен с демо-сервера там не действует (отдельная БД)
    const normal = new TomatoClient({ baseUrl: base });
    expect((await normal.health()).demoMode).toBe(false);
    expect((await fail(normal.register("Песок", { sandbox: true }))).code).toBe("DEMO_DISABLED");
    normal.setToken(sandbox.token);
    expect((await fail(normal.me())).status).toBe(401);
  });
});
