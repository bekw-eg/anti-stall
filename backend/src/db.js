import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA_VERSION = 5;

/** Стартовый капитал казны (= config.economy.treasuryStart); нужен миграции v5 для уже существующих команд. */
const DEFAULT_TREASURY_START = 30;

// ---- Таблицы, которые миграция v5 пересобирает: одно описание и для новых БД, и для пересборки старых.
// tableName — имя (с префиксом IF NOT EXISTS для SCHEMA или временное имя при пересборке).
const TD_ROUNDS_DDL = (tableName) => `CREATE TABLE ${tableName} (
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
  round_no INTEGER NOT NULL DEFAULT 1,
  UNIQUE (room_id, team_key, cycle_id, round_no)
)`;
const TD_ACTIONS_DDL = (tableName) => `CREATE TABLE ${tableName} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  team_key TEXT NOT NULL,
  cycle_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('join','start','build','upgrade','send_unit','buff','debuff','rematch')),
  request_id TEXT,
  slot_id TEXT,
  cost INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, request_id)
)`;
const TD_ACTIONS_INDEXES = 'CREATE INDEX IF NOT EXISTS td_actions_by_cycle ON td_actions(room_id, team_key, cycle_id);';
const TD_DUELS_DDL = (tableName) => `CREATE TABLE ${tableName} (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  cycle_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  winner TEXT NOT NULL,
  scores TEXT NOT NULL,
  decided_at INTEGER NOT NULL,
  round_no INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (room_id, cycle_id, round_no)
)`;

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
-- points — очки вклада (фокус-сессии); treasury_coins — общая казна команды для Tower Defense (не уходит в минус);
-- finished_at — команда победила финальный этап карты; completed_at — команда выиграла испытание (в 'teams' — первая).
CREATE TABLE IF NOT EXISTS team_progress (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  team_key TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,
  treasury_coins INTEGER NOT NULL DEFAULT 0 CHECK (treasury_coins >= 0),
  finished_at INTEGER,
  PRIMARY KEY (room_id, team_key)
);
-- Достигнутые узлы карты: фиксируются сервером при победе в этапе Tower Defense (PRIMARY KEY = один раз).
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

-- Tower Defense. Башни команды живут между перерывами; раунд — на один перерыв (round_no 1, реванш — round_no 2).
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
${TD_ROUNDS_DDL('IF NOT EXISTS td_rounds')};
-- Журнал действий в игре. UNIQUE(user_id, request_id) — идемпотентность: повтор запроса не списывает монеты дважды.
${TD_ACTIONS_DDL('IF NOT EXISTS td_actions')};
${TD_ACTIONS_INDEXES}
-- Исход дуэли команд A/B за перерыв (отдельно для каждого round_no)
${TD_DUELS_DDL('IF NOT EXISTS td_duels')};

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

-- Текстовый чат комнаты (в фокусе только чтение — проверяет сервис)
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  cycle_id TEXT,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_by_room ON chat_messages(room_id, id);
CREATE INDEX IF NOT EXISTS chat_by_user ON chat_messages(room_id, user_id, created_at);
`;

/**
 * Тонкая обёртка над node:sqlite. Все операции синхронны, поэтому внутри одного процесса
 * обработчики не перемежаются; транзакции и UNIQUE-индексы дополнительно защищают инварианты.
 * События (push в WebSocket) откладываются до COMMIT и отбрасываются при ROLLBACK.
 */
export class Db {
  /** options.treasuryStart — стартовый капитал, который миграция v5 выдаёт уже существующим командам. */
  constructor(path, { treasuryStart = DEFAULT_TREASURY_START } = {}) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.sql = new DatabaseSync(path);
    this.sql.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
    this.depth = 0;
    this.pending = [];
    this.sink = null;
    this.stmts = new Map();
    this.treasuryStart = treasuryStart;
    this.migrate();
  }

  /**
   * Миграции: только аддитивные, данные сохраняются. Всё выполняется в одной транзакции;
   * внешние ключи на время пересборки таблиц выключены (PRAGMA вне транзакции, иначе она игнорируется).
   * Повторный запуск ничего не меняет: каждый шаг сначала проверяет текущую форму таблицы.
   */
  migrate() {
    this.sql.exec('PRAGMA foreign_keys = OFF');
    try {
      this.sql.exec('BEGIN IMMEDIATE');
      try {
        this.migrateInTx();
        this.sql.exec('COMMIT');
      } catch (err) {
        try { this.sql.exec('ROLLBACK'); } catch { /* транзакция уже закрыта */ }
        throw err;
      }
    } finally {
      this.sql.exec('PRAGMA foreign_keys = ON');
    }
  }

  migrateInTx() {
    const columns = (table) => this.sql.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    const tableSql = (table) => this.sql.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)?.sql ?? '';
    // Новые БД сразу получают финальные формы таблиц; у старых CREATE IF NOT EXISTS ничего не трогает.
    this.sql.exec(SCHEMA);
    // v2: командный режим комнаты ('shared' — одна общая команда, 'teams' — Team A против Team B)
    if (!columns('rooms').includes('mode')) this.sql.exec("ALTER TABLE rooms ADD COLUMN mode TEXT NOT NULL DEFAULT 'shared'");
    // v5: число циклов комнаты (настройка «сколько фокусов»; карта — статичная ROADMAP из master)
    if (!columns('rooms').includes('cycles')) this.sql.exec('ALTER TABLE rooms ADD COLUMN cycles INTEGER NOT NULL DEFAULT 4');
    // v5: качество фокус-сессии (время «вне фокуса» и итоговая оценка)
    const sessCols = columns('focus_sessions');
    if (!sessCols.includes('away_ms')) this.sql.exec('ALTER TABLE focus_sessions ADD COLUMN away_ms INTEGER NOT NULL DEFAULT 0');
    if (!sessCols.includes('away_since')) this.sql.exec('ALTER TABLE focus_sessions ADD COLUMN away_since INTEGER');
    if (!sessCols.includes('away_kind')) this.sql.exec('ALTER TABLE focus_sessions ADD COLUMN away_kind TEXT');
    if (!sessCols.includes('quality')) this.sql.exec('ALTER TABLE focus_sessions ADD COLUMN quality REAL');
    // v3: статус готовности участника комнаты (is_ready)
    if (!columns('room_members').includes('is_ready')) this.sql.exec('ALTER TABLE room_members ADD COLUMN is_ready INTEGER NOT NULL DEFAULT 0');
    // v4: песочные аккаунты демо-режима (users.sandbox); все существующие пользователи — обычные
    if (!columns('users').includes('sandbox')) this.sql.exec('ALTER TABLE users ADD COLUMN sandbox INTEGER NOT NULL DEFAULT 0');

    // v5: казна команды; уже существующие команды получают стартовый капитал
    if (!columns('team_progress').includes('treasury_coins')) {
      this.sql.exec('ALTER TABLE team_progress ADD COLUMN treasury_coins INTEGER NOT NULL DEFAULT 0 CHECK (treasury_coins >= 0)');
      this.sql.prepare('UPDATE team_progress SET treasury_coins = ?').run(this.treasuryStart);
    }
    // v5: победа над финальным этапом карты (у команд, уже выигравших испытание, — время победы)
    if (!columns('team_progress').includes('finished_at')) {
      this.sql.exec('ALTER TABLE team_progress ADD COLUMN finished_at INTEGER');
      this.sql.exec('UPDATE team_progress SET finished_at = completed_at WHERE completed_at IS NOT NULL');
    }
    // v5: номер раунда (реванш) и уникальность (room, team, cycle, round_no)
    if (!columns('td_rounds').includes('round_no')) this.rebuildTable('td_rounds', TD_ROUNDS_DDL);
    // v5: новые виды действий Tower Wars
    if (!tableSql('td_actions').includes("'send_unit'")) this.rebuildTable('td_actions', TD_ACTIONS_DDL, TD_ACTIONS_INDEXES);
    // v5: дуэль считается отдельно для каждого раунда
    if (!columns('td_duels').includes('round_no')) this.rebuildTable('td_duels', TD_DUELS_DDL);

    this.sql.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('schema_version', ?)").run(String(SCHEMA_VERSION));
  }

  /**
   * Безопасная пересборка таблицы (CREATE new → INSERT SELECT → DROP → RENAME), только внутри транзакции миграции.
   * Переносятся общие колонки старой и новой формы; новые колонки получают значения по умолчанию.
   */
  rebuildTable(table, ddl, indexesSql = '') {
    const tmp = `${table}__v${SCHEMA_VERSION}`;
    this.sql.exec(`DROP TABLE IF EXISTS ${tmp}`);
    this.sql.exec(ddl(tmp));
    const newCols = this.sql.prepare(`PRAGMA table_info(${tmp})`).all().map((c) => c.name);
    const oldCols = new Set(this.sql.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    const common = newCols.filter((c) => oldCols.has(c)).join(', ');
    this.sql.exec(`INSERT INTO ${tmp} (${common}) SELECT ${common} FROM ${table}`);
    this.sql.exec(`DROP TABLE ${table}`);
    this.sql.exec(`ALTER TABLE ${tmp} RENAME TO ${table}`);
    if (indexesSql) this.sql.exec(indexesSql);
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
