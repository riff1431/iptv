import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

// Mocks are declared with vi.hoisted so the factory closures (which run early)
// can reference them without "cannot access before initialization" errors.
const { toastFn, voiceState, voiceMocks, moderationMock } = vi.hoisted(() => ({
  toastFn: vi.fn(),
  voiceState: { isConnected: false, micEnabled: false },
  voiceMocks: {
    connect: vi.fn().mockResolvedValue({ ok: true as const }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    toggleMic: vi.fn().mockResolvedValue({ ok: true as const, enabled: true }),
  },
  moderationMock: vi.fn(),
}));

vi.mock("sonner", () => {
  const t = (msg: string) => toastFn(msg);
  return {
    toast: Object.assign(t, {
      success: (m: string) => toastFn(m),
      error: (m: string) => toastFn(m),
      info: (m: string) => toastFn(m),
    }),
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1" }, isAdmin: false, loading: false }),
}));

vi.mock("@/hooks/useLoungeChat", () => ({
  useLoungeChat: () => ({
    messages: [],
    loading: false,
    error: null,
    send: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/hooks/useMatchChat", () => ({
  useMatchChat: () => ({
    messages: [],
    loading: false,
    error: null,
    send: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/hooks/useVoiceRoom", () => ({
  useVoiceRoom: () => ({
    status: voiceState.isConnected ? "connected" : "idle",
    isConnected: voiceState.isConnected,
    isConnecting: false,
    micEnabled: voiceState.micEnabled,
    participantCount: 1,
    error: null,
    connect: voiceMocks.connect,
    disconnect: voiceMocks.disconnect,
    toggleMic: voiceMocks.toggleMic,
  }),
}));

vi.mock("@/lib/voice-moderation.functions", () => ({
  muteAllInVoiceRoom: moderationMock,
}));

import { ArenaActionBar } from "./ArenaActionBar";

function setVoice(overrides: Partial<{ isConnected: boolean; micEnabled: boolean }>) {
  voiceState.isConnected = overrides.isConnected ?? false;
  voiceState.micEnabled = overrides.micEnabled ?? false;
}

function renderBar(props: { isHost?: boolean; matchId?: string | null } = {}) {
  return render(
    <ArenaActionBar
      loungeId="lounge-1"
      tvs={[]}
      matchId={props.matchId ?? null}
      isHost={props.isHost ?? false}
    />,
  );
}

describe("ArenaActionBar voice wiring", () => {
  beforeEach(() => {
    toastFn.mockClear();
    voiceMocks.connect.mockClear();
    voiceMocks.disconnect.mockClear();
    voiceMocks.toggleMic.mockClear();
    moderationMock.mockClear();
    moderationMock.mockResolvedValue({ muted: 2 });
    setVoice({ isConnected: false, micEnabled: false });
  });
  afterEach(() => cleanup());

  it("Voice Chat connects and toasts success when not connected", async () => {
    setVoice({ isConnected: false });
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: /voice chat/i }));

    expect(voiceMocks.connect).toHaveBeenCalledTimes(1);
    expect(voiceMocks.disconnect).not.toHaveBeenCalled();
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith("Voice chat joined"));
  });

  it("Voice Chat disconnects when already connected", async () => {
    setVoice({ isConnected: true });
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: /leave voice/i }));

    expect(voiceMocks.disconnect).toHaveBeenCalledTimes(1);
    expect(voiceMocks.connect).not.toHaveBeenCalled();
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith("Voice chat left"));
  });

  it("Mute Mic prompts to join voice when not connected", async () => {
    setVoice({ isConnected: false });
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: /^(mute|unmute) mic$/i }));

    expect(voiceMocks.toggleMic).not.toHaveBeenCalled();
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith("Join voice chat first"));
  });

  it("Mute Mic toggles the mic when connected", async () => {
    setVoice({ isConnected: true, micEnabled: true });
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: /^(mute|unmute) mic$/i }));

    expect(voiceMocks.toggleMic).toHaveBeenCalledTimes(1);
  });

  it("Mute All is host-gated: non-hosts get a rejection and no server call", async () => {
    renderBar({ isHost: false });
    fireEvent.click(screen.getByRole("button", { name: /^mute all$/i }));

    expect(moderationMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(toastFn).toHaveBeenCalledWith("Only the host can mute everyone"),
    );
  });

  it("Mute All as host calls moderation with the right room/kind", async () => {
    renderBar({ isHost: true, matchId: "match-xyz" });
    fireEvent.click(screen.getByRole("button", { name: /^mute all$/i }));

    await waitFor(() => expect(moderationMock).toHaveBeenCalledTimes(1));
    expect(moderationMock).toHaveBeenCalledWith({
      data: { room: "match-xyz", kind: "match" },
    });
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith("Muted 2 participants"));
  });

  it("rapid double-click is debounced to a single connect call", () => {
    setVoice({ isConnected: false });
    renderBar();
    const btn = screen.getByRole("button", { name: /voice chat/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(voiceMocks.connect).toHaveBeenCalledTimes(1);
  });

  it("Leave Arena invokes the onLeave handler", () => {
    const onLeave = vi.fn();
    render(<ArenaActionBar loungeId="lounge-1" tvs={[]} onLeave={onLeave} />);
    fireEvent.click(screen.getByRole("button", { name: /leave arena/i }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});
