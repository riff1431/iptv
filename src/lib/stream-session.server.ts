import { createHash } from "node:crypto";
import {
  resolveStreamUrl,
  xtreamUpstreamUrl,
  type IptvCredentials,
} from "@/lib/iptv-client.server";
import { decryptSecret } from "@/lib/iptv-crypto.server";
import { rewritePlaylist } from "@/lib/iptv-proxy.server";
import {
  getXtreamPlaylistError,
  getUpstreamTiming,
  IPTV_UPSTREAM_HEADERS,
  isHlsManifestBody,
  isUsablePlaylistResponse,
  customFetch,
  type UpstreamTiming,
} from "@/lib/iptv-upstream.server";

function envInt(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

const PLAYLIST_TTL_MS = 4_000;
const PLAYLIST_MAX_BYTES = 1_048_576;

function segmentConfig() {
  const totalMaxBytes = envInt(
    "IPTV_SEGMENT_CACHE_TOTAL_MAX_BYTES",
    67_108_864,
    1_048_576,
    256 * 1024 * 1024,
  );
  const requestedItemMaxBytes = envInt(
    "IPTV_SEGMENT_CACHE_ITEM_MAX_BYTES",
    8_388_608,
    64_000,
    32 * 1024 * 1024,
  );
  return {
    ttlMs: envInt("IPTV_SEGMENT_CACHE_TTL_MS", 20_000, 1_000, 120_000),
    itemMaxBytes: Math.min(requestedItemMaxBytes, totalMaxBytes),
    totalMaxBytes,
  };
}

type PlaylistEntry = {
  fetchedAt: number;
  upstreamUrl: string;
  rewritten: string;
  channelId: string;
};

type SegmentEntry = {
  fetchedAt: number;
  bytes: Uint8Array;
  status: number;
  headers: Record<string, string>;
};

export type SharedPlaylistResult = {
  rewritten: string;
  upstreamUrl: string;
  channelId: string;
  cache: "hit" | "miss" | "in-flight";
  timing?: UpstreamTiming;
  upstreamStatus: number;
};

export type SharedSegmentResult =
  | {
      kind: "buffered";
      bytes: Uint8Array;
      status: number;
      headers: Record<string, string>;
      cache: "hit" | "in-flight";
      timing?: UpstreamTiming;
    }
  | {
      kind: "stream";
      body: ReadableStream<Uint8Array>;
      status: number;
      headers: Record<string, string>;
      cache: "miss";
      timing?: UpstreamTiming;
    }
  | {
      kind: "playlist";
      body: string;
      status: 200;
      headers: Record<string, string>;
      cache: "miss" | "in-flight";
      timing?: UpstreamTiming;
    };

export class IptvUpstreamHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryable = status === 429 || status >= 500,
  ) {
    super(message);
  }
}

const playlistCache = new Map<string, PlaylistEntry>();
const playlistInflight = new Map<
  string,
  Promise<PlaylistEntry & { timing?: UpstreamTiming; upstreamStatus: number }>
>();
const segmentCache = new Map<string, SegmentEntry>();
const segmentInflight = new Map<string, Promise<SegmentEntry | null>>();
const segmentStarts = new Map<string, Promise<SharedSegmentResult>>();
let segmentCacheBytes = 0;

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

export async function credsFor(tv: TvRowForStream): Promise<IptvCredentials> {
  if (!tv.server_url) {
    const { getCachedGlobalIptvSettings } = await import("@/lib/iptv-settings-cache.server");
    const global = await getCachedGlobalIptvSettings();
    if (!global) throw new Error("No IPTV provider is configured for this TV");
    return {
      server_url: global.server_url,
      username: global.username,
      password: global.password,
      connection_type: "xtream",
    };
  }
  return {
    server_url: tv.server_url,
    username: tv.username ?? null,
    password: decryptSecret(tv.password) || null,
    connection_type: (tv.connection_type === "m3u" ? "m3u" : "xtream") as "xtream" | "m3u",
  };
}

function deleteSegment(key: string): void {
  const entry = segmentCache.get(key);
  if (!entry) return;
  segmentCacheBytes -= entry.bytes.byteLength;
  segmentCache.delete(key);
}

function pruneSegmentCache(now = Date.now()): void {
  const { ttlMs, totalMaxBytes } = segmentConfig();
  for (const [key, entry] of segmentCache) {
    if (now - entry.fetchedAt >= ttlMs) deleteSegment(key);
  }
  while (segmentCacheBytes > totalMaxBytes && segmentCache.size) {
    const oldest = segmentCache.keys().next().value as string | undefined;
    if (!oldest) break;
    deleteSegment(oldest);
  }
}

function putSegment(key: string, entry: SegmentEntry): void {
  const { itemMaxBytes, totalMaxBytes } = segmentConfig();
  if (entry.bytes.byteLength > itemMaxBytes || entry.bytes.byteLength > totalMaxBytes) return;
  deleteSegment(key);
  segmentCache.set(key, entry);
  segmentCacheBytes += entry.bytes.byteLength;
  pruneSegmentCache();
}

export function evictTvCache(tvId: string): void {
  playlistCache.delete(tvId);
  playlistInflight.delete(tvId);
  const prefix = `${tvId}:`;
  for (const key of [...segmentCache.keys()]) if (key.startsWith(prefix)) deleteSegment(key);
  for (const key of [...segmentInflight.keys()])
    if (key.startsWith(prefix)) segmentInflight.delete(key);
  for (const key of [...segmentStarts.keys()])
    if (key.startsWith(prefix)) segmentStarts.delete(key);
}

async function readCapped(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel(`${label} exceeds byte limit`);
        throw new Error(`${label} exceeds byte limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export async function getSharedPlaylist(
  tv: TvRowForStream,
  segmentProxyPath: string,
): Promise<SharedPlaylistResult> {
  if (!tv.selected_channel_id) throw new Error("TV has no channel selected");
  const now = Date.now();
  const cached = playlistCache.get(tv.id);
  if (cached && cached.channelId !== tv.selected_channel_id) playlistCache.delete(tv.id);
  const fresh = playlistCache.get(tv.id);
  if (fresh && now - fresh.fetchedAt < PLAYLIST_TTL_MS) {
    return { ...fresh, cache: "hit", upstreamStatus: 200 };
  }

  const existing = playlistInflight.get(tv.id);
  if (existing) {
    const entry = await existing;
    return { ...entry, cache: "in-flight" };
  }

  const pending = (async () => {
    try {
      const creds = await credsFor(tv);
      const upstreamUrl =
        creds.connection_type === "xtream"
          ? xtreamUpstreamUrl(creds, tv.selected_channel_id!)
          : resolveStreamUrl(creds, tv.selected_channel_id!, tv.current_stream_url ?? null);
      const upstream = await customFetch(upstreamUrl, { headers: IPTV_UPSTREAM_HEADERS });
      const timing = getUpstreamTiming(upstream);
      const bytes = await readCapped(upstream, PLAYLIST_MAX_BYTES, "IPTV playlist");
      const text = new TextDecoder().decode(bytes);
      const xtreamError = getXtreamPlaylistError(upstream.status, text);
      if (xtreamError) throw new IptvUpstreamHttpError(429, xtreamError, false);
      if (!isUsablePlaylistResponse(upstream.status, text)) {
        console.error("INVALID PLAYLIST RECEIVED:", text.slice(0, 1000));
        throw new IptvUpstreamHttpError(502, "Invalid IPTV upstream manifest", false);
      }
      const entry = {
        fetchedAt: Date.now(),
        upstreamUrl,
        rewritten: rewritePlaylist(text, tv.id, upstream.url || upstreamUrl, segmentProxyPath),
        channelId: tv.selected_channel_id!,
        timing,
        upstreamStatus: upstream.status,
      };
      playlistCache.set(tv.id, entry);
      return entry;
    } finally {
      playlistInflight.delete(tv.id);
    }
  })();
  playlistInflight.set(tv.id, pending);
  const entry = await pending;
  return { ...entry, cache: "miss" };
}

function cacheKey(tvId: string, upstreamUrl: string): string {
  return `${tvId}:${createHash("sha256").update(upstreamUrl).digest("base64url")}`;
}

function preservedHeaders(upstream: Response): Record<string, string> {
  const output: Record<string, string> = {};
  for (const name of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
  ]) {
    const value = upstream.headers.get(name);
    if (value) output[name] = value;
  }
  return output;
}

function looksLikePlaylist(contentType: string, finalUrl: string): boolean {
  if (/mpegurl|vnd\.apple\.mpegurl/i.test(contentType)) return true;
  try {
    return new URL(finalUrl).pathname.toLowerCase().endsWith(".m3u8");
  } catch {
    return false;
  }
}

async function sniffBody(
  body: ReadableStream<Uint8Array>,
): Promise<{ playlist: boolean; body: ReadableStream<Uint8Array<ArrayBuffer>> }> {
  const reader = body.getReader();
  const first = await reader.read();
  const prefix = first.value ?? new Uint8Array();
  const playlist = isHlsManifestBody(new TextDecoder().decode(prefix.subarray(0, 16_384)));
  const rebuilt = new ReadableStream<Uint8Array>({
    start(controller) {
      if (prefix.byteLength) controller.enqueue(prefix);
      if (first.done) controller.close();
    },
    async pull(controller) {
      if (first.done) return;
      try {
        const next = await reader.read();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { playlist, body: rebuilt as ReadableStream<Uint8Array<ArrayBuffer>> };
}

async function bufferCacheBranch(
  key: string,
  body: ReadableStream<Uint8Array>,
  status: number,
  headers: Record<string, string>,
): Promise<SegmentEntry | null> {
  const max = segmentConfig().itemMaxBytes;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        void reader.cancel("IPTV segment is larger than cache item limit");
        return null;
      }
      chunks.push(value);
    }
    const declared = Number(headers["content-length"]);
    if (Number.isFinite(declared) && declared >= 0 && declared !== total) return null;
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const entry = { fetchedAt: Date.now(), bytes, status, headers };
    putSegment(key, entry);
    return segmentCache.has(key) ? entry : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

/** Canonical Sports Arena segment/nested-playlist relay. */
async function getSharedSegmentInternal(
  tvId: string,
  upstreamUrl: string,
  options: { range?: string | null; signal?: AbortSignal; segmentProxyPath?: string } = {},
): Promise<SharedSegmentResult> {
  const ranged = Boolean(options.range);
  const key = cacheKey(tvId, upstreamUrl);
  if (!ranged) {
    pruneSegmentCache();
    const cached = segmentCache.get(key);
    if (cached) {
      segmentCache.delete(key);
      segmentCache.set(key, cached);
      return { kind: "buffered", ...cached, cache: "hit" };
    }
    const existing = segmentInflight.get(key);
    if (existing) {
      const entry = await existing;
      if (entry) return { kind: "buffered", ...entry, cache: "in-flight" };
    }
  }

  const headers: Record<string, string> = { ...IPTV_UPSTREAM_HEADERS };
  if (options.range) headers.Range = options.range;
  const upstream = await customFetch(upstreamUrl, { headers, signal: options.signal });
  const timing = getUpstreamTiming(upstream);
  const responseHeaders = preservedHeaders(upstream);
  if (upstream.status === 429) {
    void upstream.body?.cancel();
    throw new IptvUpstreamHttpError(429, "Xtream provider connection limit reached", false);
  }
  if (upstream.status === 458) {
    const bytes = await readCapped(upstream, PLAYLIST_MAX_BYTES, "Nested IPTV playlist");
    const text = new TextDecoder().decode(bytes);
    if (!isHlsManifestBody(text)) {
      throw new IptvUpstreamHttpError(429, "Xtream provider connection limit reached", false);
    }
    return {
      kind: "playlist",
      body: rewritePlaylist(
        text,
        tvId,
        upstream.url || upstreamUrl,
        options.segmentProxyPath ?? `/api/sports-arena/tv/${tvId}/seg`,
      ),
      status: 200,
      headers: { "content-type": "application/vnd.apple.mpegurl; charset=utf-8" },
      cache: "miss",
      timing,
    };
  }
  if (!upstream.ok) {
    void upstream.body?.cancel();
    throw new IptvUpstreamHttpError(
      upstream.status,
      `IPTV upstream returned HTTP ${upstream.status}`,
    );
  }
  if (!upstream.body) throw new IptvUpstreamHttpError(502, "IPTV upstream returned an empty body");

  let body = upstream.body;
  let playlist = looksLikePlaylist(
    responseHeaders["content-type"] ?? "",
    upstream.url || upstreamUrl,
  );
  if (!playlist && !ranged) {
    const sniffed = await sniffBody(body);
    playlist = sniffed.playlist;
    body = sniffed.body;
  }
  if (playlist) {
    const buffered = await readCapped(
      new Response(body),
      PLAYLIST_MAX_BYTES,
      "Nested IPTV playlist",
    );
    const text = new TextDecoder().decode(buffered);
    if (!isHlsManifestBody(text))
      throw new IptvUpstreamHttpError(502, "Invalid nested IPTV playlist");
    const rewritten = rewritePlaylist(
      text,
      tvId,
      upstream.url || upstreamUrl,
      options.segmentProxyPath ?? `/api/sports-arena/tv/${tvId}/seg`,
    );
    return {
      kind: "playlist",
      body: rewritten,
      status: 200,
      headers: { "content-type": "application/vnd.apple.mpegurl; charset=utf-8" },
      cache: "miss",
      timing,
    };
  }

  const declared = Number(responseHeaders["content-length"]);

  // BYPASS SEGMENT CACHING COMPLETELY
  // This turns the proxy into a pure, direct pipe to XUI, eliminating any
  // potential deadlocks or memory bottlenecks from Node.js tee() behavior.
  return {
    kind: "stream",
    body,
    status: upstream.status,
    headers: responseHeaders,
    cache: "miss",
    timing,
  };
}

export async function getSharedSegment(
  tvId: string,
  upstreamUrl: string,
  options: { range?: string | null; signal?: AbortSignal; segmentProxyPath?: string } = {},
): Promise<SharedSegmentResult> {
  if (options.range) return getSharedSegmentInternal(tvId, upstreamUrl, options);
  const key = cacheKey(tvId, upstreamUrl);
  const starting = segmentStarts.get(key);
  if (starting) {
    const started = await starting;
    if (started.kind !== "stream") return { ...started, cache: "in-flight" };
    return getSharedSegmentInternal(tvId, upstreamUrl, options);
  }
  const start = getSharedSegmentInternal(tvId, upstreamUrl, options);
  segmentStarts.set(key, start);
  try {
    return await start;
  } finally {
    segmentStarts.delete(key);
  }
}

export function getSegmentCacheStatsForTests(): {
  entries: number;
  bytes: number;
  inflight: number;
} {
  return {
    entries: segmentCache.size,
    bytes: segmentCacheBytes,
    inflight: segmentInflight.size + segmentStarts.size,
  };
}

export function resetStreamSessionForTests(): void {
  playlistCache.clear();
  playlistInflight.clear();
  segmentCache.clear();
  segmentInflight.clear();
  segmentStarts.clear();
  segmentCacheBytes = 0;
}
