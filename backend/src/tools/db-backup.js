/**
 * Бэкап SQLite-БД без остановки сервера (VACUUM INTO — согласованный снимок даже при работающем WAL).
 *   node src/tools/db-backup.js [путь к .db] [папка бэкапов] [сколько хранить]
 * По умолчанию: БД — из TOMATO_DB, папка — <папка БД>/backups, хранится 5 последних.
 * deploy.sh вызывает его перед каждым обновлением: `docker compose exec -T app node src/tools/db-backup.js`.
 * Восстановление — docs/DEPLOY.md, раздел «Бэкапы и откат».
 */
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { basename, dirname, join } from 'node:path';

const dbPath = process.argv[2] || process.env.TOMATO_DB;
if (!dbPath) { console.error('нужен путь к БД (аргумент или TOMATO_DB)'); process.exit(2); }
const dir = process.argv[3] || join(dirname(dbPath), 'backups');
const keep = Number(process.argv[4] || 5);
mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const name = `${basename(dbPath, '.db')}-${stamp}.db`;
const target = join(dir, name);
const db = new DatabaseSync(dbPath);
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();

// ротация: оставляем `keep` самых свежих снимков этой БД
const prefix = `${basename(dbPath, '.db')}-`;
const old = readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.db')).sort().reverse().slice(keep);
for (const f of old) rmSync(join(dir, f));
console.log(JSON.stringify({ ok: true, backup: target, sizeBytes: statSync(target).size, removed: old }));
