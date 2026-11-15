import { createApp } from './app.js';
import { checkEnv, loadConfig } from './config.js';

// Неверная конфигурация — сразу понятная ошибка и выход (контейнер не стартует, деплой это увидит по /api/health)
const envProblems = checkEnv(process.env);
if (envProblems.length) {
  const list = envProblems.map((p) => `  - ${p}`).join('\n');
  console.error(`[tomato] ✖ неверная конфигурация:\n${list}\nСм. docs/DEPLOY.md, раздел «Переменные окружения».`);
  process.exit(1);
}

// `node src/server.js --demo` = TOMATO_DEMO=1 (работает и в Windows cmd, и в PowerShell)
// Логи запросов в production включены; выключить — TOMATO_REQUEST_LOG=0
const config = loadConfig(process.env, { requestLog: process.env.TOMATO_REQUEST_LOG !== '0' }, process.argv.slice(2));
const app = createApp({ config });
app.startScheduler();
const addr = await app.listen();
console.log(`[tomato] backend: http://${addr.address === '0.0.0.0' ? 'localhost' : addr.address}:${addr.port}  (ws: /ws)`);
console.log(`[tomato] db: ${config.dbPath}`);
if (config.staticDir) console.log(`[tomato] static: ${config.staticDir}`);
if (config.demoMode) {
  console.log('[tomato] ⚠ ДЕМО-РЕЖИМ ВКЛЮЧЁН (TOMATO_DEMO=1 / --demo): ускоренные комнаты только для песочных аккаунтов. Не использовать в production.');
  console.log('[tomato] ⚠ Песочные аккаунты и их прогресс живут в этой БД и не авторизуются на сервере без демо-режима.');
}

// Корректная остановка: докер шлёт SIGTERM при обновлении — закрываем WS и БД, данные не теряются
let stopping = false;
const stop = async (code = 0) => {
  if (stopping) return;
  stopping = true;
  const force = setTimeout(() => process.exit(code || 1), 5000); // не повисли на закрытии — выходим всё равно
  force.unref();
  try { await app.close(); } catch (e) { console.error('[tomato] ошибка при остановке', e); }
  process.exit(code);
};
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
// Необработанная ошибка: состояние процесса неизвестно — пишем в лог и выходим, docker (restart: unless-stopped)
// поднимает процесс заново; таймеры комнат серверные и продолжаются с того же места (фазы догоняются из БД)
process.on('uncaughtException', (err) => { console.error('[tomato] ✖ uncaughtException — перезапуск', err); stop(1); });
process.on('unhandledRejection', (err) => { console.error('[tomato] ✖ unhandledRejection — перезапуск', err); stop(1); });
