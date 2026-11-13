import { createApp } from './app.js';
import { loadConfig } from './config.js';

// `node src/server.js --demo` = TOMATO_DEMO=1 (работает и в Windows cmd, и в PowerShell)
const config = loadConfig(process.env, {}, process.argv.slice(2));
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

const stop = async () => { await app.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
