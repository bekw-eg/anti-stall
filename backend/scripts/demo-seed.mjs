/**
 * Подготовка демо для жюри на живом демо-сервере:
 *   1) npm run start:demo
 *   2) npm run demo:seed [-- --api http://localhost:8787]
 * Создаёт 4 песочных аккаунта (Лотти, Аня, Борис, Вика) и демо-комнату «фокус 25 с / перерыв 15 с» с хостом Лотти,
 * остальные входят в неё. Токены, id и код комнаты пишутся в data/demo-seed.json (файл в .gitignore).
 * Каждый аккаунт получает логин и общий пароль: друзья и вход с другого устройства — только у зарегистрированных,
 * гость одноразовый. В интерфейсе: «Войти» → «Аккаунт» → логин из таблицы и пароль PASSWORD.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API, createPlayer, printTable, requireDemoServer } from './lib/client.mjs';

const OUT = fileURLToPath(new URL('../data/demo-seed.json', import.meta.url));
const FOCUS = 25;
const BREAK = 15;
const PASSWORD = 'antistall-demo';
const RUN = Math.random().toString(36).slice(2, 6); // логины уникальны при повторном запуске
const PLAYERS = [
  { name: 'Лотти', login: 'lotti', task: 'Математика: пределы' },
  { name: 'Аня', login: 'anya', task: 'Английский: эссе' },
  { name: 'Борис', login: 'boris', task: 'Физика: задачи' },
  { name: 'Вика', login: 'vika', task: 'История: конспект' },
];

await requireDemoServer();

const players = [];
for (const p of PLAYERS) {
  const api = await createPlayer(p.name, { sandbox: true });
  const login = `${p.login}-${RUN}`;
  const c = await api.post('/api/users/me/credentials', { login, password: PASSWORD });
  if (c.status !== 200) {
    console.error(`«${p.name}»: не удалось задать логин:`, c.status, JSON.stringify(c.body));
    process.exit(1);
  }
  players.push({ ...p, login, api });
}
const [host, ...guests] = players;

const created = await host.api.post('/api/rooms', { name: 'Демо: боталка к экзамену', demo: true, focusSeconds: FOCUS, breakSeconds: BREAK });
if (created.status !== 201) {
  console.error('Не удалось создать демо-комнату:', created.status, JSON.stringify(created.body));
  process.exit(1);
}
const room = created.body.room;
for (const g of guests) {
  const j = await g.api.post('/api/rooms/join', { code: room.code });
  if (j.status !== 200) {
    console.error(`«${g.name}» не вошёл в комнату:`, j.status, JSON.stringify(j.body));
    process.exit(1);
  }
}
for (const p of players) await p.api.post(`/api/rooms/${room.id}/task`, { title: p.task });

const seed = {
  api: API,
  createdAt: new Date().toISOString(),
  room: { id: room.id, code: room.code, name: room.name, focusSec: room.settings.focusSec, breakSec: room.settings.breakSec, hostId: host.api.id },
  password: PASSWORD,
  players: players.map((p) => ({ name: p.name, login: p.login, id: p.api.id, token: p.api.token, role: p === host ? 'host' : 'member', task: p.task, sandbox: true })),
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(seed, null, 2) + '\n');

console.log(`\nДемо-комната «${room.name}»: код \x1b[1m${room.code}\x1b[0m, фокус ${FOCUS} с, перерыв ${BREAK} с (сервер ${API})\n`);
printTable(['Игрок', 'Логин', 'Роль', 'id', 'Токен (Bearer)'], seed.players.map((p) => [p.name, p.login, p.role, p.id, p.token]));
console.log(`Пароль у всех: ${PASSWORD}`);
console.log(`\nСохранено: ${OUT}`);
console.log('Аккаунты песочные: работают только на демо-сервере и только в демо-комнатах.');
console.log(`Боты в эту комнату: npm run demo:bots -- --room ${room.code} --bots 2`);
console.log('Внимание: участники без присутствия (heartbeat) дольше 30 с при старте фокуса пропускаются как offline.');
