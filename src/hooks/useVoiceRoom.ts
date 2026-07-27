import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, ConnectionState } from "livekit-client";
import { getVoiceToken } from "@/lib/voice-token.functions";

/**
 * LiveKit voice room controller for a lounge or match.
 *
 * - `connect()` mints a short-lived token (server-side, auth-gated) and connects
 *   a LiveKit `Room`. LiveKit auto-renders remote audio, so once connected the
 *   user hears everyone else with no manual <audio> wiring.
 * - The user joins *muted* and must explicitly enable their mic to speak
 *   (prevents 50 people blasting audio on entry).
 * - `toggleMic()` publishes / unpublishes the local microphone track.
 *
 * `roomName` is the lounge or match id; rooms are created on demand by LiveKit.
 */
export type VoiceStatus = "idle" | "connecting" | "connected" | "error";

export function useVoiceRoom(roomName: string | null, identity?: string) {
  const roomRef = useRef<Room | null>(null);
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [micEnabled, setMicEnabled] = useState(false);
  const [participantCount, setParticipantCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const countParticipants = useCallback((r: Room) => {
    setParticipantCount(r.remoteParticipants.size + 1);
  }, []);

  const connect = useCallback(
    async (): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!roomName || roomRef.current) return { ok: false, error: "No room" };
      setStatus("connecting");
      setError(null);
      try {
        const { url, token } = await getVoiceToken({
          data: { room: roomName, identity },
        });
        const room = new Room({ adaptiveStream: true, dynacast: true });
        room.on(RoomEvent.ParticipantConnected, () => countParticipants(room));
        room.on(RoomEvent.ParticipantDisconnected, () => countParticipants(room));
        room.on(RoomEvent.Disconnected, () => {
          roomRef.current = null;
          setStatus("idle");
          setMicEnabled(false);
          setParticipantCount(0);
        });
        roomRef.current = room;
        await room.connect(url, token);
        setStatus("connected");
        countParticipants(room);
        // Join muted — the user explicitly unmutes to speak.
        setMicEnabled(false);
        return { ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to join voice chat";
        setError(msg);
        setStatus("error");
        const r = roomRef.current;
        if (r) {
          void r.disconnect();
          roomRef.current = null;
        }
        return { ok: false, error: msg };
      }
    },
    [roomName, identity, countParticipants],
  );

  const disconnect = useCallback(async () => {
    const r = roomRef.current;
    if (!r) return;
    await r.disconnect();
    roomRef.current = null;
    setStatus("idle");
    setMicEnabled(false);
    setParticipantCount(0);
  }, []);

  const toggleMic = useCallback(
    async (): Promise<{ ok: true; enabled: boolean } | { ok: false; error: string }> => {
      const r = roomRef.current;
      if (!r || r.state !== ConnectionState.Connected) {
        return { ok: false, error: "Join voice first" };
      }
      const next = !micEnabled;
      try {
        await r.localParticipant.setMicrophoneEnabled(next);
        setMicEnabled(next);
        setError(null);
        return { ok: true, enabled: next };
      } catch (e) {
        // setMicrophoneEnabled rejects when the user denies mic permission or
        // there is no capture device available.
        const msg = e instanceof Error ? e.message : "Microphone unavailable";
        setError(msg);
        return { ok: false, error: msg };
      }
    },
    [micEnabled],
  );

  // Tear down the room if the component unmounts while connected.
  useEffect(() => {
    return () => {
      const r = roomRef.current;
      if (r) void r.disconnect();
      roomRef.current = null;
    };
  }, []);

  return {
    status,
    isConnected: status === "connected",
    isConnecting: status === "connecting",
    micEnabled,
    participantCount,
    error,
    connect,
    disconnect,
    toggleMic,
  };
}
