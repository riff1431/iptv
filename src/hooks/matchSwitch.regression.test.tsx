/**
 * Regression: switching between two matches must fully unsubscribe realtime
 * channels and re-create them for the new match, so slot preferences,
 * playlist reload, and chat state never leak from match A into match B.
 *
 * The route-level guarantee is `key={match.id}` on <MatchWatchInner /> in
 * src/routes/arena.$matchId.tsx: this forces unmount + remount, which
 * re-runs every effect below. These tests verify the effects themselves
 * clean up correctly when their `loungeId` (== match.id) changes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup, act, waitFor } from "@testing-library/react";

type Handler = (...args: unknown[]) => void;

// -----------------------------------------------------------------------------
// Mock supabase.channel to record every channel created + removed.
// -----------------------------------------------------------------------------
type FakeChannel = {
  name: string;
  removed: boolean;
  untracked: boolean;
  on: (...args: unknown[]) => FakeChannel;
  subscribe: (cb?: (status: string) => void) => FakeChannel;
  track: () => Promise<"ok">;
  untrack: () => Promise<"ok">;
  presenceState: () => Record<string, unknown>;
};

const channels: FakeChannel[] = [];

function makeChannel(name: string): FakeChannel {
  const ch: FakeChannel = {
    name,
    removed: false,
    untracked: false,
    on: () => ch,
    subscribe: (cb) => {
      cb?.("SUBSCRIBED");
      return ch;
    },
    track: async () => "ok",
    untrack: async () => {
      ch.untracked = true;
      return "ok";
    },
    presenceState: () => ({}),
  };
  channels.push(ch);
  return ch;
}

const fromBuilder = () => ({
  select: () => ({
    eq: () => ({
      order: () => ({
        limit: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  }),
  insert: () => Promise.resolve({ error: null }),
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: (name: string) => makeChannel(name),
    removeChannel: (ch: FakeChannel) => {
      ch.removed = true;
      return Promise.resolve("ok");
    },
    from: () => fromBuilder(),
    auth: {
      getUser: async () => ({ data: { user: { id: "viewer" } } }),
    },
  },
}));

import { useLoungeChat } from "./useLoungeChat";
import { useLoungePresence } from "./useLoungePresence";

beforeEach(() => {
  channels.length = 0;
});
afterEach(() => cleanup());

describe("match switch — realtime cleanup", () => {
  it("useLoungeChat removes the old channel and creates a new one when loungeId changes", async () => {
    const { rerender, unmount } = renderHook(({ id }) => useLoungeChat(id), {
      initialProps: { id: "match-A" },
    });

    // First render subscribed one chat channel scoped to match-A.
    await waitFor(() => expect(channels.length).toBe(1));
    const first = channels[0];
    expect(first.name.startsWith("chat:match-A:")).toBe(true);
    expect(first.removed).toBe(false);

    // Switch to a different match — the effect must tear down and re-create.
    act(() => rerender({ id: "match-B" }));
    await waitFor(() => expect(channels.length).toBe(2));

    expect(first.removed).toBe(true); // old channel unsubscribed
    const second = channels[1];
    expect(second.name.startsWith("chat:match-B:")).toBe(true);
    expect(second.removed).toBe(false);

    // Unmount cleans up the current channel too.
    unmount();
    await waitFor(() => expect(second.removed).toBe(true));
  });

  it("useLoungePresence untracks + removes the old channel and joins a new one when loungeId changes", async () => {
    const { rerender, unmount } = renderHook(({ id }) => useLoungePresence(id), {
      initialProps: { id: "match-A" },
    });

    await waitFor(() => expect(channels.length).toBe(1));
    const first = channels[0];
    expect(first.name.startsWith("presence:lounge:match-A:")).toBe(true);

    act(() => rerender({ id: "match-B" }));
    await waitFor(() => expect(channels.length).toBe(2));

    expect(first.untracked).toBe(true);
    expect(first.removed).toBe(true);
    const second = channels[1];
    expect(second.name.startsWith("presence:lounge:match-B:")).toBe(true);
    expect(second.removed).toBe(false);

    unmount();
    await waitFor(() => expect(second.removed).toBe(true));
  });

  it("switching back to the original match creates a fresh channel (no stale reuse)", async () => {
    const { rerender } = renderHook(({ id }) => useLoungeChat(id), {
      initialProps: { id: "match-A" },
    });

    await waitFor(() => expect(channels.length).toBe(1));
    act(() => rerender({ id: "match-B" }));
    await waitFor(() => expect(channels.length).toBe(2));
    act(() => rerender({ id: "match-A" }));
    await waitFor(() => expect(channels.length).toBe(3));

    // Every prior channel is removed; only the current one is live.
    expect(channels[0].removed).toBe(true);
    expect(channels[1].removed).toBe(true);
    expect(channels[2].removed).toBe(false);
    // Channel names are uniquified so back-to-A does not collide with the first A.
    expect(channels[0].name).not.toBe(channels[2].name);
  });
});

// -----------------------------------------------------------------------------
// Route-level contract: MatchWatchInner is keyed by match.id, so switching
// matchId in the URL forces a full unmount/remount (which is what actually
// resets activeSlot, initialized, reloadKey, chat panel, and re-runs the
// postgres subscription effect).
// -----------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("match switch — route resets on matchId change", () => {
  it("arena.$matchId route keys the inner component by match.id", () => {
    const src = readFileSync(resolve(__dirname, "../routes/arena.$matchId.tsx"), "utf8");
    // The key prop is the mechanism that forces a fresh mount when the URL
    // param changes; removing it would silently break every reset guarantee.
    expect(src).toMatch(/<MatchWatchInner\s+key=\{match\.id\}/);
    // Realtime postgres subscription must be scoped to the current matchId
    // and cleaned up on unmount.
    expect(src).toMatch(/supabase\.removeChannel\(channel\)/);
    expect(src).toMatch(/`arena-match-\$\{matchId\}/);
  });
});
