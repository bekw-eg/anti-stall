import { useEffect, useRef, useState } from "react";
import { TomatoClient, TomatoSocket } from "@/api/tomato";
import type { RoomSnapshot, ServerEvent } from "@/api/tomato";

/**
 * Тонкий React-адаптер над TomatoClient: серверный снимок комнаты + оставшееся время,
 * пересчитываемое локально от серверной метки phaseEndsAt (а не от клиентских часов).
 * Любой новый дизайн может использовать этот хук или написать свой поверх api/tomato.
 */
export function useTomatoRoom(client: TomatoClient, roomId: string | null) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [events, setEvents] = useState<ServerEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const socketRef = useRef<TomatoSocket | null>(null);

  useEffect(() => {
    if (!roomId) return;
    let alive = true;
    client.room(roomId).then((s) => alive && setSnapshot(s)).catch(() => undefined);

    const socket = client.connect();
    socketRef.current = socket;
    socket.subscribe(roomId);
    socket.on("hello", () => setConnected(true));
    socket.on("disconnected", () => setConnected(false));
    // room_state приходит после каждого значимого изменения и при (пере)подписке
    socket.on("room_state", (ev) => ev.roomId === roomId && setSnapshot(ev.data as RoomSnapshot));
    socket.on("*", (ev) => {
      // Личные изменения (награда, покупка) не меняют состояние комнаты — подтягиваем свежий снимок с блоком me
      if (ev.type === "balance_changed" || ev.type === "reward_granted") {
        client.room(roomId).then((s) => alive && setSnapshot(s)).catch(() => undefined);
      }
      if (["reward_granted", "session_completed", "achievement_unlocked", "help_applied", "prank_applied", "challenge_completed"].includes(ev.type)) {
        setEvents((prev) => [...prev.slice(-49), ev]);
      }
    });
    return () => {
      alive = false;
      socket.close();
      socketRef.current = null;
    };
  }, [client, roomId]);

  useEffect(() => {
    const ends = snapshot?.room.phaseEndsAt ?? null;
    if (ends === null) return setRemainingMs(null);
    const tick = () => setRemainingMs(Math.max(0, ends - (socketRef.current?.serverNow() ?? Date.now())));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [snapshot?.room.phaseEndsAt]);

  return { snapshot, remainingMs, connected, events };
}
