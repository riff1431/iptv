/**
 * Regression test: realtime subscription hooks must generate a unique channel
 * name on every mount so soft navigation (unmount + remount, or two mounted
 * consumers) never reuses a Supabase channel. Reusing a channel triggers
 * "cannot add callbacks after `subscribe()`" errors that bubble up to the
 * root ErrorComponent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const channelNames: string[] = [];

vi.mock("@/integrations/supabase/client", () => {
  const makeChannel = (name: string) => {
    channelNames.push(name);
    const chan: any = {
      name,
      on: vi.fn(() => chan),
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

import { useAdScheduleRealtime } from "./useAdScheduleRealtime";

function Harness() {
  useAdScheduleRealtime();
  return null;
}

function withClient(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

beforeEach(() => {
  channelNames.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("useAdScheduleRealtime channel naming", () => {
  it("produces a unique channel name for each mount", () => {
    const a = render(withClient(<Harness />));
    const b = render(withClient(<Harness />));

    expect(channelNames).toHaveLength(2);
    expect(channelNames[0]).not.toBe(channelNames[1]);
    for (const n of channelNames) {
      expect(n.startsWith("ad_schedules:global:")).toBe(true);
      expect(n.length).toBeGreaterThan("ad_schedules:global:".length);
    }

    a.unmount();
    b.unmount();
  });

  it("does not reuse the channel across soft navigation (unmount + remount)", () => {
    const first = render(withClient(<Harness />));
    first.unmount();
    const second = render(withClient(<Harness />));

    expect(channelNames).toHaveLength(2);
    expect(new Set(channelNames).size).toBe(2);

    second.unmount();
  });
});
