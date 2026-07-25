import { useEffect, useState } from "react";

/**
 * Simulates gentle live fluctuations for viewer counts and status flags
 * so the UI has something to smoothly animate between until real
 * realtime data is wired in. Returns a monotonically increasing tick and
 * a stable "jitter" function that produces a small delta for a given key.
 */
export function useLiveTick(intervalMs = 5000) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return tick;
}

// Deterministic pseudo-random per (key, tick) so numbers change smoothly
// but every client renders the same value at the same tick.
function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

export function liveViewers(baseCount: number, key: string, tick: number) {
  // ±3% drift, capped
  const drift = (hash(`${key}:${tick}`) - 0.5) * 0.06;
  const next = Math.max(0, Math.round(baseCount * (1 + drift)));
  return next;
}

export function liveIsLive(key: string, tick: number) {
  // 92% chance a room stays live between ticks — occasional flickers
  return hash(`${key}:live:${tick}`) > 0.08;
}
