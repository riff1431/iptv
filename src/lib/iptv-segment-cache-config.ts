// Shared IPTV segment-cache configuration for BOTH relay implementations:
//   - src/lib/stream-session.server.ts        (Sports Arena flow)
//   - src/lib/global-iptv-relay.server.ts     (public /iptv/:channelId flow)
//
// This module exists so the two flows can never drift apart again. Diverging
// cache limits (the public relay silently stayed on an 8 MiB item cap while the
// Arena relay was raised to 50 MiB) previously caused HD segments to 502 on the
// public flow — see docs/iptv-production-root-cause.md.

function envInt(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

// Floors that protect production from stale, too-small env values carried over
// from older deployments (e.g. IPTV_SEGMENT_CACHE_ITEM_MAX_BYTES=8388608).
const FORCED_ITEM_MAX_BYTES = 52_428_800; // 50 MB — supports high-bitrate HD/4K segments
const FORCED_TOTAL_MAX_BYTES = 524_288_000; // 500 MB

export type IptvSegmentCacheConfig = {
  ttlMs: number;
  itemMaxBytes: number;
  totalMaxBytes: number;
};

/**
 * Resolve the segment-cache limits from env, applying the 50 MB / 500 MB floors
 * unless `IPTV_SEGMENT_CACHE_DISABLE_FLOOR=1` (tests that need to exercise
 * eviction at small limits). Production never sets the escape hatch.
 */
export function getIptvSegmentCacheConfig(): IptvSegmentCacheConfig {
  const disableFloor = process.env.IPTV_SEGMENT_CACHE_DISABLE_FLOOR === "1";
  let totalMaxBytes = envInt(
    "IPTV_SEGMENT_CACHE_TOTAL_MAX_BYTES",
    FORCED_TOTAL_MAX_BYTES,
    1_048_576,
    1024 * 1024 * 1024, // 1 GB max
  );
  let itemMaxBytes = envInt(
    "IPTV_SEGMENT_CACHE_ITEM_MAX_BYTES",
    FORCED_ITEM_MAX_BYTES,
    64_000,
    128 * 1024 * 1024, // 128 MB max
  );

  // Force override any small env variables from old deployments.
  if (!disableFloor) {
    if (itemMaxBytes < FORCED_ITEM_MAX_BYTES) itemMaxBytes = FORCED_ITEM_MAX_BYTES;
    if (totalMaxBytes < FORCED_TOTAL_MAX_BYTES) totalMaxBytes = FORCED_TOTAL_MAX_BYTES;
  }

  return {
    ttlMs: envInt("IPTV_SEGMENT_CACHE_TTL_MS", 20_000, 1_000, 120_000),
    itemMaxBytes: Math.min(itemMaxBytes, totalMaxBytes),
    totalMaxBytes,
  };
}
