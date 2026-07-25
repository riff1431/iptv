import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

// Simulate the real supabase-js constraint that fails when two consumers
// share a channel name: calling `.on("postgres_changes", ...)` after
// `.subscribe()` throws, which is what tripped the root error boundary.
type Chan = {
  name: string;
  subscribed: boolean;
  unsubscribed: boolean;
  removed: boolean;
  on: (event: string, filter: unknown, cb: unknown) => Chan;
  subscribe: () => Chan;
  unsubscribe: () => Promise<{ error: null }>;
};

const channelsByName = new Map<string, Chan>();
const allChannels: Chan[] = [];

function getOrCreateChannel(name: string): Chan {
  const existing = channelsByName.get(name);
  if (existing) return existing;
  const chan: Chan = {
    name,
    subscribed: false,
    unsubscribed: false,
    removed: false,
    on(event: string) {
      if (this.subscribed) {
        throw new Error(
          `cannot add \`${event}\` callbacks for realtime:${name} after \`subscribe()\`.`,
        );
      }
      return this;
    },
    subscribe() {
      this.subscribed = true;
      return this;
    },
    unsubscribe() {
      this.unsubscribed = true;
      return Promise.resolve({ error: null });
    },
  };
  channelsByName.set(name, chan);
  allChannels.push(chan);
  return chan;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: (name: string) => getOrCreateChannel(name),
    removeChannel: (chan: Chan) => {
      chan.removed = true;
      channelsByName.delete(chan.name);
      return Promise.resolve("ok");
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: { id: "user-1", display_name: "Test", avatar_url: null },
              error: null,
            }),
        }),
      }),
    }),
  },
}));

import { useProfile } from "./useProfile";

function Consumer({ label }: { label: string }) {
  const { displayName } = useProfile();
  return <div data-testid={label}>{displayName}</div>;
}

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

describe("useProfile realtime subscription", () => {
  beforeEach(() => {
    channelsByName.clear();
    allChannels.length = 0;
  });
  afterEach(() => cleanup());

  it("shares a single realtime channel across multiple consumers for the same user", async () => {
    // Prior bug: each consumer built its own channel with the same name and
    // the second `.on()` threw. Fixed by (a) unique names and (b) a shared
    // ref-counted channel per userId — this test asserts the ref-count path:
    // three consumers, exactly one channel, no throws.
    expect(() =>
      render(
        wrap(
          <>
            <Consumer label="header" />
            <Consumer label="nav" />
            <Consumer label="dropdown" />
          </>,
        ),
      ),
    ).not.toThrow();

    await waitFor(() => {
      expect(allChannels.length).toBe(1);
    });
    expect(allChannels[0].name).toBe("profile:user-1");
    expect(allChannels[0].subscribed).toBe(true);
  });

  it("keeps the shared channel alive until the last consumer unmounts", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Tree = ({ showA }: { showA: boolean }) => (
      <QueryClientProvider client={qc}>
        {showA ? <Consumer label="a" /> : null}
        <Consumer label="b" />
      </QueryClientProvider>
    );
    const { rerender } = render(<Tree showA />);
    await waitFor(() => expect(allChannels.length).toBe(1));
    const chan = allChannels[0];

    // Unmount one consumer — channel must stay up (still one ref).
    await act(async () => {
      rerender(<Tree showA={false} />);
    });
    expect(chan.unsubscribed).toBe(false);
    expect(chan.removed).toBe(false);

    // Unmount the last consumer — channel tears down.
    await act(async () => {
      rerender(
        <QueryClientProvider client={qc}>
          <></>
        </QueryClientProvider>,
      );
    });
    await waitFor(() => {
      expect(chan.unsubscribed).toBe(true);
      expect(chan.removed).toBe(true);
    });
  });



  it("unsubscribes and removes the channel on unmount", async () => {
    const { unmount } = render(wrap(<Consumer label="solo" />));
    await waitFor(() => expect(allChannels.length).toBe(1));
    const chan = allChannels[0];

    await act(async () => {
      unmount();
    });

    await waitFor(() => {
      expect(chan.unsubscribed).toBe(true);
      expect(chan.removed).toBe(true);
    });
  });
});
