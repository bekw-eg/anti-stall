import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { TomatoClient, TomatoSocket } from "@/api/tomato";
import { createLevelMeter, getMicrophone, playStream, voiceSupported } from "./browser";
import { VoiceClient, type VoiceSnapshot } from "./VoiceClient";

const IDLE: VoiceSnapshot = { status: "idle", mic: "unknown", muted: false, deafened: false, speaking: false, peers: [], links: {}, error: null, relay: false };
const noopSubscribe = () => () => undefined;
const idleSnapshot = () => IDLE;

declare global {
  interface Window { __antistallVoice?: { snapshot: () => VoiceSnapshot; stats: () => Promise<unknown> } }
}

/**
 * Голос комнаты для React. Клиент живёт, пока открыта комната; в голос пользователь входит сам —
 * таймер и комната работают и без звука.
 */
export function useVoice(api: TomatoClient, socket: TomatoSocket | null, roomId: string | null, myId: string | undefined) {
  const [vc, setVc] = useState<VoiceClient | null>(null);
  const supported = voiceSupported();

  useEffect(() => {
    if (!socket || !roomId || !myId || !supported) return;
    const client = new VoiceClient({
      roomId, myId,
      send: (m) => socket.sendRaw(m),
      getUserMedia: getMicrophone,
      createPeerConnection: (cfg) => new RTCPeerConnection(cfg),
      playStream,
      createLevelMeter,
    });
    const off = socket.on("*", (ev) => client.handleEvent(ev)); // включая hello / disconnected
    setVc(client);
    // кто уже в голосе (voice_roster мог прийти до того, как мы начали слушать сокет)
    api.voicePeers(roomId).then((r) => client.setRoster(r.peers)).catch(() => undefined);
    window.__antistallVoice = { snapshot: client.getSnapshot, stats: () => client.stats() };
    // закрыли вкладку — соединения закроются вместе со страницей, сервер увидит обрыв сокета
    return () => {
      off();
      client.dispose();
      setVc(null);
      if (window.__antistallVoice?.snapshot === client.getSnapshot) delete window.__antistallVoice;
    };
  }, [api, socket, roomId, myId, supported]);

  const state = useSyncExternalStore(vc ? vc.subscribe : noopSubscribe, vc ? vc.getSnapshot : idleSnapshot);

  const join = useCallback(() => { vc?.join(); }, [vc]);
  const leave = useCallback(() => { vc?.leave(); }, [vc]);
  const toggleMute = useCallback(() => {
    if (!vc) return;
    // включить микрофон в режиме «оглушён» = вернуть и звук (как в привычных голосовых чатах)
    if (state.deafened) { vc.setDeafened(false); vc.setMuted(false); return; }
    // нет доступа к микрофону — повторно спрашиваем разрешение
    vc.setMuted(state.mic === "granted" && !state.muted);
  }, [vc, state.deafened, state.mic, state.muted]);
  const toggleDeafen = useCallback(() => { vc?.setDeafened(!state.deafened); }, [vc, state.deafened]);

  const inVoice = state.status !== "idle";
  const micOn = state.mic === "granted" && !state.muted && !state.deafened;
  return { ...state, supported, ready: Boolean(vc), inVoice, micOn, join, leave, toggleMute, toggleDeafen };
}

export type Voice = ReturnType<typeof useVoice>;
