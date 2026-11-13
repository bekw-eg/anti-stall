import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { boot, lobby } from './helpers.js';

const offer = (sdp = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n') => ({ description: { type: 'offer', sdp } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('голос: сигналинг WebRTC через WebSocket', () => {
  let w;
  before(async () => { w = await boot({ config: { voice: { maxPeers: 3 } } }); });
  after(() => w.close());

  async function subscribed(user, roomId) {
    const c = w.ws(user.token);
    await c.connect();
    c.send({ type: 'subscribe', roomId });
    await c.wait((m) => m.type === 'voice_roster' && m.roomId === roomId);
    return c;
  }
  async function joined(c, roomId, extra = {}) {
    c.send({ type: 'voice_join', roomId, ...extra });
    return c.wait((m) => m.type === 'voice_joined' && m.roomId === roomId);
  }

  test('вход в голос: список участников, ICE-серверы, рассылка остальным, roster новым подписчикам', async () => {
    const L = await lobby(w, ['Лотти', 'Аня', 'Боря']);
    const [lotti, anya, boris] = L.users;
    const a = await subscribed(lotti, L.room.id);
    const b = await subscribed(anya, L.room.id);

    const ja = await joined(a, L.room.id);
    assert.deepEqual(ja.data.peers, []);
    assert.equal(ja.data.self.userId, lotti.id);
    assert.equal(ja.data.self.name, 'Лотти');
    assert.ok(ja.data.iceServers.some((s) => s.urls.some((u) => u.startsWith('stun:'))), 'STUN выдан');
    assert.equal(ja.data.relay, false, 'TURN не настроен');

    const seen = await b.wait((m) => m.type === 'voice_peer_joined');
    assert.equal(seen.data.peer.userId, lotti.id);
    assert.equal(a.of('voice_peer_joined').length, 0, 'себе событие о собственном входе не шлём');

    const jb = await joined(b, L.room.id, { muted: true });
    assert.deepEqual(jb.data.peers.map((p) => p.userId), [lotti.id]);
    const aboutAnya = await a.wait((m) => m.type === 'voice_peer_joined' && m.data.peer.userId === anya.id);
    assert.equal(aboutAnya.data.peer.muted, true);

    // кто в голосе — видно и тем, кто к звуку не подключён (roster при подписке и REST)
    const c = await subscribed(boris, L.room.id);
    const roster = c.of('voice_roster')[0];
    assert.deepEqual(roster.data.peers.map((p) => p.userId).sort(), [lotti.id, anya.id].sort());
    const rest = await boris.get(L.path('/voice'));
    assert.equal(rest.status, 200);
    assert.equal(rest.body.peers.length, 2);
    [a, b, c].forEach((x) => x.close());
  });

  test('сигналы пересылаются только участникам того же голосового канала, лишние поля отбрасываются', async () => {
    const L = await lobby(w, ['Лотти', 'Аня', 'Боря']);
    const other = await lobby(w, ['Чужой']);
    const [lotti, anya, boris] = L.users;
    const a = await subscribed(lotti, L.room.id);
    const b = await subscribed(anya, L.room.id);
    const c = await subscribed(boris, L.room.id); // в комнате, но не в голосе
    const spy = await subscribed(other.host, other.room.id);
    await joined(a, L.room.id);
    await joined(b, L.room.id);

    a.send({ type: 'voice_signal', roomId: L.room.id, to: anya.id, signal: { ...offer(), evil: 'x' } });
    const got = await b.wait((m) => m.type === 'voice_signal');
    assert.equal(got.data.from, lotti.id);
    assert.equal(got.data.signal.description.type, 'offer');
    assert.equal(got.data.signal.evil, undefined);

    b.send({ type: 'voice_signal', roomId: L.room.id, to: lotti.id, signal: { candidate: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0', sdpMLineIndex: 0, extra: 1 } } });
    const cand = await a.wait((m) => m.type === 'voice_signal');
    assert.deepEqual(Object.keys(cand.data.signal.candidate).sort(), ['candidate', 'sdpMLineIndex', 'sdpMid', 'usernameFragment']);

    // получатель не в голосе / отправитель не в голосе / мусор вместо сигнала / себе
    a.send({ type: 'voice_signal', roomId: L.room.id, to: boris.id, signal: offer(), reqId: 1 });
    assert.equal((await a.wait((m) => m.type === 'error' && m.reqId === 1)).data.code, 'VOICE_PEER_NOT_FOUND');
    c.send({ type: 'voice_signal', roomId: L.room.id, to: lotti.id, signal: offer(), reqId: 2 });
    assert.equal((await c.wait((m) => m.type === 'error' && m.reqId === 2)).data.code, 'VOICE_NOT_JOINED');
    a.send({ type: 'voice_signal', roomId: L.room.id, to: anya.id, signal: { description: { type: 'pranswer', sdp: 'x' } }, reqId: 3 });
    assert.equal((await a.wait((m) => m.type === 'error' && m.reqId === 3)).data.code, 'INVALID_SIGNAL');
    a.send({ type: 'voice_signal', roomId: L.room.id, to: anya.id, signal: { description: { type: 'offer', sdp: 'x'.repeat(40_000) } }, reqId: 4 });
    assert.equal((await a.wait((m) => m.type === 'error' && m.reqId === 4)).data.code, 'INVALID_SIGNAL');
    a.send({ type: 'voice_signal', roomId: L.room.id, to: lotti.id, signal: offer(), reqId: 5 });
    assert.equal((await a.wait((m) => m.type === 'error' && m.reqId === 5)).data.code, 'INVALID_SIGNAL');

    // в чужую комнату (без подписки) голос недоступен
    spy.send({ type: 'voice_join', roomId: L.room.id, reqId: 6 });
    assert.equal((await spy.wait((m) => m.type === 'error' && m.reqId === 6)).data.code, 'NOT_SUBSCRIBED');
    await sleep(50);
    assert.equal(spy.of('voice_signal').length + c.of('voice_signal').length, 0, 'сигналы не утекают');
    [a, b, c, spy].forEach((x) => x.close());
  });

  test('mute / deafen / speaking рассылаются комнате; с выключенным микрофоном «говорящим» не бывает', async () => {
    const L = await lobby(w, ['Лотти', 'Аня']);
    const [lotti, anya] = L.users;
    const a = await subscribed(lotti, L.room.id);
    const b = await subscribed(anya, L.room.id);
    await joined(a, L.room.id);

    a.send({ type: 'voice_state', roomId: L.room.id, speaking: true });
    assert.equal((await b.wait((m) => m.type === 'voice_state' && m.data.speaking)).data.userId, lotti.id);
    a.send({ type: 'voice_state', roomId: L.room.id, muted: true, speaking: true });
    const muted = await b.wait((m) => m.type === 'voice_state' && m.data.muted);
    assert.equal(muted.data.speaking, false);
    a.send({ type: 'voice_state', roomId: L.room.id, deafened: true });
    assert.equal((await b.wait((m) => m.type === 'voice_state' && m.data.deafened)).data.deafened, true);
    const before = b.of('voice_state').length;
    a.send({ type: 'voice_state', roomId: L.room.id, deafened: true }); // без изменений — без рассылки
    await sleep(50);
    assert.equal(b.of('voice_state').length, before);
    const peer = (await anya.get(L.path('/voice'))).body.peers[0];
    assert.deepEqual([peer.muted, peer.deafened, peer.speaking], [true, true, false]);
    [a, b].forEach((x) => x.close());
  });

  test('обрыв, выход, повторный вход с другой вкладки и выход из комнаты не оставляют «мёртвых» участников', async () => {
    const L = await lobby(w, ['Лотти', 'Аня', 'Боря']);
    const [lotti, anya, boris] = L.users;
    let a = await subscribed(lotti, L.room.id);
    const b = await subscribed(anya, L.room.id);
    await joined(a, L.room.id);
    await joined(b, L.room.id);

    // 1) обрыв соединения
    a.close();
    const gone = await b.wait((m) => m.type === 'voice_peer_left' && m.data.userId === lotti.id);
    assert.equal(gone.data.reason, 'disconnected');
    assert.deepEqual((await anya.get(L.path('/voice'))).body.peers.map((p) => p.userId), [anya.id]);

    // 2) повторный вход: новая вкладка вытесняет старую
    a = await subscribed(lotti, L.room.id);
    await joined(a, L.room.id);
    const a2 = await subscribed(lotti, L.room.id);
    await joined(a2, L.room.id);
    assert.equal((await a.wait((m) => m.type === 'voice_kicked')).data.reason, 'replaced');
    assert.equal((await b.wait((m) => m.type === 'voice_peer_left' && m.data.reason === 'replaced')).data.userId, lotti.id);
    assert.deepEqual((await anya.get(L.path('/voice'))).body.peers.map((p) => p.userId).sort(), [lotti.id, anya.id].sort());
    // старая вкладка больше не может слать сигналы
    a.send({ type: 'voice_signal', roomId: L.room.id, to: anya.id, signal: offer(), reqId: 9 });
    assert.equal((await a.wait((m) => m.type === 'error' && m.reqId === 9)).data.code, 'VOICE_NOT_JOINED');
    // а закрытие старой вкладки не выкидывает новую
    a.close();
    await sleep(50);
    assert.equal((await anya.get(L.path('/voice'))).body.peers.length, 2);

    // 3) кнопка «выйти из голоса»
    a2.send({ type: 'voice_leave', roomId: L.room.id });
    await a2.wait((m) => m.type === 'voice_left');
    assert.equal((await b.wait((m) => m.type === 'voice_peer_left' && m.data.reason === 'left')).data.userId, lotti.id);

    // 4) выход из комнаты через REST — и из голоса тоже
    const c = await subscribed(boris, L.room.id);
    await anya.post(L.path('/leave'));
    assert.equal((await c.wait((m) => m.type === 'voice_peer_left' && m.data.userId === anya.id)).data.reason, 'left_room');
    assert.equal((await b.wait((m) => m.type === 'voice_kicked')).data.reason, 'left_room');
    assert.equal((await boris.get(L.path('/voice'))).body.peers.length, 0);
    [a2, b, c].forEach((x) => x.close());
  });

  test('ограничение размера канала и пачки ICE-кандидатов не рвут соединение', async () => {
    const L = await lobby(w, ['Лотти', 'Аня', 'Боря', 'Вика']);
    const conns = await Promise.all(L.users.map((u) => subscribed(u, L.room.id)));
    for (const c of conns.slice(0, 3)) await joined(c, L.room.id);
    conns[3].send({ type: 'voice_join', roomId: L.room.id, reqId: 1 });
    assert.equal((await conns[3].wait((m) => m.type === 'error' && m.reqId === 1)).data.code, 'VOICE_FULL');

    // 120 кандидатов за раз (≈ по 40 на каждого из трёх собеседников) — нормальная пачка, не флуд
    for (let i = 0; i < 120; i++) {
      conns[0].send({ type: 'voice_signal', roomId: L.room.id, to: L.users[1].id, signal: { candidate: { candidate: `candidate:${i} 1 udp 1 10.0.0.1 ${1000 + i} typ host`, sdpMid: '0', sdpMLineIndex: 0 } } });
    }
    await conns[1].wait(() => conns[1].of('voice_signal').length === 120, 3000).catch(() => undefined);
    await sleep(100);
    assert.equal(conns[1].of('voice_signal').length, 120);
    assert.equal(conns[0].ws.readyState, 1, 'соединение отправителя живо');
    conns.forEach((x) => x.close());
  });
});

describe('голос: STUN/TURN', () => {
  test('общий секрет TURN → временные логины, проверяемые coturn (HMAC-SHA1)', async () => {
    const w = await boot({ config: { voice: { turnUrls: ['turn:turn.example.com:3478?transport=udp', 'turns:turn.example.com:5349'], turnSecret: 's3cret' } } });
    try {
      const u = await w.user('Лотти');
      const r = await u.get('/api/voice/ice-servers');
      assert.equal(r.status, 200);
      assert.equal(r.body.relay, true);
      const turn = r.body.iceServers.find((s) => s.urls.some((x) => x.startsWith('turn')));
      const [expiry, uid] = turn.username.split(':');
      assert.equal(uid, u.id);
      assert.equal(Number(expiry), Math.floor(w.clock.now() / 1000) + 3600);
      assert.equal(turn.credential, createHmac('sha1', 's3cret').update(turn.username).digest('base64'));
      assert.equal(JSON.stringify(r.body).includes('s3cret'), false, 'секрет не уходит клиенту');
      assert.equal((await w.call('GET', '/api/config')).body.voice.turnConfigured, true);
      assert.equal((await w.call('GET', '/api/voice/ice-servers')).status, 401);
    } finally { await w.close(); }
  });

  test('статичные логин/пароль TURN и STUN из окружения', async () => {
    const w = await boot({ env: { TOMATO_STUN_URLS: 'stun:a.example:3478, stun:b.example:3478', TOMATO_TURN_URLS: 'turn:t.example:3478', TOMATO_TURN_USERNAME: 'user', TOMATO_TURN_CREDENTIAL: 'pass' } });
    try {
      const u = await w.user('Аня');
      const { iceServers } = (await u.get('/api/voice/ice-servers')).body;
      assert.deepEqual(iceServers[0], { urls: ['stun:a.example:3478', 'stun:b.example:3478'] });
      assert.deepEqual(iceServers[1], { urls: ['turn:t.example:3478'], username: 'user', credential: 'pass' });
    } finally { await w.close(); }
  });
});
