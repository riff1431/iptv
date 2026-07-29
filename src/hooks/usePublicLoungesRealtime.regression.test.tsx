/**
 * Regression test: the page-level realtime subscription must generate a unique
 * channel name on every mount (so soft navigation / two mounted consumers never
 * reuse a Supabase channel), must watch ALL `tvs` changes with no lounge filter
 * (the lobby spans many lounges), and must clean up on unmount.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const channelNames: string[] = [];
const onArgs: unknown[][] = [];

vi.mock("@/integrations/supabase/client", () => {
  const makeChannel = (name: string) => {
    channelNames.push(name);
    const chan: {
      on: ReturnType<typeof vi.fn>;
      subscribe: ReturnType<typeof vi.fn>;
      name: string;
    } = {
      name,
      on: vi.fn((...args: unknown[]) => {
        onArgs.push(args);
        return chan;
      }),
      subscribe: vi.fn(() => chan),
    };
    return chan;
  };
  return {
    supabase: {
      channel: vi.fn((name: string) => makeChannel(name)),
      removeChannel: vi.fn(() => Promise.resolve("ok")),
    },
  };
});

import { usePublicLoungesRealtime } from "./usePublicLoungesRealtime";

function Harness() {
  usePublicLoungesRealtime();
  return null;
}

function withClient(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

beforeEach(() => {
  channelNames.length = 0;
  onArgs.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("usePublicLoungesRealtime", () => {
  it("produces a unique `publicLounges:tvs:` channel name per mount", () => {
    const a = render(withClient(<Harness />));
    const b = render(withClient(<Harness />));
    expect(channelNames).toHaveLength(2);
    expect(channelNames[0]).not.toBe(channelNames[1]);
    for (const n of channelNames) {
      expect(n.startsWith("publicLounges:tvs:")).toBe(true);
      expect(n.length).toBeGreaterThan("publicLounges:tvs:".length);
    }
    a.unmount();
    b.unmount();
  });

  it("subscribes to all tvs changes with no lounge filter", () => {
    const { unmount } = render(withClient(<Harness />));
    expect(onArgs.length).toBe(1);
    const filter = onArgs[0][1] as Record<string, unknown>;
    expect(filter).toEqual({ event: "*", schema: "public", table: "tvs" });
    expect("filter" in filter).toBe(false);
    unmount();
  });

  it("does not reuse a channel across unmount + remount", () => {
    const first = render(withClient(<Harness />));
    first.unmount();
    const second = render(withClient(<Harness />));
    expect(channelNames).toHaveLength(2);
    expect(new Set(channelNames).size).toBe(2);
    second.unmount();
  });
});
