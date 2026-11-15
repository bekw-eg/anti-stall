/**
 * Проверка БД на исправность — только чтение, ничего не меняет.
 *   node src/tools/db-check.js <путь к .db>
 * На ВМ (в контейнере):
 *   cd ~/app && sudo docker compose exec -T app  node src/tools/db-check.js /data/tomato.db
 *   cd ~/app && sudo docker compose exec -T demo node src/tools/db-check.js /data/tomato-demo.db
 * Код выхода 0 — всё в порядке, 1 — найдены нарушения (годится для CI и алертов).
 */
import { DatabaseSync } from 'node:sqlite';

const path = process.argv[2];
if (!path) { console.error('нужен путь к БД'); process.exit(2); }
const db = new DatabaseSync(path, { readOnly: true });
const count = (q) => db.prepare(q).get().c;

const checks = {
  integrity: db.prepare('PRAGMA integrity_check').all().map((r) => r.integrity_check).join(',') === 'ok' ? 0 : 1,
  fk_violations: db.prepare('PRAGMA foreign_key_check').all().length,
  negative_balance: count('SELECT COUNT(*) c FROM users WHERE xp < 0 OR coins < 0'),
  // баланс игрока = сумма журнала начислений/трат (журнал — источник правды)
  xp_ledger_mismatch: count('SELECT COUNT(*) c FROM users u WHERE u.xp != (SELECT COALESCE(SUM(xp),0) FROM reward_transactions t WHERE t.user_id = u.id)'),
  coins_ledger_mismatch: count('SELECT COUNT(*) c FROM users u WHERE u.coins != (SELECT COALESCE(SUM(coins),0) FROM reward_transactions t WHERE t.user_id = u.id)'),
  duplicate_reward_keys: count('SELECT COUNT(*) c FROM (SELECT user_id, key FROM reward_transactions GROUP BY 1, 2 HAVING COUNT(*) > 1)'),
  two_active_sessions: count("SELECT COUNT(*) c FROM (SELECT user_id FROM focus_sessions WHERE status = 'active' GROUP BY 1 HAVING COUNT(*) > 1)"),
  rewarded_not_completed: count("SELECT COUNT(*) c FROM focus_sessions WHERE rewarded = 1 AND status != 'completed'"),
  active_session_outside_focus: count("SELECT COUNT(*) c FROM focus_sessions s JOIN rooms r ON r.id = s.room_id WHERE s.status = 'active' AND r.phase != 'focus'"),
};
const info = {
  schema_version: db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value ?? null,
  tables: count("SELECT COUNT(*) c FROM sqlite_master WHERE type = 'table'"),
  users: count('SELECT COUNT(*) c FROM users'),
  rooms: count('SELECT COUNT(*) c FROM rooms'),
  focus_sessions: count('SELECT COUNT(*) c FROM focus_sessions'),
};
const bad = Object.entries(checks).filter(([, v]) => v !== 0);
console.log(JSON.stringify({ ok: bad.length === 0, checks, info }, null, 2));
process.exit(bad.length ? 1 : 0);
