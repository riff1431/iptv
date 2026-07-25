// Shared IPTV stream session — single upstream connection per TV, fanned out
// to unlimited viewers. Concurrent viewer requests within TTL share one
// cached playlist body; only one caller in flight actually hits upstream.
//
// The IPTV provider therefore sees ~1 playlist poll per target-duration and
// ~1 GET per unique segment per Worker isolate.
//
// Cross-isolate sharing is out of scope for this pass (see plan §6).

import { resolveStreamUrl, type IptvCredentials } from "@/lib/iptv-client.server";
import { decryptSecret } from "@/lib/iptv-crypto.server";
import { rewritePlaylist } from "@/lib/iptv-proxy.server";

type PlaylistEntry = {
  fetchedAt: number;
  upstreamUrl: string;
  rewritten: string;
  channelId: string;
  inflight?: Promise<PlaylistEntry>;
};

type SegmentEntry = {
  fetchedAt: number;
  bytes: Uint8Array;
  contentType: string;
};

const PLAYLIST_TTL_MS = 2_500; // ~1 poll per target-duration
const SEGMENT_TTL_MS = 1_500;
const SEGMENT_CACHE_MAX = 200;

const playlistCache = new Map<string, PlaylistEntry>();
const playlistInflight = new Map<string, Promise<PlaylistEntry>>();

const segmentCache = new Map<string, SegmentEntry>();
const segmentInflight = new Map<string, Promise<SegmentEntry>>();

export type TvRowForStream = {
  id: string;
  enabled: boolean;
  server_url: string | null;
  username: string | null;
  password: string | null;
  connection_type: "xtream" | "m3u" | "hls" | string;
  selected_channel_id: string | null;
  current_stream_url?: string | null;
};

function credsFor(tv: TvRowForStream): IptvCredentials {
  return {
    server_url: tv.server_url ?? "",
    username: tv.username ?? null,
    password: decryptSecret(tv.password) || null,
    connection_type: (tv.connection_type === "m3u" ? "m3u" : "xtream") as
      | "xtream"
      | "m3u",
  };
}

/** Evict any cached playlist/segments for a TV (e.g. after channel switch/stop). */
export function evictTvCache(tvId: string): void {
  playlistCache.delete(tvId);
  playlistInflight.delete(tvId);
  const prefix = `${tvId}::`;
  for (const key of segmentCache.keys()) {
    if (key.startsWith(prefix)) segmentCache.delete(key);
  }
  for (const key of segmentInflight.keys()) {
    if (key.startsWith(prefix)) segmentInflight.delete(key);
  }
}

/**
 * Fetch (or reuse) the rewritten playlist for a TV. Single-flight per tvId:
 * concurrent callers await one upstream fetch.
 */
export async function getSharedPlaylist(
  tv: TvRowForStream,
  segmentProxyPath: string,
): Promise<{ rewritten: string; upstreamUrl: string; channelId: string }> {
  if (!tv.selected_channel_id) throw new Error("TV has no channel selected");
  const now = Date.now();
  const cached = playlistCache.get(tv.id);

  // Invalidate cache if channel changed under us.
  if (cached && cached.channelId !== tv.selected_channel_id) {
    playlistCache.delete(tv.id);
  }

  const fresh = playlistCache.get(tv.id);
  if (fresh && now - fresh.fetchedAt < PLAYLIST_TTL_MS) {
    return {
      rewritten: fresh.rewritten,
      upstreamUrl: fresh.upstreamUrl,
      channelId: fresh.channelId,
    };
  }

  const inflight = playlistInflight.get(tv.id);
  if (inflight) return inflight.then(pick);

  const p = (async (): Promise<PlaylistEntry> => {
    try {
      const upstreamUrl = resolveStreamUrl(
        credsFor(tv),
        tv.selected_channel_id!,
        tv.current_stream_url ?? null,
      );
      const upstream = await fetch(upstreamUrl, {
        headers: { "User-Agent": "VLC/3.0" },
      });
      if (!upstream.ok) {
        throw new Error(`Upstream ${upstream.status}`);
      }
      const text = await upstream.text();
      const rewritten = rewritePlaylist(text, tv.id, upstreamUrl, segmentProxyPath);
      const entry: PlaylistEntry = {
        fetchedAt: Date.now(),
        upstreamUrl,
        rewritten,
        channelId: tv.selected_channel_id!,
      };
      playlistCache.set(tv.id, entry);
      return entry;
    } finally {
      playlistInflight.delete(tv.id);
    }
  })();

  playlistInflight.set(tv.id, p);
  return p.then(pick);
}

function pick(e: PlaylistEntry) {
  return { rewritten: e.rewritten, upstreamUrl: e.upstreamUrl, channelId: e.channelId };
}

/**
 * Fetch (or reuse) a media segment. Micro-cache collapses simultaneous
 * viewer requests for the same segment into a single upstream GET.
 */
export async function getSharedSegment(
  tvId: string,
  upstreamUrl: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const key = `${tvId}::${upstreamUrl}`;
  const now = Date.now();
  const cached = segmentCache.get(key);
  if (cached && now - cached.fetchedAt < SEGMENT_TTL_MS) {
    return { bytes: cached.bytes, contentType: cached.contentType };
  }
  const inflight = segmentInflight.get(key);
  if (inflight) return inflight;

  const p = (async (): Promise<SegmentEntry> => {
    try {
      const upstream = await fetch(upstreamUrl, {
        headers: { "User-Agent": "VLC/3.0" },
      });
      if (!upstream.ok) throw new Error(`Upstream ${upstream.status}`);
      const buf = new Uint8Array(await upstream.arrayBuffer());
      const entry: SegmentEntry = {
        fetchedAt: Date.now(),
        bytes: buf,
        contentType: upstream.headers.get("content-type") ?? "video/mp2t",
      };
      // Naive LRU: drop oldest when over cap.
      if (segmentCache.size >= SEGMENT_CACHE_MAX) {
        const oldestKey = segmentCache.keys().next().value;
        if (oldestKey) segmentCache.delete(oldestKey);
      }
      segmentCache.set(key, entry);
      return entry;
    } finally {
      segmentInflight.delete(key);
    }
  })();

  segmentInflight.set(key, p);
  return p;
}
