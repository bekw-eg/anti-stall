import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = createApp({ config });
app.startScheduler();
const addr = await app.listen();
console.log(`[tomato] backend: http://${addr.address === '0.0.0.0' ? 'localhost' : addr.address}:${addr.port}  (ws: /ws)`);
console.log(`[tomato] db: ${config.dbPath}`);
if (config.demoMode) console.log('[tomato] ⚠ ДЕМО-РЕЖИМ ВКЛЮЧЁН (TOMATO_DEMO=1): доступны ускоренные комнаты. Не использовать в production.');

const stop = async () => { await app.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
