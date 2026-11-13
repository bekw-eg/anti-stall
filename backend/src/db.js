import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA_VERSION = 4;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
  prank_enabled INTEGER NOT NULL DEFAULT 1,
  -- песочный (демо) аккаунт: только демо-комнаты, без демо-режима сервера не авторизуется
  sandbox INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_upgrades (
  user_id TEXT NOT NULL REFERENCES users(id),
  upgrade_id TEXT NOT NULL,
  level INTEGER NOT NULL CHECK (level >= 0),
  PRIMARY KEY (user_id, upgrade_id)
);

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id TEXT NOT NULL REFERENCES users(id),
  achievement_id TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, achievement_id)
);

-- Журнал начислений/трат. UNIQUE(user_id, key) = идемпотентность: один ключ — одна операция.
CREATE TABLE IF NOT EXISTS reward_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  kind TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  coins INTEGER NOT NULL DEFAULT 0,
  meta TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, key)
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  host_id TEXT NOT NULL REFERENCES users(id),
  phase TEXT NOT NULL CHECK (phase IN ('waiting','focus','break','completed')),
  cycle_id TEXT,
  cycle_no INTEGER NOT NULL DEFAULT 0,
  focus_sec INTEGER NOT NULL,
  break_sec INTEGER NOT NULL,
  demo INTEGER NOT NULL DEFAULT 0,
  phase_started_at INTEGER NOT NULL,
  phase_ends_at INTEGER,
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);

CREATE TABLE IF NOT EXISTS room_members (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member',
  team_key TEXT NOT NULL DEFAULT 'shared',
  is_ready INTEGER NOT NULL DEFAULT 0,
  task_title TEXT,
  joined_at INTEGER NOT NULL,
  left_at INTEGER,
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS focus_sessions (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  cycle_id TEXT NOT NULL,
  cycle_no INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  task_title TEXT,
  started_at INTEGER NOT NULL,
  scheduled_end_at INTEGER NOT NULL,
  ended_at INTEGER,
  duration_sec INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','completed','aborted','abandoned')),
  end_reason TEXT,
  result TEXT,
  result_note TEXT,
  rewarded INTEGER NOT NULL DEFAULT 0,
  xp_awarded INTEGER NOT NULL DEFAULT 0,
  coins_awarded INTEGER NOT NULL DEFAULT 0,
  demo INTEGER NOT NULL DEFAULT 0,
  UNIQUE (room_id, cycle_id, user_id)
);
-- Атомарная защита от мульти-сессий: у пользователя не может быть двух активных сессий.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_session_per_user ON focus_sessions(user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS sessions_by_user ON focus_sessions(user_id, started_at);

-- team_key: 'shared' в MVP; 'A'/'B' зарезервированы под командные соревнования.
CREATE TABLE IF NOT EXISTS team_progress (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  team_key TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,
  PRIMARY KEY (room_id, team_key)
);
-- Пройденные этапы карты: фиксируются сервером при пересечении порога очков (PRIMARY KEY = один раз).
CREATE TABLE IF NOT EXISTS team_nodes (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  team_key TEXT NOT NULL,
  node_id TEXT NOT NULL,
  reached_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, team_key, node_id)
);
CREATE TABLE IF NOT EXISTS team_contributions (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  team_key TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  points INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (room_id, team_key, user_id)
);

-- Tower Defense. Башни команды живут между перерывами; раунд — на один перерыв.
CREATE TABLE IF NOT EXISTS td_towers (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  team_key TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  type TEXT NOT NULL,
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 3),
  owner_id TEXT NOT NULL REFERENCES users(id),
  built_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, team_key, slot_id)
);
CREATE TABLE IF NOT EXISTS td_rounds (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  team_key TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','won','lost','expired')),
  started_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  speed REAL NOT NULL,
  state TEXT NOT NULL,
  result TEXT,
  finished_at INTEGER,
  -- один раунд команды за перерыв: повторный старт невозможен
  UNIQUE (room_id, team_key, cycle_id)
);
-- Журнал действий в игре. UNIQUE(user_id, request_id) — идемпотентность: повтор запроса не списывает монеты дважды.
CREATE TABLE IF NOT EXISTS td_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  team_key TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('join','start','build','upgrade')),
  request_id TEXT,
  slot_id TEXT,
  cost INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, request_id)
);
CREATE INDEX IF NOT EXISTS td_actions_by_cycle ON td_actions(room_id, team_key, cycle_id);
-- Исход дуэли команд A/B за перерыв (если обе сыграли один этап)
CREATE TABLE IF NOT EXISTS td_duels (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  cycle_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  winner TEXT NOT NULL,
  scores TEXT NOT NULL,
  decided_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, cycle_id)
);

CREATE TABLE IF NOT EXISTS user_effects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('boost','shield')),
  source_user_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE TABLE IF NOT EXISTS social_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  cycle_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('help','prank')),
  type TEXT NOT NULL,
  sender_id TEXT NOT NULL REFERENCES users(id),
  target_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('applied','blocked')),
  cost_coins INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  effect_ends_at INTEGER
);
CREATE INDEX IF NOT EXISTS social_by_sender ON social_actions(sender_id, created_at);
`;

/**
 * Тонкая обёртка над node:sqlite. Все операции синхронны, поэтому внутри одного процесса
 * обработчики не перемежаются; транзакции и UNIQUE-индексы дополнительно защищают инварианты.
 * События (push в WebSocket) откладываются до COMMIT и отбрасываются при ROLLBACK.
 */
export class Db {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.sql = new DatabaseSync(path);
    this.sql.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
    this.depth = 0;
    this.pending = [];
    this.sink = null;
    this.stmts = new Map();
    this.migrate();
  }

  migrate() {
    // Только аддитивные миграции: существующие таблицы и данные не удаляются.
    this.sql.exec(SCHEMA);
    // v2: командный режим комнаты ('shared' — одна общая команда, 'teams' — Team A против Team B)
    const cols = this.sql.prepare('PRAGMA table_info(rooms)').all().map((c) => c.name);
    if (!cols.includes('mode')) this.sql.exec("ALTER TABLE rooms ADD COLUMN mode TEXT NOT NULL DEFAULT 'shared'");
    // v3: статус готовности участника комнаты (is_ready)
    const memberCols = this.sql.prepare('PRAGMA table_info(room_members)').all().map((c) => c.name);
    if (!memberCols.includes('is_ready')) this.sql.exec('ALTER TABLE room_members ADD COLUMN is_ready INTEGER NOT NULL DEFAULT 0');
    // v4: песочные аккаунты демо-режима (users.sandbox); все существующие пользователи — обычные
    const userCols = this.sql.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
    if (!userCols.includes('sandbox')) this.sql.exec('ALTER TABLE users ADD COLUMN sandbox INTEGER NOT NULL DEFAULT 0');
    this.sql.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('schema_version', ?)").run(String(SCHEMA_VERSION));
  }

  stmt(sql) {
    let s = this.stmts.get(sql);
    if (!s) this.stmts.set(sql, (s = this.sql.prepare(sql)));
    return s;
  }
  get(sql, ...p) { return this.stmt(sql).get(...p); }
  all(sql, ...p) { return this.stmt(sql).all(...p); }
  run(sql, ...p) { return this.stmt(sql).run(...p); }

  /** Событие для WebSocket: уходит после успешного COMMIT внешней транзакции. */
  emit(event) {
    if (this.depth > 0) this.pending.push(event);
    else this.sink?.([event]);
  }

  tx(fn) {
    const outer = this.depth === 0;
    const sp = `sp${this.depth}`;
    const mark = this.pending.length;
    this.sql.exec(outer ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
    this.depth++;
    try {
      const result = fn();
      this.depth--;
      if (outer) {
        this.sql.exec('COMMIT');
        const events = this.pending;
        this.pending = [];
        if (events.length) this.sink?.(events);
      } else {
        this.sql.exec(`RELEASE ${sp}`);
      }
      return result;
    } catch (err) {
      this.depth--;
      this.pending.length = outer ? 0 : mark;
      try {
        this.sql.exec(outer ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
      } catch { /* транзакция уже закрыта */ }
      throw err;
    }
  }

  close() {
    this.sql.close();
  }
}
