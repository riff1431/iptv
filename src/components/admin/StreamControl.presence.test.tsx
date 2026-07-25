/**
 * Integration test: mounting multiple <StreamControl /> instances that share
 * the same loungeId must not trigger Supabase's "cannot add `presence`
 * callbacks after `subscribe()`" error. Regression guard for the channel-
 * reuse bug fixed in `useLoungePresence` (each mount now uses a unique
 * channel name).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act, waitFor } from "@testing-library/react";

// ---- Fake Supabase realtime -----------------------------------------------
//
// Mimics the real client's contract precisely enough to catch the bug:
//  - `supabase.channel(name)` reuses the instance for a duplicate name
//  - `.on('presence', ...)` on a subscribed channel throws
//  - `.subscribe()` fires the SUBSCRIBED callback synchronously
//  - `.presenceState()` reflects tracked members keyed by presence key

type PresenceCb = (payload: unknown) => void;

class FakeChannel {
  name: string;
  presenceKey: string;
  subscribed = false;
  presenceCbs: PresenceCb[] = [];
  presence: Record<string, unknown[]> = {};
  postgresCbs: unknown[] = [];

  constructor(name: string, presenceKey: string) {
    this.name = name;
    this.presenceKey = presenceKey;
  }

  on(kind: string, _filter: unknown, cb?: PresenceCb) {
    if (kind === "presence") {
      if (this.subscribed) {
        throw new Error(
          "tried to add 'presence' callback after subscribe()",
        );
      }
      // Signature in real client is .on('presence', { event }, cb)
      if (typeof _filter === "object" && cb) this.presenceCbs.push(cb);
    } else if (kind === "postgres_changes") {
      this.postgresCbs.push(cb);
    }
    return this;
  }

  subscribe(cb?: (status: string) => void) {
    this.subscribed = true;
    cb?.("SUBSCRIBED");
    return this;
  }

  async track(payload: unknown) {
    this.presence[this.presenceKey] = [payload];
    for (const cb of this.presenceCbs) cb({ event: "sync" });
  }

  presenceState() {
    return this.presence;
  }
}

const { channelRegistry, fakeSupabase } = vi.hoisted(() => {
  const registry = new Map<string, FakeChannel>();
  return {
    channelRegistry: registry,
    fakeSupabase: {
      channel: (
        name: string,
        opts?: { config?: { presence?: { key?: string } } },
      ) => {
        const existing = registry.get(name);
        if (existing) return existing;
        const key = opts?.config?.presence?.key ?? "anon";
        const ch = new FakeChannel(name, key);
        registry.set(name, ch);
        return ch;
      },
      removeChannel: (ch: FakeChannel) => {
        registry.delete(ch.name);
        return Promise.resolve("ok");
      },
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
      },
    },
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: fakeSupabase,
}));

// Server-fn wrappers: return no-op stubs so StreamControl mounts cleanly.
vi.mock("@tanstack/react-start", () => ({
  useServerFn: () => vi.fn(async () => ({ session: null, recent: [] })),
}));

vi.mock("@/lib/stream-admin.functions", () => ({
  startLoungeStream: () => {},
  stopLoungeStream: () => {},
  switchChannel: () => {},
  getStreamHealth: () => {},
}));

vi.mock("@/components/admin/AdminTvPreviewDialog", () => ({
  AdminTvPreviewDialog: () => null,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// Import after mocks are registered.
import { StreamControl } from "./StreamControl";

const baseProps = (tvId: string, slot: number) => ({
  tvId,
  slot,
  displayName: `TV ${slot}`,
  loungeId: "lounge-shared",
  hasChannel: false,
  currentChannelId: null,
});

describe("StreamControl — multi-mount presence integration", () => {
  beforeEach(() => {
    channelRegistry.clear();
    // Deterministic per-mount presence keys so we can assert distinct names.
    let n = 0;
    vi.stubGlobal("crypto", {
      ...globalThis.crypto,
      randomUUID: () => `uuid-${++n}`,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("mounts four StreamControls on one lounge without channel-reuse errors", async () => {
    const onError = vi.fn();

    await act(async () => {
      render(
        <div onError={onError}>
          <StreamControl {...baseProps("tv-1", 1)} />
          <StreamControl {...baseProps("tv-2", 2)} />
          <StreamControl {...baseProps("tv-3", 3)} />
          <StreamControl {...baseProps("tv-4", 4)} />
        </div>,
      );
    });

    // Each presence subscription must land on its own uniquely-named channel;
    // otherwise .on('presence', …) would have thrown on the 2nd–4th mounts.
    const presenceChannels = [...channelRegistry.keys()].filter((n) =>
      n.startsWith("presence:lounge:lounge-shared:"),
    );
    expect(presenceChannels).toHaveLength(4);
    expect(new Set(presenceChannels).size).toBe(4);

    for (const name of presenceChannels) {
      const ch = channelRegistry.get(name)!;
      expect(ch.subscribed).toBe(true);
      expect(ch.presenceCbs.length).toBeGreaterThan(0);
      // track() ran on SUBSCRIBED — presence state reflects this member.
      expect(Object.keys(ch.presence)).toHaveLength(1);
    }

    expect(onError).not.toHaveBeenCalled();
  });

  it("presence sync events fan out per mount without cross-mount interference", async () => {
    await act(async () => {
      render(
        <>
          <StreamControl {...baseProps("tv-1", 1)} />
          <StreamControl {...baseProps("tv-2", 2)} />
        </>,
      );
    });

    const presenceChannels = [...channelRegistry.values()].filter((c) =>
      c.name.startsWith("presence:lounge:lounge-shared:"),
    );
    expect(presenceChannels).toHaveLength(2);

    // Simulate a fresh presence sync on each channel — none should throw
    // (which would happen if the shared channel had been re-.on()'d after
    // subscribe).
    await waitFor(() => {
      for (const ch of presenceChannels) {
        expect(() =>
          ch.presenceCbs.forEach((cb) => cb({ event: "sync" })),
        ).not.toThrow();
      }
    });
  });
});
