import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Realtime viewer count for a lounge via Supabase presence.
 *
 * Every mounted tab tracks itself on `presence:lounge:<id>` and the hook
 * returns the current member count across all tabs. Falls back to `null`
 * before the channel is joined so callers can show a shimmer or a baseline.
 *
 * Cleanup contract (regression-guarded):
 *  - Each mount joins a uniquely-named channel so `.on('presence', …)` can
 *    never land on an already-subscribed shared instance (which throws
 *    "cannot add `presence` callbacks after `subscribe()`").
 *  - Unmount always removes the channel — even if the SUBSCRIBED callback
 *    is still in flight — so the socket doesn't accumulate zombie
 *    subscriptions across StrictMode double-invokes, route changes, or
 *    prop-driven `loungeId` swaps.
 *  - State updates and post-subscribe `track()` are gated behind a
 *    `cancelled` flag so unmount can't trigger a React "set state on
 *    unmounted component" warning or leak an untracked presence entry.
 *
 * Debug logging:
 *  Enabled in dev builds automatically, or on demand in any build by
 *  setting `localStorage.LOUNGE_PRESENCE_DEBUG = '1'` (persist across
 *  reloads) or `window.__LOUNGE_PRESENCE_DEBUG__ = true` (session only).
 *  Logs subscribe/status transitions, track/untrack, presence sync counts,
 *  and unmount teardown — enough to diagnose "why did the viewer count go
 *  stale" or "did this channel actually close?" without leaving noise in
 *  production consoles.
 */

function isDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    // Explicit opt-in wins in every environment (including prod builds
    // when reproducing a customer issue).
    if ((window as unknown as { __LOUNGE_PRESENCE_DEBUG__?: boolean })
      .__LOUNGE_PRESENCE_DEBUG__) {
      return true;
    }
    if (window.localStorage?.getItem("LOUNGE_PRESENCE_DEBUG") === "1") {
      return true;
    }
  } catch {
    /* private mode / storage disabled — fall through */
  }
  // Vite injects import.meta.env.DEV; be defensive in case the hook runs
  // in an environment (tests, SSR shim) where it's absent.
  return Boolean(
    (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV,
  );
}

function makeLogger(scope: string) {
  const enabled = isDebugEnabled();
  return (event: string, extra?: Record<string, unknown>) => {
    if (!enabled) return;
    // eslint-disable-next-line no-console
    console.debug(
      `[useLoungePresence] ${event}`,
      { scope, t: performance.now().toFixed(1), ...(extra ?? {}) },
    );
  };
}

export function useLoungePresence(loungeId: string | null | undefined) {
  const [viewerCount, setViewerCount] = useState<number | null>(null);

  useEffect(() => {
    if (!loungeId) return;

    const key =
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

    const channelName = `presence:lounge:${loungeId}:${key}`;
    const log = makeLogger(channelName);

    const channel = supabase.channel(channelName, {
      config: { presence: { key } },
    });

    let cancelled = false;
    let subscribed = false;
    let tracked = false;

    log("mount", { loungeId, key });

    channel.on("presence", { event: "sync" }, () => {
      if (cancelled) {
        log("sync-after-cancel-ignored");
        return;
      }
      try {
        const state = channel.presenceState();
        const count = Object.keys(state).length;
        setViewerCount(count);
        log("sync", { count });
      } catch (err) {
        log("sync-error", { err: (err as Error)?.message });
      }
    });

    channel.on("presence", { event: "join" }, (payload) => {
      log("join", { key: (payload as { key?: string })?.key });
    });
    channel.on("presence", { event: "leave" }, (payload) => {
      log("leave", { key: (payload as { key?: string })?.key });
    });

    log("subscribe:begin");
    channel.subscribe(async (status) => {
      log("subscribe:status", { status });
      if (cancelled) {
        log("subscribe:status-after-cancel-ignored", { status });
        return;
      }
      if (status !== "SUBSCRIBED") return;
      subscribed = true;
      try {
        await channel.track({ joined_at: new Date().toISOString() });
        tracked = true;
        log("track:ok");
      } catch (err) {
        log("track:error", { err: (err as Error)?.message });
      }
    });

    return () => {
      cancelled = true;
      log("unmount:begin", { subscribed, tracked });
      try {
        const p = channel.untrack();
        log("untrack:issued");
        void Promise.resolve(p)
          .then(() => log("untrack:ok"))
          .catch((err) => log("untrack:error", { err: (err as Error)?.message }));
      } catch (err) {
        log("untrack:threw", { err: (err as Error)?.message });
      }
      void Promise.resolve(supabase.removeChannel(channel))
        .then((res) => log("removeChannel:ok", { result: String(res) }))
        .catch((err) =>
          log("removeChannel:error", { err: (err as Error)?.message }),
        );
    };
  }, [loungeId]);

  return viewerCount;
}
