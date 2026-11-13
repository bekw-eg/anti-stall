import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerEvent, VoicePeer } from "@/api/tomato";
import { VoiceClient, type AudioSink, type VoiceDeps } from "./VoiceClient";

/* ------------------------------------------------------------------ имитация WebRTC
 * Достаточно поведения настоящего RTCPeerConnection, чтобы проверить логику клиента:
 * offer/answer с неявным откатом, трансиверы, ICE-кандидаты (ошибка до remoteDescription),
 * событие negotiationneeded, установление соединения и ontrack при входящем звуке. */

let seq = 0;
class FakeTrack { kind = "audio"; enabled = true; stopped = false; stop() { this.stopped = true; } }
class FakeStream {
  id = `s${++seq}`;
  constructor(public tracks: FakeTrack[]) {}
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks; }
}
class FakeTransceiver {
  currentDirection: string | null = null;
  sender: { track: FakeTrack | null; replaceTrack: (t: FakeTrack | null) => Promise<void> };
  receiver = { track: new FakeTrack() };
  private dir: RTCRtpTransceiverDirection;
  /** как в браузере: смена направления ставит флаг negotiationneeded */
  onDirectionChange: (() => void) | null = null;
  constructor(direction: RTCRtpTransceiverDirection) {
    this.dir = direction;
    const sender = { track: null as FakeTrack | null, replaceTrack: async (t: FakeTrack | null) => { sender.track = t; } };
    this.sender = sender;
  }
  get direction() { return this.dir; }
  set direction(d: RTCRtpTransceiverDirection) { if (d !== this.dir) { this.dir = d; this.onDirectionChange?.(); } }
}
type Sdp = { from: number; sending: number; restart: number };

class FakePC {
  static all: FakePC[] = [];
  static srdDelayMs = 0;
  id = ++seq;
  signalingState: RTCSignalingState = "stable";
  connectionState: RTCPeerConnectionState = "new";
  localDescription: { type: string; sdp: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  transceivers: FakeTransceiver[] = [];
  candidates: (RTCIceCandidateInit | undefined)[] = [];
  candidateErrors = 0;
  closed = false;
  restarts = 0;
  offersMade = 0;
  trackFired = 0;
  private negPending = false;
  private remote: Sdp | null = null;
  onicecandidate: ((e: { candidate: unknown }) => void) | null = null;
  ontrack: ((e: { track: FakeTrack; streams: FakeStream[] }) => void) | null = null;
  onnegotiationneeded: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  constructor(public config: RTCConfiguration) { FakePC.all.push(this); }

  private negotiate() {
    if (this.negPending) return;
    this.negPending = true;
    setTimeout(() => { this.negPending = false; if (!this.closed && this.signalingState === "stable") this.onnegotiationneeded?.(); }, 0);
  }
  private sending() {
    return this.transceivers.filter((t) => t.sender.track && (t.direction === "sendrecv" || t.direction === "sendonly")).length;
  }
  private track(tr: FakeTransceiver) {
    // во время чужого offer смена направления войдёт в answer; иначе нужна новая пересогласовка
    tr.onDirectionChange = () => { if (this.signalingState === "stable") this.negotiate(); };
    this.transceivers.push(tr);
    return tr;
  }
  addTrack(track: FakeTrack) {
    const tr = this.track(new FakeTransceiver("sendrecv"));
    tr.sender.track = track;
    this.negotiate();
  }
  addTransceiver(_kind: string, init: { direction: RTCRtpTransceiverDirection }) {
    this.track(new FakeTransceiver(init.direction));
    this.negotiate();
  }
  getTransceivers() { return this.transceivers; }
  async setLocalDescription() {
    const type = this.signalingState === "have-remote-offer" ? "answer" : "offer";
    if (type === "offer") this.offersMade++;
    this.localDescription = { type, sdp: JSON.stringify({ from: this.id, sending: this.sending(), restart: this.restarts } satisfies Sdp) };
    this.signalingState = type === "offer" ? "have-local-offer" : "stable";
    setTimeout(() => {
      if (this.closed) return;
      const c = { candidate: `candidate:${this.id} 1 udp 1 10.0.0.${this.id} 9 typ host`, sdpMid: "0", sdpMLineIndex: 0 };
      this.onicecandidate?.({ candidate: { ...c, toJSON: () => c } });
      this.onicecandidate?.({ candidate: null });
    }, 1);
    if (type === "answer") this.maybeConnect();
  }
  async setRemoteDescription(desc: { type: string; sdp: string }) {
    if (FakePC.srdDelayMs) await new Promise((r) => setTimeout(r, FakePC.srdDelayMs));
    this.remote = JSON.parse(desc.sdp) as Sdp;
    if (desc.type === "offer") {
      if (this.signalingState === "have-local-offer") { this.localDescription = null; this.signalingState = "stable"; } // неявный откат
      if (this.transceivers.length === 0) this.track(new FakeTransceiver("recvonly")); // трансивер из чужого offer
      this.remoteDescription = desc;
      this.signalingState = "have-remote-offer";
    } else {
      this.remoteDescription = desc;
      this.signalingState = "stable";
      this.maybeConnect();
    }
  }
  async addIceCandidate(c?: RTCIceCandidateInit) {
    if (!this.remoteDescription) { this.candidateErrors++; throw new Error("InvalidStateError: remote description is null"); }
    this.candidates.push(c);
  }
  private maybeConnect() {
    setTimeout(() => {
      if (this.closed || !this.localDescription || !this.remoteDescription) return;
      if (this.connectionState !== "connected") { this.connectionState = "connected"; this.onconnectionstatechange?.(); }
      if ((this.remote?.sending ?? 0) > 0 && this.trackFired === 0) {
        this.trackFired++;
        const t = new FakeTrack();
        this.ontrack?.({ track: t, streams: [new FakeStream([t])] });
      }
    }, 2);
  }
  fail() { this.connectionState = "failed"; this.onconnectionstatechange?.(); }
  restartIce() { this.restarts++; this.negotiate(); }
  close() { this.closed = true; this.connectionState = "closed"; }
  async getStats() { return new Map(); }
}

/* ------------------------------------------------------------------ имитация сервера (как backend/src/ws/voice.js) */
const ROOM = "room-1";
class FakeServer {
  roster = new Map<string, VoicePeer>();
  clients = new Map<string, VoiceClient>();
  online = new Map<string, boolean>();
  sent: { from: string; msg: Record<string, unknown> }[] = [];

  deliver(to: string, type: string, data: Record<string, unknown>) {
    setTimeout(() => { if (this.online.get(to)) this.clients.get(to)?.handleEvent({ type, ts: Date.now(), roomId: ROOM, data: { roomId: ROOM, ...data } } as ServerEvent); }, 0);
  }
  broadcast(type: string, data: Record<string, unknown>, except?: string) {
    for (const id of this.clients.keys()) if (id !== except) this.deliver(id, type, data);
  }
  handle(from: string, msg: Record<string, unknown>): boolean {
    if (!this.online.get(from)) return false;
    this.sent.push({ from, msg });
    switch (msg.type) {
      case "voice_join": {
        if (this.roster.has(from)) { this.roster.delete(from); this.broadcast("voice_peer_left", { userId: from, reason: "rejoined" }); }
        const self: VoicePeer = { userId: from, name: from.toUpperCase(), muted: Boolean(msg.muted), deafened: Boolean(msg.deafened), speaking: false, joinedAt: Date.now() + this.roster.size };
        const peers = [...this.roster.values()];
        this.roster.set(from, self);
        this.broadcast("voice_peer_joined", { peer: self }, from);
        this.deliver(from, "voice_joined", { self, peers, iceServers: [{ urls: ["stun:stun.example:3478"] }], relay: false });
        return true;
      }
      case "voice_leave":
        this.roster.delete(from);
        this.broadcast("voice_peer_left", { userId: from, reason: "left" });
        return true;
      case "voice_signal":
        if (this.roster.has(msg.to as string)) this.deliver(msg.to as string, "voice_signal", { from, signal: msg.signal });
        return true;
      case "voice_state": {
        const p = this.roster.get(from);
        if (p) { Object.assign(p, { muted: msg.muted, deafened: msg.deafened, speaking: msg.speaking }); this.broadcast("voice_state", { userId: from, muted: p.muted, deafened: p.deafened, speaking: p.speaking }); }
        return true;
      }
      default: return true;
    }
  }
  /** Обрыв сокета: сервер убирает из голоса, клиент получает disconnected. */
  drop(id: string) {
    this.online.set(id, false);
    if (this.roster.delete(id)) this.broadcast("voice_peer_left", { userId: id, reason: "disconnected" });
    this.clients.get(id)?.handleEvent({ type: "disconnected", ts: Date.now(), data: {} } as ServerEvent);
  }
  restore(id: string) {
    this.online.set(id, true);
    this.clients.get(id)?.handleEvent({ type: "hello", ts: Date.now(), data: {} } as ServerEvent);
  }
}

interface Rig { client: VoiceClient; sinks: { userId: string; muted: boolean; closed: boolean }[]; mic: FakeStream | null; pcs: () => FakePC[] }

function makeClient(server: FakeServer, id: string, opts: Partial<VoiceDeps> & { deny?: boolean } = {}): Rig {
  const rig: Rig = { client: null!, sinks: [], mic: null, pcs: () => [] };
  const created: FakePC[] = [];
  let deny = opts.deny ?? false;
  const client = new VoiceClient({
    roomId: ROOM,
    myId: id,
    send: (m) => server.handle(id, m),
    getUserMedia: async () => {
      if (deny) { deny = false; throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); }
      rig.mic = new FakeStream([new FakeTrack()]);
      return rig.mic as unknown as MediaStream;
    },
    createPeerConnection: (cfg) => { const pc = new FakePC(cfg); created.push(pc); return pc as unknown as RTCPeerConnection; },
    playStream: (userId): AudioSink => {
      const s = { userId, muted: false, closed: false };
      rig.sinks.push(s);
      return { setMuted: (m) => { s.muted = m; }, close: () => { s.closed = true; } };
    },
    ...opts,
  });
  rig.client = client;
  rig.pcs = () => created.filter((p) => !p.closed);
  server.clients.set(id, client);
  server.online.set(id, true);
  return rig;
}

const connectedTo = (rig: Rig) => Object.entries(rig.client.getSnapshot().links).filter(([, s]) => s === "connected").map(([id]) => id).sort();

afterEach(() => { FakePC.all = []; FakePC.srdDelayMs = 0; vi.useRealTimers(); vi.restoreAllMocks(); });

describe("VoiceClient: голосовой канал на WebRTC", () => {
  it("три участника: каждый соединён с каждым, звук идёт в обе стороны, у всех одинаковый список", async () => {
    const server = new FakeServer();
    const a = makeClient(server, "a");
    const b = makeClient(server, "b");
    const c = makeClient(server, "c");
    await a.client.join();
    await vi.waitFor(() => expect(a.client.getSnapshot().status).toBe("connected"));
    await b.client.join();
    await c.client.join();

    await vi.waitFor(() => {
      expect(connectedTo(a)).toEqual(["b", "c"]);
      expect(connectedTo(b)).toEqual(["a", "c"]);
      expect(connectedTo(c)).toEqual(["a", "b"]);
    });
    for (const r of [a, b, c]) {
      expect(r.client.getSnapshot().peers.map((p) => p.userId).sort()).toEqual(["a", "b", "c"]);
      await vi.waitFor(() => expect(r.sinks.filter((s) => !s.closed).map((s) => s.userId).sort()).toHaveLength(2));
      expect(r.pcs()).toHaveLength(2); // ровно одно соединение на собеседника
      expect(r.pcs()[0].config.iceServers?.[0].urls).toEqual(["stun:stun.example:3478"]); // ICE-серверы — от сервера
    }
    expect(FakePC.all.reduce((n, p) => n + p.candidateErrors, 0)).toBe(0);
  });

  it("ICE-кандидаты, пришедшие пока применяется SDP, не теряются", async () => {
    FakePC.srdDelayMs = 25; // медленный setRemoteDescription: кандидат приходит раньше, чем SDP применён
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const server = new FakeServer();
    const a = makeClient(server, "a");
    const b = makeClient(server, "b");
    await a.client.join();
    await vi.waitFor(() => expect(a.client.getSnapshot().status).toBe("connected"));
    await b.client.join();
    await vi.waitFor(() => { expect(connectedTo(a)).toEqual(["b"]); expect(connectedTo(b)).toEqual(["a"]); });
    await vi.waitFor(() => {
      for (const pc of FakePC.all) expect(pc.candidates.filter((c) => c?.candidate).length).toBe(1); // по кандидату от собеседника
    });
    expect(FakePC.all.reduce((n, p) => n + p.candidateErrors, 0)).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("одновременные offer (glare): вежливая сторона уступает, соединение одно и устанавливается", async () => {
    const server = new FakeServer();
    const a = makeClient(server, "a");
    const b = makeClient(server, "b");
    // оба думают, что вошли последними, и звонят друг другу одновременно
    server.online.set("a", true); server.online.set("b", true);
    await Promise.all([a.client.join(), b.client.join()]);
    const pa: VoicePeer = { userId: "a", name: "A", muted: false, deafened: false, speaking: false, joinedAt: 1 };
    const pb: VoicePeer = { ...pa, userId: "b", name: "B" };
    server.roster.set("a", pa); server.roster.set("b", pb);
    a.client.handleEvent({ type: "voice_joined", ts: 0, roomId: ROOM, data: { self: pa, peers: [pb], iceServers: [] } } as ServerEvent);
    b.client.handleEvent({ type: "voice_joined", ts: 0, roomId: ROOM, data: { self: pb, peers: [pa], iceServers: [] } } as ServerEvent);
    await vi.waitFor(() => { expect(connectedTo(a)).toEqual(["b"]); expect(connectedTo(b)).toEqual(["a"]); });
    expect(a.pcs()).toHaveLength(1);
    expect(b.pcs()).toHaveLength(1);
    await vi.waitFor(() => { expect(a.sinks).toHaveLength(1); expect(b.sinks).toHaveLength(1); });
  });

  it("нет доступа к микрофону: входим слушателем, слышим других; разрешили — микрофон подключается без перезахода", async () => {
    const server = new FakeServer();
    const a = makeClient(server, "a");
    const listener = makeClient(server, "l", { deny: true });
    await a.client.join();
    await vi.waitFor(() => expect(a.client.getSnapshot().status).toBe("connected"));
    await listener.client.join();
    const snap = listener.client.getSnapshot();
    expect(snap.mic).toBe("denied");
    await vi.waitFor(() => expect(connectedTo(listener)).toEqual(["a"]));
    await vi.waitFor(() => expect(listener.sinks).toHaveLength(1)); // слышит собеседника
    expect(a.sinks).toHaveLength(0); // а от слушателя звука нет
    expect(server.roster.get("l")!.muted).toBe(true); // остальным он показан с выключенным микрофоном

    await listener.client.setMuted(false); // «включить микрофон» = спросить разрешение снова
    expect(listener.client.getSnapshot().mic).toBe("granted");
    const tr = listener.pcs()[0].getTransceivers()[0];
    expect(tr.sender.track).toBeTruthy();
    expect(tr.direction).toBe("sendrecv");
    await vi.waitFor(() => expect(a.sinks.filter((s) => !s.closed)).toHaveLength(1)); // пересогласовали — теперь его слышно
    expect(server.roster.get("l")!.muted).toBe(false);
  });

  it("mute и deafen: трек выключается, чужой звук глушится, состояние уходит остальным", async () => {
    const server = new FakeServer();
    const a = makeClient(server, "a");
    const b = makeClient(server, "b");
    await a.client.join();
    await vi.waitFor(() => expect(a.client.getSnapshot().status).toBe("connected"));
    await b.client.join();
    await vi.waitFor(() => expect(a.sinks).toHaveLength(1));
    const track = a.mic!.tracks[0];

    await a.client.setMuted(true);
    expect(track.enabled).toBe(false);
    await vi.waitFor(() => expect(b.client.getSnapshot().peers.find((p) => p.userId === "a")!.muted).toBe(true));

    await a.client.setMuted(false);
    a.client.setDeafened(true);
    expect(track.enabled).toBe(false); // оглушён = и не говорит
    expect(a.sinks[0].muted).toBe(true);
    await vi.waitFor(() => expect(b.client.getSnapshot().peers.find((p) => p.userId === "a")!.deafened).toBe(true));
    a.client.setDeafened(false);
    expect(track.enabled).toBe(true);
    expect(a.sinks[0].muted).toBe(false);
  });

  it("индикатор «говорит»: включается от громкости, гаснет после тишины, не горит с выключенным микрофоном", async () => {
    vi.useFakeTimers();
    let level = 0;
    const server = new FakeServer();
    const a = makeClient(server, "a", { createLevelMeter: () => ({ level: () => level, close: () => undefined }) });
    await a.client.join();
    await vi.advanceTimersByTimeAsync(10);
    expect(a.client.getSnapshot().status).toBe("connected");

    level = 0.2;
    await vi.advanceTimersByTimeAsync(250);
    expect(a.client.getSnapshot().speaking).toBe(true);
    expect(server.sent.some((s) => s.msg.type === "voice_state" && s.msg.speaking === true)).toBe(true);

    level = 0;
    await vi.advanceTimersByTimeAsync(400);
    expect(a.client.getSnapshot().speaking).toBe(true); // короткая пауза между словами — не гасим
    await vi.advanceTimersByTimeAsync(1600);
    expect(a.client.getSnapshot().speaking).toBe(false);

    // короткий звук между замерами всё равно ловится огибающей (один громкий замер из многих)
    let n = 0;
    const meterLevel = () => (n++ % 10 === 0 ? 0.4 : 0);
    level = 0;
    const b = makeClient(server, "b", { createLevelMeter: () => ({ level: meterLevel, close: () => undefined }) });
    await b.client.join();
    await vi.advanceTimersByTimeAsync(600);
    expect(b.client.getSnapshot().speaking).toBe(true);
    b.client.leave();

    level = 0.3;
    await a.client.setMuted(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(a.client.getSnapshot().speaking).toBe(false);
    a.client.leave();
  });

  it("выход собеседника и свой выход закрывают соединения и освобождают микрофон", async () => {
    const server = new FakeServer();
    const a = makeClient(server, "a");
    const b = makeClient(server, "b");
    await a.client.join();
    await vi.waitFor(() => expect(a.client.getSnapshot().status).toBe("connected"));
    await b.client.join();
    await vi.waitFor(() => expect(connectedTo(a)).toEqual(["b"]));

    b.client.leave();
    expect(b.pcs()).toHaveLength(0);
    expect(b.mic!.tracks[0].stopped).toBe(true);
    expect(b.sinks.every((s) => s.closed)).toBe(true);
    expect(b.client.getSnapshot().status).toBe("idle");
    await vi.waitFor(() => {
      expect(a.pcs()).toHaveLength(0);
      expect(a.sinks.every((s) => s.closed)).toBe(true);
      expect(a.client.getSnapshot().peers.map((p) => p.userId)).toEqual(["a"]);
    });
  });

  it("обрыв сокета: соединения сбрасываются, после hello клиент сам возвращается в канал", async () => {
    const server = new FakeServer();
    const a = makeClient(server, "a");
    const b = makeClient(server, "b");
    await a.client.join();
    await vi.waitFor(() => expect(a.client.getSnapshot().status).toBe("connected"));
    await b.client.join();
    await vi.waitFor(() => expect(connectedTo(b)).toEqual(["a"]));

    server.drop("b");
    expect(b.client.getSnapshot().status).toBe("reconnecting");
    expect(b.pcs()).toHaveLength(0);
    await vi.waitFor(() => expect(a.pcs()).toHaveLength(0)); // у собеседника «мёртвое» соединение не остаётся

    server.restore("b");
    await vi.waitFor(() => { expect(connectedTo(a)).toEqual(["b"]); expect(connectedTo(b)).toEqual(["a"]); });
    expect(server.sent.filter((s) => s.from === "b" && s.msg.type === "voice_join")).toHaveLength(2);
    expect(a.pcs()).toHaveLength(1);
  });

  it("голос открыт в другой вкладке — эта отключается и объясняет почему; сбой соединения перезапускает ICE", async () => {
    const server = new FakeServer();
    const a = makeClient(server, "a");
    const b = makeClient(server, "b");
    await a.client.join();
    await vi.waitFor(() => expect(a.client.getSnapshot().status).toBe("connected"));
    await b.client.join();
    await vi.waitFor(() => expect(connectedTo(a)).toEqual(["b"]));

    const pc = a.pcs()[0];
    pc.fail();
    expect(pc.restarts).toBe(1);

    a.client.handleEvent({ type: "voice_kicked", ts: 0, roomId: ROOM, data: { reason: "replaced" } } as ServerEvent);
    expect(a.client.getSnapshot().status).toBe("idle");
    expect(a.client.getSnapshot().error).toBe("Голос открыт в другой вкладке");
    expect(a.pcs()).toHaveLength(0);
  });
});
