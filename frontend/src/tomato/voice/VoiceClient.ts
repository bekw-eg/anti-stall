import type { ServerEvent, VoicePeer, VoiceSignal } from "@/api/tomato";

/**
 * Голосовой канал комнаты: WebRTC mesh (каждый с каждым), сигналинг — через WebSocket Tomato.
 * Класс не зависит от React: браузерные API (микрофон, RTCPeerConnection, воспроизведение,
 * измеритель громкости) приходят через deps, поэтому логику можно гонять в тестах на имитации сети.
 *
 * Договорённости:
 *  - Кто вошёл в канал позже, тот и звонит существующим участникам (offer). Одновременные offer
 *    разруливает «perfect negotiation»: вежливая сторона уступает, невежливая игнорирует чужой offer.
 *  - ICE-кандидаты, пришедшие раньше SDP, не теряются: копятся и применяются после setRemoteDescription.
 *  - Сигналы от одного собеседника обрабатываются строго по очереди.
 *  - Нет доступа к микрофону → входим слушателем (recvonly), разрешение можно запросить снова.
 *  - Deafen глушит всех собеседников и заодно выключает свой микрофон.
 */

export type VoiceStatus = "idle" | "joining" | "connected" | "reconnecting";
export type MicState = "unknown" | "requesting" | "granted" | "denied" | "unavailable";
export type LinkState = RTCPeerConnectionState;

export interface VoiceSnapshot {
  status: VoiceStatus;
  mic: MicState;
  /** Выбор пользователя «выключить микрофон» (без учёта deafen и отказа в доступе) */
  muted: boolean;
  deafened: boolean;
  /** Я сейчас говорю (по локальному измерителю громкости) */
  speaking: boolean;
  /** Кто в голосовом канале комнаты (включая меня, если подключён) */
  peers: VoicePeer[];
  /** Состояние моих WebRTC-соединений с каждым собеседником */
  links: Record<string, LinkState>;
  error: string | null;
  relay: boolean;
}

export interface AudioSink { setMuted(muted: boolean): void; close(): void }
export interface LevelMeter { level(): number; close(): void }

export interface VoiceDeps {
  roomId: string;
  myId: string;
  /** Отправить сообщение серверу. false — соединения нет, сообщение не ушло. */
  send(msg: Record<string, unknown>): boolean;
  getUserMedia(): Promise<MediaStream>;
  createPeerConnection(config: RTCConfiguration): RTCPeerConnection;
  playStream(userId: string, stream: MediaStream): AudioSink;
  createLevelMeter?(stream: MediaStream): LevelMeter | null;
  /** Порог громкости (RMS 0..1), выше которого считаем, что человек говорит */
  speakingThreshold?: number;
}

interface PeerLink {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  attached: boolean;
  pending: (RTCIceCandidateInit | null)[];
  sink: AudioSink | null;
  restartTimer: ReturnType<typeof setTimeout> | null;
  state: LinkState;
}

const VOICE_EVENTS = new Set(["voice_roster", "voice_joined", "voice_left", "voice_peer_joined", "voice_peer_left", "voice_state", "voice_signal", "voice_kicked"]);

const ERROR_TEXT: Record<string, string> = {
  VOICE_FULL: "Голосовой канал заполнен",
  ROOM_CLOSED: "Комната закрыта",
  NOT_SUBSCRIBED: "Нет подключения к комнате",
};

export class VoiceClient {
  private snapshot: VoiceSnapshot = {
    status: "idle", mic: "unknown", muted: false, deafened: false, speaking: false, peers: [], links: {}, error: null, relay: false,
  };
  private listeners = new Set<() => void>();
  private roster = new Map<string, VoicePeer>();
  private links = new Map<string, PeerLink>();
  private chains = new Map<string, Promise<void>>();
  private wanted = false;
  private local: MediaStream | null = null;
  private rtcConfig: RTCConfiguration = { iceServers: [] };
  private meter: LevelMeter | null = null;
  private meterTimer: ReturnType<typeof setInterval> | null = null;
  private above = 0;
  private below = 0;
  private disposed = false;

  constructor(private deps: VoiceDeps) {}

  // ------------------------------------------------------------------ подписка для UI
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  getSnapshot = () => this.snapshot;

  private update(patch: Partial<VoiceSnapshot> = {}) {
    const links: Record<string, LinkState> = {};
    this.links.forEach((l, id) => { links[id] = l.state; });
    const peers = [...this.roster.values()].sort((a, b) => a.joinedAt - b.joinedAt || a.userId.localeCompare(b.userId));
    this.snapshot = { ...this.snapshot, ...patch, peers, links };
    this.listeners.forEach((fn) => fn());
  }

  get joined() { return this.wanted; }

  // ------------------------------------------------------------------ действия пользователя
  async join() {
    if (this.wanted || this.disposed) return;
    this.wanted = true;
    this.update({ status: "joining", error: null });
    await this.acquireMic();
    if (!this.wanted) { this.releaseMic(); return; } // успели выйти, пока браузер спрашивал разрешение
    this.sendJoin();
  }

  leave() {
    if (!this.wanted) return;
    this.wanted = false;
    this.deps.send({ type: "voice_leave", roomId: this.deps.roomId });
    this.teardown();
    this.roster.delete(this.deps.myId);
    this.update({ status: "idle", speaking: false });
  }

  async setMuted(muted: boolean) {
    // микрофона нет (отказ) — «включить микрофон» означает повторно спросить разрешение
    if (!muted && !this.local && this.wanted) {
      await this.acquireMic();
      if (this.local) this.attachMicToLinks();
    }
    this.update({ muted });
    this.applyTrack();
    this.sendState();
  }

  setDeafened(deafened: boolean) {
    this.links.forEach((l) => l.sink?.setMuted(deafened));
    this.update({ deafened });
    this.applyTrack();
    this.sendState();
  }

  /** Начальный список из REST (на случай, если voice_roster пришёл раньше подписки UI). */
  setRoster(peers: VoicePeer[]) {
    if (this.wanted && this.snapshot.status === "connected") return; // свежие данные уже идут по WS
    this.roster = new Map(peers.map((p) => [p.userId, p]));
    this.update();
  }

  dispose() {
    this.leave();
    this.disposed = true;
    this.listeners.clear();
  }

  // ------------------------------------------------------------------ события сервера
  handleEvent(ev: ServerEvent) {
    if (this.disposed) return;
    if (ev.type === "hello") {
      // сокет переподключился и заново подписался на комнату — возвращаемся в канал
      if (this.wanted) { this.closeAllLinks(); this.sendJoin(); }
      return;
    }
    if (ev.type === "disconnected") {
      if (this.wanted) {
        // сервер уже убрал нас из канала: старые соединения не нужны, после hello позвоним заново
        this.closeAllLinks();
        this.roster.clear();
        this.update({ status: "reconnecting" });
      }
      return;
    }
    if (ev.type === "error") {
      const d = ev.data as { code?: string; message?: string };
      if (ev.roomId !== this.deps.roomId || !d.code) return;
      if (d.code === "VOICE_FULL" || d.code === "ROOM_CLOSED") {
        this.wanted = false;
        this.teardown();
        this.update({ status: "idle", error: ERROR_TEXT[d.code] ?? d.message ?? "Ошибка голоса" });
      }
      return;
    }
    if (!VOICE_EVENTS.has(ev.type) || ev.roomId !== this.deps.roomId) return;
    const d = ev.data as Record<string, unknown>;
    switch (ev.type) {
      case "voice_roster":
        this.roster = new Map((d.peers as VoicePeer[]).map((p) => [p.userId, p]));
        this.update();
        return;
      case "voice_joined": {
        if (!this.wanted) { this.deps.send({ type: "voice_leave", roomId: this.deps.roomId }); return; }
        this.rtcConfig = { iceServers: (d.iceServers as RTCIceServer[]) ?? [] };
        const self = d.self as VoicePeer;
        const peers = d.peers as VoicePeer[];
        this.roster = new Map([self, ...peers].map((p) => [p.userId, p]));
        this.update({ status: "connected", relay: Boolean(d.relay), error: null });
        this.sendState();
        // новичок звонит всем, кто уже в канале
        for (const p of peers) this.ensureLink(p.userId, true);
        this.update();
        return;
      }
      case "voice_peer_joined": {
        const p = d.peer as VoicePeer;
        this.roster.set(p.userId, p);
        // он позвонит сам; старое соединение с тем же человеком (если было) больше не годится
        if (this.links.has(p.userId)) this.closeLink(p.userId);
        this.update();
        return;
      }
      case "voice_peer_left": {
        const id = d.userId as string;
        if (id === this.deps.myId) return; // про себя узнаём из voice_kicked / voice_left
        this.roster.delete(id);
        this.closeLink(id);
        this.update();
        return;
      }
      case "voice_state": {
        const id = d.userId as string;
        const p = this.roster.get(id);
        if (p) this.roster.set(id, { ...p, muted: Boolean(d.muted), deafened: Boolean(d.deafened), speaking: Boolean(d.speaking) });
        this.update();
        return;
      }
      case "voice_signal":
        this.enqueue(d.from as string, () => this.onSignal(d.from as string, d.signal as VoiceSignal));
        return;
      case "voice_kicked": {
        const replaced = d.reason === "replaced";
        this.wanted = false;
        this.teardown();
        this.roster.delete(this.deps.myId);
        this.update({ status: "idle", speaking: false, error: replaced ? "Голос открыт в другой вкладке" : null });
        return;
      }
      default:
        return;
    }
  }

  // ------------------------------------------------------------------ микрофон
  private async acquireMic() {
    if (this.local) return;
    this.update({ mic: "requesting" });
    try {
      this.local = await this.deps.getUserMedia();
      if (!this.wanted || this.disposed) { this.releaseMic(); return; }
      this.update({ mic: "granted" });
      this.applyTrack();
      this.startMeter();
    } catch (e) {
      const name = (e as { name?: string })?.name;
      this.local = null;
      this.update({ mic: name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError" ? "denied" : "unavailable" });
    }
  }

  private releaseMic() {
    this.stopMeter();
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = null;
  }

  private get micLive() {
    return Boolean(this.local) && !this.snapshot.muted && !this.snapshot.deafened;
  }

  private applyTrack() {
    this.local?.getAudioTracks().forEach((t) => { t.enabled = this.micLive; });
    if (!this.micLive && this.snapshot.speaking) this.update({ speaking: false });
  }

  private sendState() {
    if (!this.wanted || this.snapshot.status !== "connected") return;
    this.deps.send({
      type: "voice_state", roomId: this.deps.roomId,
      muted: !this.local || this.snapshot.muted, deafened: this.snapshot.deafened, speaking: this.snapshot.speaking && this.micLive,
    });
    const me = this.roster.get(this.deps.myId);
    if (me) {
      this.roster.set(this.deps.myId, { ...me, muted: !this.local || this.snapshot.muted, deafened: this.snapshot.deafened, speaking: this.snapshot.speaking && this.micLive });
      this.update();
    }
  }

  /**
   * Индикатор «говорит». Громкость меряем каждые 50 мс и сглаживаем огибающей (быстрый подъём,
   * плавный спад), иначе короткие звуки проскакивают между замерами, а между слогами индикатор мерцает.
   * Включается после 2 громких замеров, гаснет после 0,8 с тишины огибающей.
   */
  private startMeter() {
    if (!this.local || !this.deps.createLevelMeter) return;
    this.meter = this.deps.createLevelMeter(this.local);
    if (!this.meter) return;
    const threshold = this.deps.speakingThreshold ?? 0.02;
    let envelope = 0;
    this.meterTimer = setInterval(() => {
      envelope = Math.max(this.meter?.level() ?? 0, envelope * 0.85);
      const loud = this.micLive && envelope > threshold;
      if (loud) { this.above++; this.below = 0; } else { this.below++; this.above = 0; }
      if (!this.snapshot.speaking && this.above >= 2) { this.update({ speaking: true }); this.sendState(); }
      else if (this.snapshot.speaking && this.below >= 16) { this.update({ speaking: false }); this.sendState(); }
    }, 50);
  }

  private stopMeter() {
    if (this.meterTimer) clearInterval(this.meterTimer);
    this.meterTimer = null;
    this.meter?.close();
    this.meter = null;
    this.above = 0;
    this.below = 0;
  }

  // ------------------------------------------------------------------ WebRTC
  private sendJoin() {
    const ok = this.deps.send({ type: "voice_join", roomId: this.deps.roomId, muted: !this.local || this.snapshot.muted, deafened: this.snapshot.deafened });
    this.update({ status: ok ? "joining" : "reconnecting" }); // нет сокета — войдём по hello
  }

  private signal(to: string, signal: VoiceSignal) {
    this.deps.send({ type: "voice_signal", roomId: this.deps.roomId, to, signal });
  }

  private enqueue(from: string, task: () => Promise<void>) {
    const prev = this.chains.get(from) ?? Promise.resolve();
    const next = prev.then(task).catch((e) => { console.warn("[voice] signal", e); });
    this.chains.set(from, next);
  }

  private ensureLink(remoteId: string, initiator: boolean): PeerLink {
    const existing = this.links.get(remoteId);
    if (existing) return existing;
    const pc = this.deps.createPeerConnection(this.rtcConfig);
    const link: PeerLink = {
      pc, polite: this.deps.myId < remoteId, makingOffer: false, ignoreOffer: false, attached: false,
      pending: [], sink: null, restartTimer: null, state: "new",
    };
    this.links.set(remoteId, link);

    pc.onicecandidate = (e) => this.signal(remoteId, { candidate: e.candidate ? (e.candidate.toJSON?.() ?? (e.candidate as RTCIceCandidateInit)) : null });
    pc.ontrack = (e) => {
      const stream = e.streams?.[0] ?? new MediaStream([e.track]);
      link.sink?.close();
      link.sink = this.deps.playStream(remoteId, stream);
      link.sink.setMuted(this.snapshot.deafened);
    };
    pc.onnegotiationneeded = async () => {
      try {
        link.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) this.signal(remoteId, { description: { type: pc.localDescription.type as "offer", sdp: pc.localDescription.sdp } });
      } catch (e) {
        console.warn("[voice] offer", e);
      } finally {
        link.makingOffer = false;
      }
    };
    pc.onconnectionstatechange = () => this.onLinkState(remoteId, link);

    if (initiator) {
      const track = this.local?.getAudioTracks()[0];
      if (track) pc.addTrack(track, this.local!);
      else pc.addTransceiver("audio", { direction: "recvonly" }); // слушатель: принимаем звук, сами молчим
      link.attached = true;
    }
    return link;
  }

  /** Отвечающая сторона: свой микрофон кладём в трансивер, созданный чужим offer (без лишней пересогласовки). */
  private attachAsResponder(link: PeerLink) {
    if (link.attached) return;
    link.attached = true;
    const tr = link.pc.getTransceivers().find((t) => t.currentDirection !== "stopped" && t.receiver.track?.kind === "audio");
    const track = this.local?.getAudioTracks()[0];
    if (!tr) { if (track) link.pc.addTrack(track, this.local!); return; }
    if (track) { tr.sender.replaceTrack(track); tr.direction = "sendrecv"; }
    else tr.direction = "recvonly";
  }

  /** Микрофон появился после отказа — отдаём его во все соединения (это вызовет пересогласование). */
  private attachMicToLinks() {
    const track = this.local?.getAudioTracks()[0];
    if (!track) return;
    for (const l of this.links.values()) {
      const tr = l.pc.getTransceivers().find((t) => t.currentDirection !== "stopped" && t.receiver.track?.kind === "audio");
      if (tr) { tr.sender.replaceTrack(track); if (tr.direction === "recvonly") tr.direction = "sendrecv"; }
      else l.pc.addTrack(track, this.local!);
    }
  }

  private async onSignal(from: string, signal: VoiceSignal) {
    if (!this.wanted || !this.roster.has(from)) return;
    if ("description" in signal) {
      const desc = signal.description;
      let link = this.links.get(from);
      if (!link) {
        if (desc.type !== "offer") return;
        link = this.ensureLink(from, false);
      }
      const pc = link.pc;
      const collision = desc.type === "offer" && (link.makingOffer || pc.signalingState !== "stable");
      link.ignoreOffer = !link.polite && collision;
      if (link.ignoreOffer) return;
      await pc.setRemoteDescription(desc); // при коллизии вежливая сторона откатывает свой offer неявно
      if (desc.type === "offer") {
        this.attachAsResponder(link);
        await pc.setLocalDescription();
        if (pc.localDescription) this.signal(from, { description: { type: pc.localDescription.type as "answer", sdp: pc.localDescription.sdp } });
      }
      const queued = link.pending.splice(0);
      for (const c of queued) await this.addCandidate(link, c);
      return;
    }
    const link = this.links.get(from);
    if (!link) return;
    if (!link.pc.remoteDescription) { link.pending.push(signal.candidate); return; } // SDP ещё не пришёл — не теряем
    await this.addCandidate(link, signal.candidate);
  }

  private async addCandidate(link: PeerLink, c: RTCIceCandidateInit | null) {
    try {
      await link.pc.addIceCandidate(c ?? undefined);
    } catch (e) {
      if (!link.ignoreOffer) console.warn("[voice] candidate", e);
    }
  }

  private onLinkState(remoteId: string, link: PeerLink) {
    if (this.links.get(remoteId) !== link) return;
    const st = link.pc.connectionState;
    link.state = st;
    if (link.restartTimer) { clearTimeout(link.restartTimer); link.restartTimer = null; }
    if (st === "failed") link.pc.restartIce?.();
    if (st === "disconnected") {
      // кратковременный обрыв сети: подождать, затем перезапустить ICE
      link.restartTimer = setTimeout(() => { if (link.pc.connectionState === "disconnected") link.pc.restartIce?.(); }, 3000);
    }
    this.update();
  }

  private closeLink(remoteId: string) {
    const l = this.links.get(remoteId);
    if (!l) return;
    this.links.delete(remoteId);
    this.chains.delete(remoteId);
    if (l.restartTimer) clearTimeout(l.restartTimer);
    l.pc.onicecandidate = null;
    l.pc.ontrack = null;
    l.pc.onnegotiationneeded = null;
    l.pc.onconnectionstatechange = null;
    l.pc.close();
    l.sink?.close();
  }

  private closeAllLinks() {
    [...this.links.keys()].forEach((id) => this.closeLink(id));
  }

  private teardown() {
    this.closeAllLinks();
    this.releaseMic();
    this.update({ speaking: false });
  }

  /** Диагностика для e2e и отладки: состояние и счётчики аудио по каждому собеседнику. */
  async stats() {
    const out: Record<string, { state: LinkState; bytesReceived: number; bytesSent: number; packetsReceived: number; audioLevel: number | null }> = {};
    for (const [id, l] of this.links) {
      let bytesReceived = 0; let bytesSent = 0; let packetsReceived = 0; let audioLevel: number | null = null;
      try {
        const report = await l.pc.getStats();
        report.forEach((s: RTCStats & Record<string, number>) => {
          if (s.type === "inbound-rtp" && (s as unknown as { kind?: string }).kind === "audio") {
            bytesReceived += s.bytesReceived ?? 0; packetsReceived += s.packetsReceived ?? 0;
            if (typeof s.audioLevel === "number") audioLevel = s.audioLevel;
          }
          if (s.type === "outbound-rtp" && (s as unknown as { kind?: string }).kind === "audio") bytesSent += s.bytesSent ?? 0;
        });
      } catch { /* соединение закрыто */ }
      out[id] = { state: l.state, bytesReceived, bytesSent, packetsReceived, audioLevel };
    }
    return out;
  }
}
