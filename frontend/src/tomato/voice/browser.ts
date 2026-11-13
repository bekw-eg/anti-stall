import type { AudioSink, LevelMeter } from "./VoiceClient";

/** Браузерные реализации зависимостей VoiceClient. */

export const voiceSupported = () =>
  typeof window !== "undefined" &&
  typeof RTCPeerConnection !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia);

export function getMicrophone() {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
}

/** Звук собеседника: невидимый <audio>. В Chrome удалённый поток играет только через медиа-элемент. */
export function playStream(userId: string, stream: MediaStream): AudioSink {
  const el = document.createElement("audio");
  el.autoplay = true;
  el.dataset.voicePeer = userId;
  el.style.display = "none";
  el.srcObject = stream;
  document.body.appendChild(el);
  el.play().catch(() => undefined); // автоплей разрешён: вход в голос — действие пользователя
  return {
    setMuted: (m) => { el.muted = m; },
    close: () => { el.pause(); el.srcObject = null; el.remove(); },
  };
}

/** Громкость микрофона (RMS) через WebAudio — для индикатора «говорит». */
export function createLevelMeter(stream: MediaStream): LevelMeter | null {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  ctx.resume().catch(() => undefined);
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048; // ≈ 43 мс звука на замер
  src.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  return {
    level() {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      return Math.sqrt(sum / buf.length);
    },
    close() {
      src.disconnect();
      ctx.close().catch(() => undefined);
    },
  };
}
