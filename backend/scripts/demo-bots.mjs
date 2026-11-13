/**
 * Песочные боты для показа «несколько игроков» с одного ноутбука (сервер — npm run start:demo):
 *   npm run demo:bots -- --room CODE [--bots 2] [--api http://localhost:8787]
 * Боты входят в демо-комнату по коду, ставят личные задачи, держат присутствие (WS heartbeat каждые 5 с,
 * как клиент), подписаны на комнату и печатают фазы. Команды (stdin):
 *   leave <бот>            — бот досрочно выходит из фокуса (session/abort, награды не будет)
 *   help <цель> [boost|shield]   — помощь игроку (через POST /social/help, только на перерыве)
 *   prank <цель> [fog|sticker]   — пакость игроку (через POST /social/prank, только на перерыве)
 *   status                 — состояние комнаты
 *   quit                   — боты выходят из комнаты, скрипт завершается
 * Цель — имя участника комнаты (бота или человека), регистр не важен.
 */
import { createInterface } from 'node:readline';
import { argValue, connectWs, createPlayer, fail, printTable, requireDemoServer } from './lib/client.mjs';

const CODE = argValue('--room');
const COUNT = Math.max(1, Math.min(8, Number(argValue('--bots', 2)) || 2));
if (!CODE) fail('Укажите код комнаты: npm run demo:bots -- --room CODE [--bots 2]');

const NAMES = ['Гриша', 'Даша', 'Женя', 'Зоя', 'Ира', 'Коля', 'Лёва', 'Мила'];
const TASKS = ['Химия: реакции', 'Литература: сочинение', 'Алгебра: матрицы', 'Биология: клетка', 'География: карты', 'Информатика: графы', 'Немецкий: слова', 'Право: конспект'];
const PHASES = { waiting: 'ожидание', focus: 'ФОКУС', break: 'перерыв', completed: 'закрыта' };
const ts = () => new Date().toLocaleTimeString('ru-RU');
const say = (who, text) => console.log(`${ts()} [${who}] ${text}`);

await requireDemoServer();

const bots = [];
let roomId = null;
let snapshot = null; // последний room_state — по нему ищем имена
const nameOf = (id) => snapshot?.members.find((m) => m.userId === id)?.name ?? id?.slice(0, 8);

for (let i = 0; i < COUNT; i++) {
  const name = `${NAMES[i]}-бот`;
  const p = await createPlayer(name, { sandbox: true });
  const j = await p.post('/api/rooms/join', { code: CODE });
  if (j.status !== 200) fail(`«${name}» не вошёл в комнату ${CODE}: ${j.status} ${j.body?.error?.code} — ${j.body?.error?.message}`);
  roomId = j.body.room.id;
  if (!j.body.room.demo) fail('Это не демо-комната');
  await p.post(`/api/rooms/${roomId}/task`, { title: TASKS[i] });
  const first = i === 0; // события комнаты печатает только первый бот, личные — каждый свои
  const conn = await connectWs(p, { onEvent: (m) => onEvent(p, m, first) });
  await conn.subscribe(roomId);
  bots.push({ ...p, conn });
  say(name, `в комнате ${CODE}, задача: «${TASKS[i]}»`);
}
console.log(`\nБотов: ${bots.length}. Команды: leave <бот> | help <цель> [boost|shield] | prank <цель> [fog|sticker] | status | quit\n`);

function onEvent(bot, m, first) {
  const d = m.data || {};
  if (m.type === 'room_state' && m.roomId === roomId) { snapshot = d; return; }
  if (m.type === 'session_completed') {
    say(bot.name, d.rewarded ? `сессия завершена: +${d.xp} XP, +${d.coins} монет` : `сессия без награды (${d.status}${d.reason ? ', ' + d.reason : ''}${d.capped ? ', потолок' : ''})`);
    return;
  }
  if (m.type === 'reward_granted' && d.kind !== 'focus_session') { say(bot.name, `награда ${d.kind}: +${d.xp} XP, +${d.coins} монет`); return; }
  if (m.type === 'error') { say(bot.name, `ошибка WS ${d.code}: ${d.message}`); return; }
  if (!first) return;
  switch (m.type) {
    case 'phase_changed':
      say('комната', `фаза: ${PHASES[d.from] ?? d.from} → ${PHASES[d.to] ?? d.to}${d.phaseEndsAt ? `, до конца ${Math.round((d.phaseEndsAt - m.ts) / 1000)} с` : ''}`);
      if (d.to === 'waiting') for (const b of bots) b.post(`/api/rooms/${roomId}/ready`, { ready: true }); // боты готовы к следующему циклу
      break;
    case 'timer_started': say('комната', `старт фокуса #${d.cycleNo}: участвуют ${d.participants.length}, пропущены ${d.skipped.length}`); break;
    case 'player_joined': say('комната', `вошёл ${d.user?.name}`); break;
    case 'player_left': say('комната', `вышел ${nameOf(d.userId)}`); break;
    case 'help_applied': say('комната', `помощь ${d.type}: ${nameOf(d.from)} → ${nameOf(d.to)}`); break;
    case 'prank_applied': say('комната', `пакость ${d.type}: ${nameOf(d.from)} → ${nameOf(d.to)}${d.blocked ? ' (заблокирована щитом)' : ''}`); break;
    case 'node_reached': say('комната', `команда дошла до «${d.title}»`); break;
    case 'challenge_completed': say('комната', 'командное испытание пройдено!'); break;
    default:
  }
}

const findBot = (name) => bots.find((b) => b.name.toLowerCase() === name.toLowerCase() || b.name.toLowerCase().startsWith(name.toLowerCase()));
async function findMember(name) {
  const snap = (await bots[0].get(`/api/rooms/${roomId}`)).body;
  snapshot = snap;
  const n = name.toLowerCase();
  return snap.members.find((m) => m.name.toLowerCase() === n) ?? snap.members.find((m) => m.name.toLowerCase().startsWith(n));
}
const errText = (r) => `${r.status} ${r.body?.error?.code}: ${r.body?.error?.message}`;

/** help/prank: пробуем ботов-отправителей по очереди (кулдауны и лимиты у каждого свои), затем другой тип эффекта. */
async function social(kind, targetName, type) {
  const target = await findMember(targetName);
  if (!target) return say('команда', `в комнате нет участника «${targetName}»`);
  const types = type ? [type] : kind === 'help' ? ['boost', 'shield'] : ['fog', 'sticker'];
  for (const sender of bots.filter((b) => b.id !== target.userId)) {
    for (const t of types) {
      const r = await sender.post(`/api/rooms/${roomId}/social/${kind}`, { targetUserId: target.userId, type: t });
      if (r.status === 201) return say(sender.name, `${kind} ${t} → ${target.name}${r.body.blocked ? ' (заблокировано щитом)' : ''}`);
      say(sender.name, `${kind} ${t} → ${target.name}: отказ ${errText(r)}`);
      if (['WRONG_PHASE', 'PRANKS_DISABLED', 'TARGET_FOCUSING'].includes(r.body?.error?.code)) return undefined; // другой бот/тип не поможет
    }
  }
  return undefined;
}

async function status() {
  const snap = (await bots[0].get(`/api/rooms/${roomId}`)).body;
  snapshot = snap;
  const r = snap.room;
  console.log(`\nКомната ${r.code} «${r.name}»: ${PHASES[r.phase] ?? r.phase}${r.remainingMs != null ? `, осталось ${Math.round(r.remainingMs / 1000)} с` : ''}, цикл #${r.cycleNo}, очки команды ${snap.challenge.points}/${snap.challenge.goal}`);
  printTable(['Игрок', 'Роль', 'Статус', 'Связь', 'Ур.', 'Задача'], snap.members.map((m) => [m.name, m.role, m.status, m.connection, m.level, m.task ?? '']));
  console.log();
}

let quitting = false;
async function quit() {
  if (quitting) return;
  quitting = true;
  for (const b of bots) {
    const r = await b.post(`/api/rooms/${roomId}/leave`);
    say(b.name, r.status === 200 ? 'вышел из комнаты' : `выход: ${errText(r)}`);
    b.conn.close();
  }
  process.exit(0);
}
process.on('SIGINT', quit);

// Команды выполняются строго по очереди (в т.ч. при вводе из файла/конвейера); EOF = quit после очереди
const rl = createInterface({ input: process.stdin });
let queue = Promise.resolve();
rl.on('line', (line) => { queue = queue.then(() => run(line)); });
rl.on('close', () => { queue.then(quit); });

async function run(line) {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  const arg = rest[0];
  try {
    if (!cmd) return;
    if (cmd === 'quit' || cmd === 'exit') return await quit();
    if (cmd === 'status') return await status();
    if (cmd === 'leave') {
      const b = arg && findBot(arg);
      if (!b) return say('команда', `нет бота «${arg ?? ''}». Боты: ${bots.map((x) => x.name).join(', ')}`);
      const r = await b.post(`/api/rooms/${roomId}/session/abort`);
      return say(b.name, r.status === 200 ? 'досрочно вышел из фокуса — награды за эту сессию не будет' : `досрочный выход: отказ ${errText(r)}`);
    }
    if (cmd === 'help' || cmd === 'prank') {
      if (!arg) return say('команда', `${cmd} <имя_цели>`);
      return await social(cmd, arg, rest[1]);
    }
    return say('команда', `неизвестная команда «${cmd}»`);
  } catch (e) {
    return say('команда', `ошибка: ${e.message}`);
  }
}
