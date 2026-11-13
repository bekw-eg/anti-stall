import { randomInt, randomUUID } from 'node:crypto';
import { E } from '../errors.js';
import { optString, reqInt, reqObject, reqString } from '../validate.js';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Комнаты и Pomodoro-цикл. Состояние (фаза, метки времени, сессии) хранится в БД,
 * поэтому таймер не зависит ни от браузера, ни от перезапуска процесса.
 *
 * Фазы: waiting → focus → break → waiting …; host может закрыть комнату (completed).
 */
export function createRoomsService(ctx, game, users) {
  const { db, clock, config } = ctx;
  const L = config.limits;

  // ------------------------------------------------------------------ вспомогательное
  function findRoom(idOrCode) {
    const key = String(idOrCode ?? '');
    const room = db.get('SELECT * FROM rooms WHERE id = ?', key) ?? db.get('SELECT * FROM rooms WHERE code = ?', key.toUpperCase());
    if (!room) throw E.notFound('ROOM_NOT_FOUND', 'Комната не найдена');
    return room;
  }
  const loadRoom = (id) => db.get('SELECT * FROM rooms WHERE id = ?', id);
  const memberRow = (roomId, userId) => db.get('SELECT * FROM room_members WHERE room_id = ? AND user_id = ? AND left_at IS NULL', roomId, userId);

  function requireMember(room, user) {
    const m = memberRow(room.id, user.id);
    if (!m) throw E.forbidden('NOT_A_MEMBER', 'Вы не участник этой комнаты');
    return m;
  }
  function requireHost(room, user) {
    requireMember(room, user);
    if (room.host_id !== user.id) throw E.forbidden('NOT_HOST', 'Это действие доступно только создателю комнаты');
  }
  function requirePhase(room, ...phases) {
    if (!phases.includes(room.phase)) {
      throw E.conflict('WRONG_PHASE', `Действие недоступно в фазе «${room.phase}»`, { phase: room.phase, allowedPhases: phases });
    }
  }
  const activeSessionOf = (userId) => db.get("SELECT * FROM focus_sessions WHERE user_id = ? AND status = 'active'", userId);

  function parseSettings(body, existing) {
    const demo = existing ? Boolean(existing.demo) : body.demo === true;
    if (body.demo !== undefined && typeof body.demo !== 'boolean') throw E.badRequest('INVALID_FIELD', 'Поле demo должно быть boolean', { field: 'demo' });
    if (demo) {
      if (!config.demoMode) throw E.forbidden('DEMO_DISABLED', 'Демо-режим выключен на сервере');
      return {
        demo: 1,
        focusSec: reqInt(body.focusSeconds ?? existing?.focus_sec ?? 25, 'focusSeconds', { min: L.demoFocusSeconds[0], max: L.demoFocusSeconds[1] }),
        breakSec: reqInt(body.breakSeconds ?? existing?.break_sec ?? 15, 'breakSeconds', { min: L.demoBreakSeconds[0], max: L.demoBreakSeconds[1] }),
      };
    }
    const focusMin = body.focusMinutes ?? (existing ? existing.focus_sec / 60 : 25);
    const breakMin = body.breakMinutes ?? (existing ? existing.break_sec / 60 : 5);
    return {
      demo: 0,
      focusSec: reqInt(focusMin, 'focusMinutes', { min: L.focusMinutes[0], max: L.focusMinutes[1] }) * 60,
      breakSec: reqInt(breakMin, 'breakMinutes', { min: L.breakMinutes[0], max: L.breakMinutes[1] }) * 60,
    };
  }

  const stateEvent = (roomId) => ({ scope: 'room_state', roomId });

  // ------------------------------------------------------------------ создание / вход / выход
  function create(user, body) {
    const b = reqObject(body);
    const name = b.name === undefined ? `Комната ${user.name}` : reqString(b.name, 'name', { min: 1, max: L.roomNameMax });
    const s = parseSettings(b);
    if (b.teamMode !== undefined && typeof b.teamMode !== 'boolean') throw E.badRequest('INVALID_FIELD', 'Поле teamMode должно быть boolean', { field: 'teamMode' });
    const mode = b.teamMode === true ? 'teams' : 'shared';
    return db.tx(() => {
      const joined = db.get('SELECT COUNT(*) c FROM room_members m JOIN rooms r ON r.id = m.room_id WHERE m.user_id = ? AND m.left_at IS NULL AND r.phase != ?', user.id, 'completed').c;
      if (joined >= L.maxRoomsPerUser) throw E.conflict('TOO_MANY_ROOMS', 'Слишком много активных комнат');
      const id = randomUUID();
      let code;
      do {
        code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      } while (db.get('SELECT 1 x FROM rooms WHERE code = ?', code));
      const t = clock.now();
      db.run(
        `INSERT INTO rooms(id, code, name, host_id, phase, focus_sec, break_sec, demo, mode, phase_started_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        id, code, name, user.id, 'waiting', s.focusSec, s.breakSec, s.demo, mode, t, t,
      );
      db.run('INSERT INTO room_members(room_id, user_id, role, team_key, joined_at) VALUES (?,?,?,?,?)', id, user.id, 'host', mode === 'teams' ? 'A' : 'shared', t);
      for (const key of mode === 'teams' ? ['A', 'B'] : ['shared']) db.run('INSERT INTO team_progress(room_id, team_key) VALUES (?,?)', id, key);
      return snapshot(id, user.id);
    });
  }

  function join(user, idOrCode) {
    return db.tx(() => {
      const room = findRoom(idOrCode);
      if (room.phase === 'completed') throw E.conflict('ROOM_CLOSED', 'Комната закрыта');
      const existing = db.get('SELECT * FROM room_members WHERE room_id = ? AND user_id = ?', room.id, user.id);
      if (existing && !existing.left_at) return snapshot(room.id, user.id); // идемпотентно
      const count = db.get('SELECT COUNT(*) c FROM room_members WHERE room_id = ? AND left_at IS NULL', room.id).c;
      if (count >= L.maxMembers) throw E.conflict('ROOM_FULL', 'В комнате нет мест');
      const t = clock.now();
      // Командный режим: новичок попадает в команду с меньшим числом игроков (при равенстве — A); вернувшийся — в свою
      let team = 'shared';
      if (room.mode === 'teams') {
        const n = (k) => db.get("SELECT COUNT(*) c FROM room_members WHERE room_id = ? AND team_key = ? AND left_at IS NULL", room.id, k).c;
        team = existing && (existing.team_key === 'A' || existing.team_key === 'B') ? existing.team_key : n('A') <= n('B') ? 'A' : 'B';
      }
      if (existing) db.run('UPDATE room_members SET left_at = NULL, joined_at = ?, team_key = ? WHERE room_id = ? AND user_id = ?', t, team, room.id, user.id);
      else db.run('INSERT INTO room_members(room_id, user_id, team_key, joined_at) VALUES (?,?,?,?)', room.id, user.id, team, t);
      db.emit({ scope: 'room', roomId: room.id, type: 'player_joined', data: { user: users.publicUser(user) } });
      db.emit(stateEvent(room.id));
      return snapshot(room.id, user.id);
    });
  }

  function leave(user, idOrCode) {
    return db.tx(() => {
      const room = findRoom(idOrCode);
      requireMember(room, user);
      const sess = db.get("SELECT * FROM focus_sessions WHERE room_id = ? AND user_id = ? AND status = 'active'", room.id, user.id);
      if (sess) endSessionEarly(room, sess, 'aborted', 'left_room');
      db.run('UPDATE room_members SET left_at = ? WHERE room_id = ? AND user_id = ?', clock.now(), room.id, user.id);
      db.emit({ scope: 'room', roomId: room.id, type: 'player_left', data: { userId: user.id } });
      if (room.host_id === user.id) {
        const next = db.get('SELECT user_id FROM room_members WHERE room_id = ? AND left_at IS NULL ORDER BY joined_at, rowid LIMIT 1', room.id);
        if (next) {
          db.run('UPDATE rooms SET host_id = ? WHERE id = ?', next.user_id, room.id);
          db.run("UPDATE room_members SET role = CASE WHEN user_id = ? THEN 'host' ELSE 'member' END WHERE room_id = ?", next.user_id, room.id);
          db.emit({ scope: 'room', roomId: room.id, type: 'host_changed', data: { hostId: next.user_id } });
        } else {
          db.run("UPDATE rooms SET phase = 'completed', phase_ends_at = NULL, closed_at = ? WHERE id = ?", clock.now(), room.id);
        }
      }
      db.emit(stateEvent(room.id));
      return { left: true };
    });
  }

  function close(user, idOrCode) {
    return db.tx(() => {
      const room = findRoom(idOrCode);
      requireHost(room, user);
      requirePhase(room, 'waiting', 'break');
      db.run("UPDATE rooms SET phase = 'completed', phase_ends_at = NULL, closed_at = ? WHERE id = ?", clock.now(), room.id);
      db.emit({ scope: 'room', roomId: room.id, type: 'phase_changed', data: { from: room.phase, to: 'completed' } });
      db.emit(stateEvent(room.id));
      return snapshot(room.id, user.id);
    });
  }

  function updateSettings(user, idOrCode, body) {
    const b = reqObject(body);
    return db.tx(() => {
      const room = findRoom(idOrCode);
      requireHost(room, user);
      requirePhase(room, 'waiting');
      const s = parseSettings(b, room);
      db.run('UPDATE rooms SET focus_sec = ?, break_sec = ? WHERE id = ?', s.focusSec, s.breakSec, room.id);
      if (b.name !== undefined) db.run('UPDATE rooms SET name = ? WHERE id = ?', reqString(b.name, 'name', { min: 1, max: L.roomNameMax }), room.id);
      db.emit({ scope: 'room', roomId: room.id, type: 'settings_changed', data: { focusSec: s.focusSec, breakSec: s.breakSec } });
      db.emit(stateEvent(room.id));
      return snapshot(room.id, user.id);
    });
  }

  /** Смена команды (только в режиме Team A/B и только до старта цикла). */
  function setTeam(user, idOrCode, body) {
    const b = reqObject(body);
    if (b.team !== 'A' && b.team !== 'B') throw E.badRequest('INVALID_FIELD', 'team: A | B', { field: 'team' });
    return db.tx(() => {
      const room = findRoom(idOrCode);
      requireMember(room, user);
      if (room.mode !== 'teams') throw E.conflict('NOT_TEAM_MODE', 'Комната не в командном режиме');
      requirePhase(room, 'waiting');
      db.run('UPDATE room_members SET team_key = ? WHERE room_id = ? AND user_id = ?', b.team, room.id, user.id);
      db.emit({ scope: 'room', roomId: room.id, type: 'team_changed', data: { userId: user.id, team: b.team } });
      db.emit(stateEvent(room.id));
      return snapshot(room.id, user.id);
    });
  }

  // ------------------------------------------------------------------ задачи и результат
  function setTask(user, idOrCode, body) {
    const b = reqObject(body);
    const title = optString(b.title, 'title', { max: L.taskMax }) || null;
    return db.tx(() => {
      const room = findRoom(idOrCode);
      requireMember(room, user);
      if (db.get("SELECT 1 x FROM focus_sessions WHERE room_id = ? AND user_id = ? AND status = 'active'", room.id, user.id)) {
        throw E.conflict('SESSION_ACTIVE', 'Задачу нельзя менять во время вашей фокус-сессии');
      }
      db.run('UPDATE room_members SET task_title = ? WHERE room_id = ? AND user_id = ?', title, room.id, user.id);
      db.emit({ scope: 'room', roomId: room.id, type: 'task_updated', data: { userId: user.id, task: title } });
      db.emit(stateEvent(room.id));
      return { task: title };
    });
  }

  /** Отметка результата после сессии: только для истории, на награду не влияет. */
  function recordResult(user, idOrCode, body) {
    const b = reqObject(body);
    if (!['done', 'partial', 'not_done'].includes(b.result)) throw E.badRequest('INVALID_FIELD', 'result: done | partial | not_done', { field: 'result' });
    const note = optString(b.note, 'note', { max: 200 }) || null;
    return db.tx(() => {
      const room = findRoom(idOrCode);
      requireMember(room, user);
      const sess = b.sessionId
        ? db.get('SELECT * FROM focus_sessions WHERE id = ? AND user_id = ? AND room_id = ?', String(b.sessionId), user.id, room.id)
        : db.get("SELECT * FROM focus_sessions WHERE room_id = ? AND user_id = ? AND status != 'active' ORDER BY started_at DESC, rowid DESC LIMIT 1", room.id, user.id);
      if (!sess) throw E.notFound('SESSION_NOT_FOUND', 'Завершённая сессия не найдена');
      if (sess.status === 'active') throw E.conflict('SESSION_ACTIVE', 'Сессия ещё идёт');
      db.run('UPDATE focus_sessions SET result = ?, result_note = ? WHERE id = ?', b.result, note, sess.id);
      return { sessionId: sess.id, result: b.result, note };
    });
  }

  // ------------------------------------------------------------------ управление фазами
  function startFocus(user, idOrCode) {
    return db.tx(() => {
      advanceInTx(findRoom(idOrCode).id); // догоняем таймеры, если тик ещё не сработал
      const room = findRoom(idOrCode);
      requireHost(room, user);
      requirePhase(room, 'waiting');
      if (activeSessionOf(user.id)) throw E.conflict('ALREADY_FOCUSING', 'У вас уже идёт фокус-сессия в другой комнате');

      const t = clock.now();
      const cycleId = randomUUID();
      const cycleNo = room.cycle_no + 1;
      const endsAt = t + room.focus_sec * 1000;
      const members = db.all(
        `SELECT m.user_id, m.task_title, u.last_seen_at FROM room_members m JOIN users u ON u.id = m.user_id
         WHERE m.room_id = ? AND m.left_at IS NULL ORDER BY m.joined_at, m.rowid`, room.id,
      );
      db.run("UPDATE rooms SET phase = 'focus', cycle_id = ?, cycle_no = ?, phase_started_at = ?, phase_ends_at = ? WHERE id = ?", cycleId, cycleNo, t, endsAt, room.id);

      const participants = [];
      const skipped = [];
      for (const m of members) {
        if (m.user_id !== user.id && t - m.last_seen_at > config.graceMs) { skipped.push({ userId: m.user_id, reason: 'offline' }); continue; }
        if (activeSessionOf(m.user_id)) { skipped.push({ userId: m.user_id, reason: 'busy_elsewhere' }); continue; }
        const id = randomUUID();
        db.run(
          `INSERT INTO focus_sessions(id, room_id, cycle_id, cycle_no, user_id, task_title, started_at, scheduled_end_at, duration_sec, status, demo)
           VALUES (?,?,?,?,?,?,?,?,?,'active',?)`,
          id, room.id, cycleId, cycleNo, m.user_id, m.task_title, t, endsAt, room.focus_sec, room.demo,
        );
        participants.push(m.user_id);
      }
      db.emit({ scope: 'room', roomId: room.id, type: 'timer_started', data: { cycleId, cycleNo, phase: 'focus', phaseStartedAt: t, phaseEndsAt: endsAt, serverTime: t, participants, skipped } });
      db.emit({ scope: 'room', roomId: room.id, type: 'phase_changed', data: { from: 'waiting', to: 'focus', cycleId, phaseStartedAt: t, phaseEndsAt: endsAt } });
      db.emit(stateEvent(room.id));
      return { ...snapshot(room.id, user.id), start: { participants, skipped } };
    });
  }

  function endSessionEarly(room, sess, status, reason) {
    db.run("UPDATE focus_sessions SET status = ?, end_reason = ?, ended_at = ? WHERE id = ? AND status = 'active'", status, reason, clock.now(), sess.id);
    db.emit({ scope: 'user', userId: sess.user_id, type: 'session_completed', data: { sessionId: sess.id, roomId: room.id, status, rewarded: false, xp: 0, coins: 0, reason } });
    db.emit({ scope: 'room', roomId: room.id, type: 'player_status_changed', data: { userId: sess.user_id, status, reason } });
  }

  /** Досрочное завершение СВОЕЙ сессии. Остальные участники продолжают, награды нет. */
  function abortSession(user, idOrCode) {
    return db.tx(() => {
      advanceInTx(findRoom(idOrCode).id);
      const room = findRoom(idOrCode);
      requireMember(room, user);
      requirePhase(room, 'focus');
      const sess = db.get("SELECT * FROM focus_sessions WHERE room_id = ? AND cycle_id = ? AND user_id = ? AND status = 'active'", room.id, room.cycle_id, user.id);
      if (!sess) throw E.notFound('NO_ACTIVE_SESSION', 'У вас нет активной сессии в этой комнате');
      endSessionEarly(room, sess, 'aborted', 'user_abort');
      db.emit(stateEvent(room.id));
      return { sessionId: sess.id, status: 'aborted', rewarded: false };
    });
  }

  function skipBreak(user, idOrCode) {
    return db.tx(() => {
      advanceInTx(findRoom(idOrCode).id);
      const room = findRoom(idOrCode);
      requireHost(room, user);
      requirePhase(room, 'break');
      toWaiting(room, clock.now());
      return snapshot(room.id, user.id);
    });
  }

  // ------------------------------------------------------------------ серверный таймер
  function toWaiting(room, at) {
    db.run("UPDATE rooms SET phase = 'waiting', phase_started_at = ?, phase_ends_at = NULL WHERE id = ?", at, room.id);
    db.emit({ scope: 'room', roomId: room.id, type: 'phase_changed', data: { from: 'break', to: 'waiting', cycleId: room.cycle_id, phaseStartedAt: at, phaseEndsAt: null } });
    db.emit(stateEvent(room.id));
  }

  /** Прерывает сессии тех, кто пропал дольше grace-периода (переподключение внутри grace допустимо). */
  function expireAbsent(room, ref) {
    const gone = db.all(
      `SELECT s.* FROM focus_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.room_id = ? AND s.cycle_id = ? AND s.status = 'active' AND ? - u.last_seen_at > ?`,
      room.id, room.cycle_id, ref, config.graceMs,
    );
    for (const s of gone) {
      db.run("UPDATE focus_sessions SET status = 'abandoned', end_reason = 'disconnected', ended_at = ? WHERE id = ?", ref, s.id);
      db.emit({ scope: 'user', userId: s.user_id, type: 'session_completed', data: { sessionId: s.id, roomId: room.id, status: 'abandoned', rewarded: false, xp: 0, coins: 0, reason: 'disconnected' } });
      db.emit({ scope: 'room', roomId: room.id, type: 'player_status_changed', data: { userId: s.user_id, status: 'abandoned', reason: 'disconnected' } });
    }
    if (gone.length) db.emit(stateEvent(room.id));
  }

  function finishFocus(room) {
    const endAt = room.phase_ends_at;
    const active = db.all("SELECT * FROM focus_sessions WHERE room_id = ? AND cycle_id = ? AND status = 'active' ORDER BY rowid", room.id, room.cycle_id);
    const rewardedUsers = [];
    for (const s of active) {
      const res = game.completeSession(room, s, endAt);
      if (res.rewarded) rewardedUsers.push(s.user_id);
    }
    const breakEnds = endAt + room.break_sec * 1000;
    db.run("UPDATE rooms SET phase = 'break', phase_started_at = ?, phase_ends_at = ? WHERE id = ?", endAt, breakEnds, room.id);
    db.emit({ scope: 'room', roomId: room.id, type: 'phase_changed', data: { from: 'focus', to: 'break', cycleId: room.cycle_id, phaseStartedAt: endAt, phaseEndsAt: breakEnds, completed: active.length, rewarded: rewardedUsers.length } });
    game.addTeamPoints(room, rewardedUsers);
    db.emit(stateEvent(room.id));
  }

  /** Догоняет фазы комнаты до текущего момента (для нескольких пропущенных тиков — в цикле). */
  function advanceInTx(roomId) {
    let room = loadRoom(roomId);
    const t = clock.now();
    for (let guard = 0; guard < 1000 && room; guard++) {
      if (room.phase === 'focus') {
        expireAbsent(room, Math.min(t, room.phase_ends_at));
        if (t < room.phase_ends_at) break;
        finishFocus(room);
      } else if (room.phase === 'break' && t >= room.phase_ends_at) {
        toWaiting(room, room.phase_ends_at);
      } else break;
      room = loadRoom(roomId);
    }
  }
  const advance = (roomId) => db.tx(() => advanceInTx(roomId));

  function runningRoomIds() {
    return db.all("SELECT id FROM rooms WHERE phase IN ('focus','break')").map((r) => r.id);
  }

  /** После рестарта процесса даём всем активным участникам свежий grace-период. */
  function recoverAfterRestart() {
    db.run("UPDATE users SET last_seen_at = ? WHERE id IN (SELECT user_id FROM focus_sessions WHERE status = 'active')", clock.now());
  }

  // ------------------------------------------------------------------ присутствие
  const connectionState = (lastSeen, t) => {
    const d = t - lastSeen;
    return d <= config.onlineWindowMs ? 'online' : d <= config.graceMs ? 'reconnecting' : 'offline';
  };

  function memberStatus(room, sess) {
    if (sess) return sess.status === 'active' ? 'focusing' : sess.status === 'completed' ? 'finished' : sess.status; // aborted | abandoned
    return room.phase === 'focus' ? 'spectating' : room.phase === 'break' ? 'resting' : 'waiting';
  }

  // ------------------------------------------------------------------ снимок состояния для клиента
  function snapshot(roomId, viewerId) {
    const room = loadRoom(roomId);
    const t = clock.now();
    const sessions = new Map(
      room.cycle_id
        ? db.all('SELECT * FROM focus_sessions WHERE room_id = ? AND cycle_id = ?', room.id, room.cycle_id).map((s) => [s.user_id, s])
        : [],
    );
    const rows = db.all(
      `SELECT m.user_id, m.role, m.team_key, m.task_title, m.joined_at, u.name, u.xp, u.last_seen_at, u.prank_enabled
       FROM room_members m JOIN users u ON u.id = m.user_id WHERE m.room_id = ? AND m.left_at IS NULL ORDER BY m.joined_at, m.rowid`, room.id,
    );
    const contributions = new Map(db.all('SELECT user_id, points FROM team_contributions WHERE room_id = ?', room.id).map((c) => [c.user_id, c.points]));
    const members = rows.map((m) => {
      const sess = sessions.get(m.user_id);
      return {
        userId: m.user_id, name: m.name, role: m.role, level: game.levelInfo(m.xp).level, team: m.team_key,
        task: m.task_title, status: memberStatus(room, sess), connection: connectionState(m.last_seen_at, t),
        prankEnabled: Boolean(m.prank_enabled), contribution: contributions.get(m.user_id) ?? 0,
        session: sess ? { id: sess.id, status: sess.status, rewarded: Boolean(sess.rewarded) } : null,
      };
    });

    const out = {
      room: {
        id: room.id, code: room.code, name: room.name, hostId: room.host_id, phase: room.phase,
        cycleId: room.cycle_id, cycleNo: room.cycle_no, demo: Boolean(room.demo), mode: room.mode,
        settings: { focusSec: room.focus_sec, breakSec: room.break_sec },
        phaseStartedAt: room.phase_started_at, phaseEndsAt: room.phase_ends_at,
        serverTime: t, remainingMs: room.phase_ends_at ? Math.max(0, room.phase_ends_at - t) : null,
      },
      members,
      challenge: game.roadmapView(room.id, viewerId),
    };
    if (viewerId) {
      const mine = members.find((m) => m.userId === viewerId);
      const u = db.get('SELECT * FROM users WHERE id = ?', viewerId);
      const isHost = room.host_id === viewerId;
      out.me = {
        userId: viewerId, isMember: Boolean(mine), isHost, team: mine?.team ?? null, status: mine?.status ?? null, task: mine?.task ?? null,
        session: mine?.session ?? null, ...game.levelInfo(u.xp), coins: u.coins, prankEnabled: Boolean(u.prank_enabled),
        effects: game.effects(viewerId),
        allowedActions: mine ? allowedActions(room, isHost, mine) : [],
      };
    }
    return out;
  }

  /** Подсказка клиенту: что разрешено в текущей фазе (сервер всё равно перепроверяет). */
  function allowedActions(room, isHost, mine) {
    const a = ['set_task', 'leave_room', 'view_roadmap', 'heartbeat'];
    if (room.phase === 'waiting') {
      if (room.mode === 'teams') a.push('set_team');
      if (isHost) a.push('start_focus', 'update_settings', 'close_room');
    } else if (room.phase === 'focus') {
      if (mine.status === 'focusing') a.push('abort_session');
      const i = a.indexOf('set_task');
      if (mine.status === 'focusing') a.splice(i, 1);
    } else if (room.phase === 'break') {
      a.push('help', 'prank', 'buy_upgrade', 'record_result');
      if (isHost) a.push('skip_break', 'close_room');
    }
    return a;
  }

  return {
    findRoom, requireMember, requirePhase, memberRow, loadRoom,
    create, join, leave, close, updateSettings, setTask, setTeam, recordResult,
    startFocus, abortSession, skipBreak, advance, runningRoomIds, recoverAfterRestart,
    snapshot, connectionState,
  };
}
