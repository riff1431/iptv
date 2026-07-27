import { sealRelayUrl } from "@/lib/iptv-relay-token.server";

const PLAYLIST_TTL_MS = 2_500;
const PLAYLIST_STALE_MS = 30_000;
const PLAYLIST_CACHE_MAX = 32;
const RESOURCE_TTL_MS = 20_000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;
const MAX_RESOURCE_BYTES = 32 * 1024 * 1024;
const MAX_CACHEABLE_RESOURCE_BYTES = 8 * 1024 * 1024;
const MAX_RESOURCE_CACHE_BYTES = 96 * 1024 * 1024;

const UPSTREAM_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "*/*",
};

type PlaylistEntry = {
  fetchedAt: number;
  body: string;
};

export type RelayResource = {
  fetchedAt: number;
  bytes: Uint8Array;
  contentType: string;
  finalUrl: string;
};

const playlistCache = new Map<string, PlaylistEntry>();
const playlistInflight = new Map<string, Promise<PlaylistEntry>>();
const resourceCache = new Map<string, RelayResource>();
const resourceInflight = new Map<string, Promise<RelayResource>>();
let resourceCacheBytes = 0;

// ---------------------------------------------------------------------------
// L2 cache: Cloudflare Cache API (caches.default).
//
// The Maps above are module-level, i.e. per-isolate. On Cloudflare Workers
// (many short-lived isolates per datacenter) each isolate starts with empty
// Maps, so every isolate independently fetches the Xtream upstream — overrun
// the provider's connection limit (HTTP 458) and thrash through retries. That
// is the root cause of the multi-minute startup buffering seen in production
// but not locally (local = one long-lived Node process, so the Maps persist
// and a single upstream fetch fans out to all viewers).
//
// caches.default is shared across every isolate in a datacenter, which restores
// that "one fetch, many viewers" fan-out on production. It is undefined in
// local Node dev, where we transparently fall back to the in-memory Maps, so
// local behavior is unchanged.
type RelayCache = {
  match: (req: Request) => Promise<Response | undefined>;
  put: (req: Request, res: Response) => Promise<void>;
};
const sharedCache: RelayCache | null = (() => {
  try {
    const c = (globalThis as { caches?: { default?: RelayCache } }).caches;
    return c?.default ?? null;
  } catch {
    return null;
  }
})();

function playlistCacheReq(key: string): Request {
  return new Request(`https://pgx-iptv-cache.internal/playlist/${encodeURIComponent(key)}`, {
    method: "GET",
  });
}
function resourceCacheReq(key: string): Request {
  return new Request(`https://pgx-iptv-cache.internal/resource/${encodeURIComponent(key)}`, {
    method: "GET",
  });
}

async function l2GetPlaylist(key: string): Promise<string | null> {
  if (!sharedCache) return null;
  try {
    const cached = await sharedCache.match(playlistCacheReq(key));
    if (!cached || !cached.ok) return null;
    const fetchedAt = Number(cached.headers.get("x-fetched-at") || 0);
    if (Date.now() - fetchedAt >= PLAYLIST_TTL_MS) return null;
    return await cached.text();
  } catch {
    return null;
  }
}
async function l2PutPlaylist(key: string, body: string): Promise<void> {
  if (!sharedCache) return;
  try {
    await sharedCache.put(
      playlistCacheReq(key),
      new Response(body, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "x-fetched-at": String(Date.now()),
          "cache-control": `max-age=${Math.ceil(PLAYLIST_TTL_MS / 1000)}`,
        },
      }),
    );
  } catch {
    /* best-effort; L1 still serves. */
  }
}

async function l2GetResource(key: string): Promise<RelayResource | null> {
  if (!sharedCache) return null;
  try {
    const cached = await sharedCache.match(resourceCacheReq(key));
    if (!cached || !cached.ok) return null;
    const fetchedAt = Number(cached.headers.get("x-fetched-at") || 0);
    if (Date.now() - fetchedAt >= RESOURCE_TTL_MS) return null;
    const bytes = new Uint8Array(await cached.arrayBuffer());
    return {
      fetchedAt,
      bytes,
      contentType: cached.headers.get("x-content-type") || "application/octet-stream",
      finalUrl: cached.headers.get("x-final-url") || "",
    };
  } catch {
    return null;
  }
}
async function l2PutResource(key: string, entry: RelayResource): Promise<void> {
  if (!sharedCache) return;
  try {
    // Copy into a fresh ArrayBuffer so the body is a plain ArrayBuffer (valid
    // BodyInit on both runtimes; sidesteps the Uint8Array<ArrayBufferLike> typing).
    const buf = new ArrayBuffer(entry.bytes.byteLength);
    new Uint8Array(buf).set(entry.bytes);
    await sharedCache.put(
      resourceCacheReq(key),
      new Response(buf, {
        headers: {
          "content-type": "application/octet-stream",
          "x-content-type": entry.contentType,
          "x-final-url": entry.finalUrl,
          "x-fetched-at": String(entry.fetchedAt),
          "cache-control": `max-age=${Math.ceil(RESOURCE_TTL_MS / 1000)}`,
        },
      }),
    );
  } catch {
    /* best-effort. */
  }
}

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

function createTimeout(): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function assertUsefulUpstream(status: number, byteLength: number): void {
  if (status === 458 && byteLength === 0) {
    throw new IptvRelayUpstreamError(
      429,
      "Xtream connection limit reached. Stop the existing provider session and retry.",
    );
  }
  if (status < 200 || status >= 300) {
    throw new IptvRelayUpstreamError(502, `Upstream returned HTTP ${status}`);
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
  signal: AbortSignal,
  maxHops = 5,
): Promise<{ response: Response; finalUrl: string }> {
  let curr = new URL(initialUrl);
  const currentHeaders = { ...headers };
  for (let i = 0; i < maxHops; i++) {
    delete currentHeaders["Host"];
    delete currentHeaders["host"];
    delete currentHeaders["Host".toLowerCase()];
    const res = await fetch(curr.toString(), {
      method: "GET",
      redirect: "manual",
      signal,
      headers: currentHeaders,
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { response: res, finalUrl: curr.toString() };
      let nextUrl: URL;
      try {
        nextUrl = new URL(loc, curr);
      } catch {
        return { response: res, finalUrl: curr.toString() };
      }
      curr = nextUrl;
      continue;
    }
    return { response: res, finalUrl: curr.toString() };
  }
  throw new Error("Too many redirects");
}

export async function getSharedGlobalPlaylist(
  scope: string,
  upstreamUrl: string,
  resourceProxyPath: string,
): Promise<string> {
  const key = cacheKey(scope, upstreamUrl);
  const now = Date.now();
  prunePlaylistCache(now);
  const cached = playlistCache.get(key);
  if (cached && now - cached.fetchedAt < PLAYLIST_TTL_MS) return cached.body;

  // L2: cross-isolate Cache API (production). Null in local Node dev.
  const l2 = await l2GetPlaylist(key);
  if (l2 !== null) {
    playlistCache.set(key, { fetchedAt: Date.now(), body: l2 });
    return l2;
  }

  const inflight = playlistInflight.get(key);
  if (inflight) return (await inflight).body;

  const pending = (async (): Promise<PlaylistEntry> => {
    const timeout = createTimeout();
    try {
      const { response, finalUrl } = await fetchWithRedirects(
        upstreamUrl,
        UPSTREAM_HEADERS,
        timeout.signal,
      );
      const bytes = await readResponseCapped(response, MAX_PLAYLIST_BYTES, "Upstream playlist");
      assertUsefulUpstream(response.status, bytes.byteLength);
      const raw = new TextDecoder().decode(bytes);
      if (!raw.trim().startsWith("#EXTM3U")) {
        throw new IptvRelayUpstreamError(502, "Upstream did not return an HLS playlist");
      }
      const entry = {
        fetchedAt: Date.now(),
        body: rewriteRelayPlaylist(raw, scope, finalUrl, resourceProxyPath),
      };
      prunePlaylistCache(Date.now());
      if (!playlistCache.has(key) && playlistCache.size >= PLAYLIST_CACHE_MAX) {
        const oldestKey = playlistCache.keys().next().value as string | undefined;
        if (oldestKey) playlistCache.delete(oldestKey);
      }
      playlistCache.set(key, entry);
      void l2PutPlaylist(key, entry.body); // best-effort cross-isolate write
      return entry;
    } catch (error) {
      if ((error as { name?: string } | null)?.name === "AbortError") {
        throw new IptvRelayUpstreamError(504, "Upstream playlist timed out");
      }
      throw error;
    } finally {
      timeout.clear();
      playlistInflight.delete(key);
    }
  })();

  playlistInflight.set(key, pending);
  return (await pending).body;
}

export async function getSharedGlobalResource(
  scope: string,
  upstreamUrl: string,
): Promise<RelayResource> {
  const key = cacheKey(scope, upstreamUrl);
  const now = Date.now();
  pruneResourceCache(now);
  const cached = resourceCache.get(key);
  if (cached && now - cached.fetchedAt < RESOURCE_TTL_MS) {
    touchResource(key, cached);
    return cached;
  }

  // L2: cross-isolate Cache API (production). Null in local Node dev.
  const l2 = await l2GetResource(key);
  if (l2) {
    if (l2.bytes.byteLength <= MAX_CACHEABLE_RESOURCE_BYTES) {
      resourceCache.set(key, l2);
      resourceCacheBytes += l2.bytes.byteLength;
      pruneResourceCache(Date.now());
    }
    return l2;
  }

  const inflight = resourceInflight.get(key);
  if (inflight) return inflight;

  const pending = (async (): Promise<RelayResource> => {
    const timeout = createTimeout();
    try {
      const { response, finalUrl } = await fetchWithRedirects(
        upstreamUrl,
        UPSTREAM_HEADERS,
        timeout.signal,
      );
      const bytes = await readResponseCapped(response, MAX_RESOURCE_BYTES, "Upstream resource");
      assertUsefulUpstream(response.status, bytes.byteLength);
      const entry: RelayResource = {
        fetchedAt: Date.now(),
        bytes,
        contentType: response.headers.get("content-type") || "application/octet-stream",
        finalUrl,
      };
      if (bytes.byteLength <= MAX_CACHEABLE_RESOURCE_BYTES) {
        resourceCache.set(key, entry);
        resourceCacheBytes += bytes.byteLength;
        pruneResourceCache(Date.now());
        void l2PutResource(key, entry); // best-effort cross-isolate write
      }
      return entry;
    } catch (error) {
      if ((error as { name?: string } | null)?.name === "AbortError") {
        throw new IptvRelayUpstreamError(504, "Upstream resource timed out");
      }
      throw error;
    } finally {
      timeout.clear();
      resourceInflight.delete(key);
    }
  })();

  resourceInflight.set(key, pending);
  return pending;
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
  resourceCacheBytes = 0;
}
