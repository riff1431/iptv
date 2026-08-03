import { sealRelayUrl } from "@/lib/iptv-relay-token.server";
import {
  classifyUpstreamError,
  customFetch,
  getUpstreamTiming,
  IPTV_UPSTREAM_HEADERS,
  type UpstreamTiming,
} from "@/lib/iptv-upstream.server";

const PLAYLIST_TTL_MS = 2_500;
const PLAYLIST_STALE_MS = 30_000;
const PLAYLIST_CACHE_MAX = 32;
const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;

function envInt(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

const RESOURCE_TTL_MS = envInt("IPTV_SEGMENT_CACHE_TTL_MS", 20_000, 1_000, 120_000);
const MAX_RESOURCE_CACHE_BYTES = envInt(
  "IPTV_SEGMENT_CACHE_TOTAL_MAX_BYTES",
  64 * 1024 * 1024,
  8 * 1024 * 1024,
  512 * 1024 * 1024,
);
const MAX_CACHEABLE_RESOURCE_BYTES = Math.min(
  MAX_RESOURCE_CACHE_BYTES,
  envInt("IPTV_SEGMENT_CACHE_ITEM_MAX_BYTES", 8 * 1024 * 1024, 64 * 1024, 64 * 1024 * 1024),
);

type PlaylistEntry = {
  fetchedAt: number;
  body: string;
  status: number;
  upstreamTiming?: UpstreamTiming;
};

export type RelayPlaylistResponse = {
  body: string;
  status: number;
  cache: "hit" | "miss" | "in-flight";
  upstreamTiming?: UpstreamTiming;
};

export type RelayResource = {
  fetchedAt: number;
  bytes: Uint8Array;
  status: number;
  contentType: string;
  contentLength: string | null;
  contentRange: string | null;
  acceptRanges: string | null;
  etag: string | null;
  lastModified: string | null;
  finalUrl: string;
};

export type RelayResourceResponse =
  | { kind: "buffered"; resource: RelayResource; cache: "hit" | "in-flight" }
  | {
      kind: "stream";
      body: ReadableStream<Uint8Array>;
      resource: Omit<RelayResource, "fetchedAt" | "bytes">;
      cache: "miss";
      upstreamTiming?: UpstreamTiming;
    };

type StreamingResource = {
  claimed: boolean;
  body: ReadableStream<Uint8Array>;
  resource: Omit<RelayResource, "fetchedAt" | "bytes">;
  upstreamTiming?: UpstreamTiming;
  completed?: Promise<RelayResource>;
};
const playlistCache = new Map<string, PlaylistEntry>();
const playlistInflight = new Map<string, Promise<PlaylistEntry>>();
const resourceCache = new Map<string, RelayResource>();
const resourceInflight = new Map<string, Promise<RelayResource>>();
const resourceStreamStarts = new Map<string, Promise<StreamingResource | RelayResource>>();
let resourceCacheBytes = 0;

export class IptvRelayUpstreamError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "IptvRelayUpstreamError";
  }
}

function cacheKey(scope: string, upstreamUrl: string): string {
  return `${scope}::${upstreamUrl}`;
}

function assertUsefulUpstream(status: number, byteLength: number): void {
  if (status === 458) {
    if (byteLength === 0) {
      throw new IptvRelayUpstreamError(
        429,
        "Xtream connection limit reached. Stop the existing provider session and retry.",
      );
    }
    // Some Xtream servers return a valid #EXTM3U body with their private 458
    // status. The caller validates the body before treating it as playable.
    return;
  }
  if (status === 404 || status === 410) {
    throw new IptvRelayUpstreamError(status, `Upstream returned HTTP ${status}`);
  }
  if (status === 429) {
    throw new IptvRelayUpstreamError(429, "Upstream connection limit or rate limit reached");
  }
  if (status < 200 || status >= 300) {
    throw new IptvRelayUpstreamError(502, `Upstream returned HTTP ${status}`);
  }
}

function assertStreamableUpstream(response: Response): void {
  if (response.status === 404 || response.status === 410) {
    throw new IptvRelayUpstreamError(response.status, `Upstream returned HTTP ${response.status}`);
  }
  if (response.status === 429) {
    throw new IptvRelayUpstreamError(429, "Upstream connection limit or rate limit reached");
  }
  if ((response.status < 200 || response.status >= 300) && response.status !== 458) {
    throw new IptvRelayUpstreamError(502, `Upstream returned HTTP ${response.status}`);
  }
}

function resourceMetadata(
  response: Response,
  finalUrl: string,
): Omit<RelayResource, "fetchedAt" | "bytes"> {
  return {
    status: response.status,
    contentType: response.headers.get("content-type") || "application/octet-stream",
    contentLength: response.headers.get("content-length"),
    contentRange: response.headers.get("content-range"),
    acceptRanges: response.headers.get("accept-ranges"),
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
    finalUrl,
  };
}

function isPlaylistResponse(response: Response, finalUrl: string): boolean {
  const type = response.headers.get("content-type")?.toLowerCase() || "";
  if (type.includes("mpegurl")) return true;
  try {
    return /\.m3u8?$/i.test(new URL(finalUrl).pathname);
  } catch {
    return false;
  }
}
async function readResponseCapped(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) {
    throw new IptvRelayUpstreamError(502, `${label} exceeds relay size limit`);
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new IptvRelayUpstreamError(502, `${label} exceeds relay size limit`);
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

function rewriteRelayPlaylist(
  playlist: string,
  scope: string,
  upstreamPlaylistUrl: string,
  resourceProxyPath: string,
): string {
  const base = new URL(upstreamPlaylistUrl);
  const rewriteOne = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed || /^(data|blob):/i.test(trimmed)) return raw;
    const absolute = new URL(trimmed, base).toString();
    return `${resourceProxyPath}?token=${encodeURIComponent(sealRelayUrl(scope, absolute))}`;
  };

  return playlist
    .split(/\r?\n/)
    .map((line) => {
      if (!line) return line;
      if (line.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => `URI="${rewriteOne(uri)}"`);
      }
      return rewriteOne(line);
    })
    .join("\n");
}

function touchResource(key: string, entry: RelayResource): void {
  resourceCache.delete(key);
  resourceCache.set(key, entry);
}

function prunePlaylistCache(now: number): void {
  for (const [key, entry] of playlistCache) {
    if (now - entry.fetchedAt >= PLAYLIST_STALE_MS) playlistCache.delete(key);
  }
  while (playlistCache.size > PLAYLIST_CACHE_MAX) {
    const oldestKey = playlistCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    playlistCache.delete(oldestKey);
  }
}

function pruneResourceCache(now: number): void {
  for (const [key, entry] of resourceCache) {
    if (now - entry.fetchedAt >= RESOURCE_TTL_MS) {
      resourceCache.delete(key);
      resourceCacheBytes -= entry.bytes.byteLength;
    }
  }
  while (resourceCacheBytes > MAX_RESOURCE_CACHE_BYTES && resourceCache.size > 0) {
    const oldestKey = resourceCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = resourceCache.get(oldestKey);
    resourceCache.delete(oldestKey);
    resourceCacheBytes -= oldest?.bytes.byteLength ?? 0;
  }
}

async function fetchWithRedirects(
  initialUrl: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
  maxHops = 5,
): Promise<{ response: Response; finalUrl: string }> {
  const response = await customFetch(initialUrl, {
    method: "GET",
    redirect: "follow",
    maxRedirects: maxHops,
    signal,
    headers,
  });
  return { response, finalUrl: response.url || initialUrl };
}

export async function getSharedGlobalPlaylist(
  scope: string,
  upstreamUrl: string,
  resourceProxyPath: string,
): Promise<RelayPlaylistResponse> {
  const key = cacheKey(scope, upstreamUrl);
  const now = Date.now();
  prunePlaylistCache(now);
  const cached = playlistCache.get(key);
  if (cached && now - cached.fetchedAt < PLAYLIST_TTL_MS) {
    return { body: cached.body, status: cached.status, cache: "hit" };
  }
  const inflight = playlistInflight.get(key);
  if (inflight) {
    const entry = await inflight;
    return { body: entry.body, status: entry.status, cache: "in-flight" };
  }

  const pending = (async (): Promise<PlaylistEntry> => {
    try {
      const { response, finalUrl } = await fetchWithRedirects(upstreamUrl, IPTV_UPSTREAM_HEADERS);
      const bytes = await readResponseCapped(response, MAX_PLAYLIST_BYTES, "Upstream playlist");
      assertUsefulUpstream(response.status, bytes.byteLength);
      const raw = new TextDecoder().decode(bytes);
      if (!raw.trim().startsWith("#EXTM3U")) {
        throw new IptvRelayUpstreamError(502, "Upstream did not return an HLS playlist");
      }
      const entry = {
        fetchedAt: Date.now(),
        body: rewriteRelayPlaylist(raw, scope, finalUrl, resourceProxyPath),
        status: response.status,
        upstreamTiming: getUpstreamTiming(response),
      };
      prunePlaylistCache(Date.now());
      if (!playlistCache.has(key) && playlistCache.size >= PLAYLIST_CACHE_MAX) {
        const oldestKey = playlistCache.keys().next().value as string | undefined;
        if (oldestKey) playlistCache.delete(oldestKey);
      }
      playlistCache.set(key, entry);
      return entry;
    } catch (error) {
      if ((error as { name?: string } | null)?.name === "AbortError") {
        const category = classifyUpstreamError(error);
        throw new IptvRelayUpstreamError(
          category === "client_abort" ? 499 : 504,
          category === "client_abort"
            ? "Client cancelled upstream playlist"
            : "Upstream playlist timed out",
        );
      }
      throw error;
    } finally {
      playlistInflight.delete(key);
    }
  })();

  playlistInflight.set(key, pending);
  const entry = await pending;
  return {
    body: entry.body,
    status: entry.status,
    cache: "miss",
    upstreamTiming: entry.upstreamTiming,
  };
}

/**
 * Streams a cache-miss media segment to the first viewer as bytes arrive from
 * the provider. A tee'd branch is still buffered into the shared cache, so
 * concurrent viewers wait for and reuse the same upstream request instead of
 * consuming another Xtream connection. Playlists remain buffered because they
 * must be inspected and rewritten before they are safe to return.
 */
export async function getSharedGlobalResourceResponse(
  scope: string,
  upstreamUrl: string,
  options: { range?: string | null; signal?: AbortSignal } = {},
): Promise<RelayResourceResponse> {
  const range = options.range?.trim() || null;
  const key = cacheKey(scope, `${upstreamUrl}::range=${range ?? "full"}`);
  const canCache = range === null;
  const now = Date.now();
  pruneResourceCache(now);
  const cached = canCache ? resourceCache.get(key) : undefined;
  if (cached && now - cached.fetchedAt < RESOURCE_TTL_MS) {
    touchResource(key, cached);
    return { kind: "buffered", resource: cached, cache: "hit" };
  }
  const bufferedInflight = canCache ? resourceInflight.get(key) : undefined;
  if (bufferedInflight) {
    return { kind: "buffered", resource: await bufferedInflight, cache: "in-flight" };
  }

  let start = canCache ? resourceStreamStarts.get(key) : undefined;
  if (!start) {
    start = (async (): Promise<StreamingResource | RelayResource> => {
      const headerController = new AbortController();
      const abortBeforeStreaming = () => headerController.abort();
      if (options.signal?.aborted) abortBeforeStreaming();
      else options.signal?.addEventListener("abort", abortBeforeStreaming, { once: true });
      try {
        const { response, finalUrl } = await fetchWithRedirects(
          upstreamUrl,
          {
            ...IPTV_UPSTREAM_HEADERS,
            ...(range ? { Range: range } : {}),
          },
          headerController.signal,
        );
        assertStreamableUpstream(response);
        const metadata = resourceMetadata(response, finalUrl);
        const timing = getUpstreamTiming(response);

        let mediaBody = response.body;
        let playlist = isPlaylistResponse(response, finalUrl);
        if (!playlist && mediaBody) {
          const reader = mediaBody.getReader();
          const prefixChunks: Uint8Array<ArrayBufferLike>[] = [];
          let prefixBytes = 0;
          let bodyEnded = false;
          while (prefixBytes < 16_384) {
            const chunk = await reader.read();
            if (chunk.done) {
              bodyEnded = true;
              break;
            }
            prefixChunks.push(chunk.value);
            prefixBytes += chunk.value.byteLength;
            const probe = new Uint8Array(Math.min(prefixBytes, 16_384));
            let offset = 0;
            for (const part of prefixChunks) {
              probe.set(part.subarray(0, probe.byteLength - offset), offset);
              offset += Math.min(part.byteLength, probe.byteLength - offset);
              if (offset >= probe.byteLength) break;
            }
            const trimmed = new TextDecoder().decode(probe).trimStart();
            if (trimmed.startsWith("#EXTM3U")) {
              playlist = true;
              break;
            }
            if (trimmed.length >= 7 && !"#EXTM3U".startsWith(trimmed)) break;
          }
          mediaBody = new ReadableStream<Uint8Array<ArrayBuffer>>({
            start(controller) {
              for (const chunk of prefixChunks) {
                controller.enqueue(chunk as Uint8Array<ArrayBuffer>);
              }
              if (bodyEnded) controller.close();
            },
            async pull(controller) {
              if (bodyEnded) return;
              try {
                const next = await reader.read();
                if (next.done) controller.close();
                else controller.enqueue(next.value as Uint8Array<ArrayBuffer>);
              } catch (error) {
                controller.error(error);
              }
            },
            async cancel(reason) {
              await reader.cancel(reason);
            },
          });
        }
        if (response.status === 458 && !playlist) {
          await mediaBody?.cancel();
          throw new IptvRelayUpstreamError(
            429,
            "Xtream connection limit reached. Stop the existing provider session and retry.",
          );
        }

        // Nested HLS playlists must be buffered and rewritten before exposure.
        if (playlist || !mediaBody) {
          const playlistResponse = new Response(mediaBody, { headers: response.headers });
          const bytes = await readResponseCapped(
            playlistResponse,
            MAX_PLAYLIST_BYTES,
            "Upstream playlist",
          );
          assertUsefulUpstream(response.status, bytes.byteLength);
          const raw = new TextDecoder().decode(bytes);
          if (!raw.trimStart().startsWith("#EXTM3U")) {
            throw new IptvRelayUpstreamError(502, "Upstream did not return a valid HLS playlist");
          }
          const entry: RelayResource = {
            fetchedAt: Date.now(),
            bytes,
            ...metadata,
            contentType: "application/vnd.apple.mpegurl",
          };
          if (canCache && bytes.byteLength <= MAX_CACHEABLE_RESOURCE_BYTES) {
            resourceCache.set(key, entry);
            resourceCacheBytes += bytes.byteLength;
            pruneResourceCache(Date.now());
          }
          resourceStreamStarts.delete(key);
          return entry;
        }

        if (!canCache || Number(metadata.contentLength || 0) > MAX_CACHEABLE_RESOURCE_BYTES) {
          resourceStreamStarts.delete(key);
          return {
            claimed: false,
            body: mediaBody,
            resource: metadata,
            upstreamTiming: timing,
          };
        }

        const [viewerBody, cacheBody] = mediaBody.tee();
        const cacheResponse = new Response(cacheBody, {
          headers: {
            "content-type": metadata.contentType,
            ...(metadata.contentLength ? { "content-length": metadata.contentLength } : {}),
          },
        });
        const completed = (async (): Promise<RelayResource> => {
          try {
            const bytes = await readResponseCapped(
              cacheResponse,
              MAX_CACHEABLE_RESOURCE_BYTES,
              "Upstream resource",
            );
            const entry: RelayResource = {
              fetchedAt: Date.now(),
              bytes,
              ...metadata,
            };
            if (bytes.byteLength <= MAX_CACHEABLE_RESOURCE_BYTES) {
              resourceCache.set(key, entry);
              resourceCacheBytes += bytes.byteLength;
              pruneResourceCache(Date.now());
            }
            return entry;
          } finally {
            resourceInflight.delete(key);
            resourceStreamStarts.delete(key);
          }
        })();
        resourceInflight.set(key, completed);
        void completed.catch(() => {});
        return {
          claimed: false,
          body: viewerBody,
          resource: metadata,
          upstreamTiming: timing,
          completed,
        };
      } catch (error) {
        resourceStreamStarts.delete(key);
        if ((error as { name?: string } | null)?.name === "AbortError") {
          const category = classifyUpstreamError(error);
          throw new IptvRelayUpstreamError(
            category === "client_abort" ? 499 : 504,
            category === "client_abort"
              ? "Client cancelled upstream resource"
              : "Upstream resource timed out",
          );
        }
        throw error;
      } finally {
        options.signal?.removeEventListener("abort", abortBeforeStreaming);
      }
    })();
    if (canCache) resourceStreamStarts.set(key, start);
  }

  const started = await start;
  if ("bytes" in started) {
    resourceStreamStarts.delete(key);
    return { kind: "buffered", resource: started, cache: "hit" };
  }
  if (!started.claimed) {
    started.claimed = true;
    return {
      kind: "stream",
      body: started.body,
      resource: started.resource,
      cache: "miss",
      upstreamTiming: started.upstreamTiming,
    };
  }
  if (!started.completed) {
    throw new IptvRelayUpstreamError(
      502,
      "Concurrent uncached resource request could not reuse body",
    );
  }
  return { kind: "buffered", resource: await started.completed, cache: "in-flight" };
}
export function rewriteNestedRelayPlaylist(
  playlist: string,
  scope: string,
  upstreamPlaylistUrl: string,
  resourceProxyPath: string,
): string {
  return rewriteRelayPlaylist(playlist, scope, upstreamPlaylistUrl, resourceProxyPath);
}

export function resetGlobalIptvRelayForTests(): void {
  playlistCache.clear();
  playlistInflight.clear();
  resourceCache.clear();
  resourceInflight.clear();
  resourceStreamStarts.clear();
  resourceCacheBytes = 0;
}
