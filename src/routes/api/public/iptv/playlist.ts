import { createFileRoute } from "@tanstack/react-router";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const MAX_BYTES = 8 * 1024 * 1024; // 8 MiB
const TIMEOUT_MS = 15_000;
const MAX_URL_LEN = 2048;

// Only allow the common HTTP(S) service ports. IPTV providers universally
// serve on these; anything else (SSH, SMTP, Redis, internal admin panels,
// EC2 metadata, etc.) is refused to shrink the SSRF surface.
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);
const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

function ipv4Blocked(a: number, b: number): boolean {
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 169 && b === 254) return true; // link-local / AWS/GCP metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 & 192.0.2.0/24 (docs/test)
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
  if (a === 198 && b === 51) return true; // TEST-NET-2
  if (a === 203 && b === 0) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast + reserved (224.0.0.0/4 & 240.0.0.0/4)
  return false;
}

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (!h) return true;
  // Bare "localhost", any *.localhost, and the mDNS *.local suffix.
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  // Internal cloud metadata hostnames that resolve to 169.254.169.254.
  if (h === "metadata.google.internal" || h === "metadata" || h === "instance-data") return true;

  // IPv4 literal checks (must be four 0-255 octets).
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    if (parts.some((p) => p > 255)) return true;
    if (ipv4Blocked(parts[0], parts[1])) return true;
  }
  // Reject any other numeric-only host (decimal / octal / hex IPv4 shorthand
  // like 2130706433 or 0x7f000001 which URL.hostname will happily accept).
  if (/^[0-9]+$/.test(h) || /^0x[0-9a-f]+$/.test(h)) return true;

  // IPv6 loopback / unspecified / link-local / ULA / IPv4-mapped.
  const h6 = h.replace(/^\[|\]$/g, "");
  if (h6 === "::" || h6 === "::1") return true;
  if (h6.startsWith("fe80") || h6.startsWith("fc") || h6.startsWith("fd")) return true;
  if (h6.startsWith("::ffff:")) return true; // IPv4-mapped IPv6
  return false;
}

function validateUrl(raw: string): { ok: true; url: URL } | { ok: false; message: string } {
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, message: "Missing URL" };
  }
  if (raw.length > MAX_URL_LEN) {
    return { ok: false, message: "URL exceeds maximum length" };
  }
  // Reject control chars and whitespace inside the URL — these can smuggle
  // header/host bytes through some HTTP clients.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F\s]/.test(raw)) {
    return { ok: false, message: "URL contains disallowed whitespace or control characters" };
  }

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, message: "Invalid URL" };
  }
  if (!ALLOWED_SCHEMES.has(u.protocol)) {
    return { ok: false, message: "Only http(s) URLs are allowed" };
  }
  // Strip userinfo (`user:pass@host`) — a common SSRF bypass vector.
  if (u.username || u.password) {
    return { ok: false, message: "URL must not contain credentials" };
  }
  if (!ALLOWED_PORTS.has(u.port)) {
    return { ok: false, message: `Port ${u.port || "(none)"} is not allowed` };
  }
  if (!u.hostname) {
    return { ok: false, message: "URL host is required" };
  }
  if (isBlockedHost(u.hostname)) {
    return { ok: false, message: "URL host is not allowed" };
  }
  // Reject IDN/punycode hostnames — they can be used for homograph attacks
  // against downstream allowlists.
  if (u.hostname.startsWith("xn--") || u.hostname.includes(".xn--")) {
    return { ok: false, message: "Internationalised hostnames are not allowed" };
  }

  // Normalise: drop fragments (never sent on the wire anyway).
  u.hash = "";
  return { ok: true, url: u };
}

async function readCapped(res: Response, cap: number): Promise<string> {
  const text = await res.text();
  if (Buffer.byteLength(text, "utf-8") > cap) {
    throw new Error(`Playlist exceeds ${Math.round(cap / 1024 / 1024)} MiB limit`);
  }
  return text;
}

function errorResponse(status: number, message: string, requestId: string): Response {
  return new Response(JSON.stringify({ error: message, requestId }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": requestId,
      ...CORS,
    },
  });
}

/**
 * Best-effort host extraction for audit logging. We never trust the raw
 * `url` param past validation, but we do want to see *what host* the caller
 * tried to reach when their request was refused. Returns null when the URL
 * can't be parsed at all.
 */
function normalizeHostForLog(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    // hostname is already lowercased & IDN-decoded by the URL parser for
    // http(s); strip brackets from IPv6 literals for cleaner log lines.
    return u.hostname.replace(/^\[|\]$/g, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Single-line JSON audit log for a rejected proxy request. Emitted at warn
 * level so it's picked up by the standard log pipeline without polluting
 * info-level output. Never includes headers, cookies, or the full URL —
 * only the normalized host + reason + client identifiers.
 */
function logRejection(entry: {
  requestId: string;
  status: number;
  reason: string;
  host: string | null;
  rawUrlLength: number;
  method: string;
  ip: string | null;
  userAgent: string | null;
}): void {
  console.warn(
    JSON.stringify({
      event: "iptv_proxy_rejected",
      ts: new Date().toISOString(),
      ...entry,
    }),
  );
  // Best-effort persistence for the admin audit page. Errors are swallowed —
  // we never want a logging failure to change the response the client sees.
  void (async () => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("iptv_proxy_rejections").insert({
        request_id: entry.requestId,
        status: entry.status,
        reason: entry.reason,
        host: entry.host,
        raw_url_length: entry.rawUrlLength,
        method: entry.method,
        ip: entry.ip,
        user_agent: entry.userAgent,
      });
    } catch (err) {
      console.warn("iptv_proxy_rejected persist failed", err);
    }
  })();
}

// Throttling tunables. A client that trips the SSRF guard more than
// THROTTLE_HIT_LIMIT times inside THROTTLE_WINDOW_MS earns a soft block for
// THROTTLE_BLOCK_MS — cheap enough to shed floods without permanently locking
// out a shared NAT after one bad request.
const THROTTLE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const THROTTLE_HIT_LIMIT = 10;
const THROTTLE_BLOCK_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Look up whether `ip` is currently blocked. Returns the expiry timestamp if
 * a live block exists, otherwise null. Failures resolve to null so an outage
 * in the audit database never turns into a global proxy outage.
 */
async function getActiveBlock(ip: string): Promise<Date | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("iptv_proxy_ip_blocks")
      .select("blocked_until")
      .eq("ip", ip)
      .gt("blocked_until", new Date().toISOString())
      .maybeSingle();
    if (error || !data) return null;
    return new Date(data.blocked_until);
  } catch {
    return null;
  }
}

/**
 * After each rejection, count how many times this IP was rejected inside the
 * rolling window and upsert a block row when it crosses the threshold.
 */
async function maybeThrottle(ip: string, latestReason: string): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - THROTTLE_WINDOW_MS).toISOString();
    const { count, error } = await supabaseAdmin
      .from("iptv_proxy_rejections")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .gte("created_at", since);
    if (error || count === null) return;
    if (count < THROTTLE_HIT_LIMIT) return;

    const now = new Date();
    const blockedUntil = new Date(now.getTime() + THROTTLE_BLOCK_MS);
    await supabaseAdmin.from("iptv_proxy_ip_blocks").upsert(
      {
        ip,
        blocked_until: blockedUntil.toISOString(),
        reason: latestReason,
        hits: count,
        updated_at: now.toISOString(),
      },
      { onConflict: "ip" },
    );
    console.warn(
      JSON.stringify({
        event: "iptv_proxy_ip_throttled",
        ts: now.toISOString(),
        ip,
        hits: count,
        window_ms: THROTTLE_WINDOW_MS,
        blocked_until: blockedUntil.toISOString(),
        reason: latestReason,
      }),
    );
  } catch (err) {
    console.warn("iptv_proxy_ip_throttled upsert failed", err);
  }
}

const PROXY_PATH = "/api/public/iptv/playlist";
// Dedicated binary streaming endpoint for media segments (.ts chunks, .mp4
// init segments, .aac etc.). Kept separate from PROXY_PATH so segments get
// zero-copy streaming with no 8 MiB cap and no ETag rewriting.
const STREAM_PATH = "/api/public/iptv/stream";

/**
 * Classify a URI to decide which proxy path to route it through.
 *
 * - Sub-playlists (.m3u8) → /api/public/iptv/playlist  (text, rewriteable)
 * - Media segments (.ts, .aac, .mp4, .m4s, .m4v, .key) →
 *                          /api/public/iptv/stream     (binary, streaming)
 *
 * Using a dedicated streaming route for segments avoids two problems:
 *   1. The 8 MiB text cap in the playlist proxy would truncate large segments.
 *   2. Buffering the full segment in memory before returning it adds latency.
 */
function classifyUri(abs: string): "playlist" | "stream" {
  // Strip query string before checking extension.
  const path = abs.toLowerCase().split("?")[0];
  if (path.endsWith(".m3u8") || path.endsWith(".m3u")) return "playlist";
  // Binary media types → stream proxy.
  if (
    path.endsWith(".ts") ||
    path.endsWith(".aac") ||
    path.endsWith(".mp4") ||
    path.endsWith(".m4s") ||
    path.endsWith(".m4v") ||
    path.endsWith(".key") ||
    path.endsWith(".bin")
  )
    return "stream";
  // HLS key / init segment paths that don't have a recognisable extension
  // (e.g. /hls/{token}/{id}_{seq} with no extension) → stream proxy.
  // A rough heuristic: if the path segment after the last slash contains no
  // dot at all, treat it as a binary segment.
  const lastSegment = path.split("/").pop() ?? "";
  if (!lastSegment.includes(".")) return "stream";
  // Conservative fallback: unknown extension goes to the playlist proxy which
  // will sniff Content-Type and re-route accordingly.
  return "playlist";
}

/**
 * Rewrite URIs inside an HLS/M3U playlist so that every referenced
 * sub-playlist, segment, encryption key, and init-map is fetched through our
 * server-side proxies. Relative URIs are resolved against `base` (the upstream
 * URL we just fetched). Non-HLS bodies are returned unchanged.
 *
 * Sub-playlists → /api/public/iptv/playlist  (SSRF-guarded, text)
 * Media segments → /api/public/iptv/stream   (SSRF-guarded, binary stream)
 */
function rewritePlaylist(body: string, base: URL): string {
  if (!body.startsWith("#EXTM3U")) return body;

  const rewriteUri = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return raw;
    // Data / blob URIs and already-proxied URLs pass through untouched.
    if (/^(data|blob):/i.test(trimmed)) return trimmed;
    if (trimmed.startsWith(PROXY_PATH) || trimmed.startsWith(STREAM_PATH)) return trimmed;
    let abs: string;
    try {
      abs = new URL(trimmed, base).toString();
    } catch {
      return raw; // Unparseable — leave as-is to avoid breaking the playlist.
    }
    const route = classifyUri(abs);
    const proxyBase = route === "stream" ? STREAM_PATH : PROXY_PATH;
    return `${proxyBase}?url=${encodeURIComponent(abs)}`;
  };

  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (line.startsWith("#")) {
      // Rewrite URI="..." attributes on HLS tags:
      //   EXT-X-KEY, EXT-X-MAP, EXT-X-MEDIA, EXT-X-SESSION-KEY,
      //   EXT-X-I-FRAME-STREAM-INF, EXT-X-SESSION-DATA, etc.
      if (line.includes('URI="')) {
        lines[i] = line.replace(/URI="([^"]*)"/g, (_m, uri: string) => `URI="${rewriteUri(uri)}"`);
      }
      continue;
    }
    // Non-comment, non-empty line = a segment URI or variant playlist URI.
    lines[i] = rewriteUri(line);
  }
  return lines.join("\n");
}

export const Route = createFileRoute("/api/public/iptv/playlist")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        // Prefer an inbound request id from the CDN / gateway; otherwise
        // mint one so logs and the response body/header agree.
        const requestId =
          request.headers.get("x-request-id") ||
          request.headers.get("cf-ray") ||
          (globalThis.crypto?.randomUUID?.() ?? `req-${Date.now().toString(36)}`);
        const ip =
          request.headers.get("cf-connecting-ip") ||
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          null;
        const userAgent = request.headers.get("user-agent");
        const target = new URL(request.url).searchParams.get("url");

        const reject = (status: number, message: string): Response => {
          logRejection({
            requestId,
            status,
            reason: message,
            host: normalizeHostForLog(target),
            rawUrlLength: target?.length ?? 0,
            method: "GET",
            ip,
            userAgent,
          });
          // Only SSRF-guard rejections (400s) count toward throttling. 5xx
          // upstream failures aren't the caller's fault.
          if (ip && status >= 400 && status < 500) {
            void maybeThrottle(ip, message);
          }
          return errorResponse(status, message, requestId);
        };

        // Short-circuit blocked IPs BEFORE parsing the target URL so a
        // throttled client can't burn CPU / audit rows on our end.
        if (ip) {
          const blockedUntil = await getActiveBlock(ip);
          if (blockedUntil) {
            const retryAfterSec = Math.max(
              1,
              Math.ceil((blockedUntil.getTime() - Date.now()) / 1000),
            );
            logRejection({
              requestId,
              status: 429,
              reason: "IP temporarily throttled after repeated SSRF blocks",
              host: normalizeHostForLog(target),
              rawUrlLength: target?.length ?? 0,
              method: "GET",
              ip,
              userAgent,
            });
            return new Response(
              JSON.stringify({
                error: "Too many blocked requests from this client. Try again later.",
                requestId,
                retryAfterSeconds: retryAfterSec,
              }),
              {
                status: 429,
                headers: {
                  "Content-Type": "application/json",
                  "Retry-After": String(retryAfterSec),
                  "X-Request-Id": requestId,
                  ...CORS,
                },
              },
            );
          }
        }

        if (!target) return reject(400, "Missing 'url' query parameter");
        const v = validateUrl(target);
        if (!v.ok) return reject(400, v.message);

        const ifNoneMatch = request.headers.get("if-none-match");
        const ifModifiedSince = request.headers.get("if-modified-since");

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
          const upstreamHeaders: Record<string, string> = {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            Accept: "*/*",
            "Accept-Language": "en-US,en;q=0.9",
          };
          if (ifNoneMatch) upstreamHeaders["If-None-Match"] = ifNoneMatch;
          if (ifModifiedSince) upstreamHeaders["If-Modified-Since"] = ifModifiedSince;

          const upstream = await fetch(v.url.toString(), {
            method: "GET",
            redirect: "follow",
            signal: controller.signal,
            headers: upstreamHeaders,
          });

          const cacheHeaders: Record<string, string> = {
            // Live HLS manifests must never be cached — hls.js polls them on a
            // ~10 s cycle to get fresh segment tokens. A stale cached manifest
            // returns expired tokens that the CDN rejects with 403.
            "Cache-Control": "no-store",
            Vary: "Accept-Encoding",
          };
          const etag = upstream.headers.get("etag");
          const lastModified = upstream.headers.get("last-modified");
          if (etag) cacheHeaders["ETag"] = etag;
          if (lastModified) cacheHeaders["Last-Modified"] = lastModified;

          // Upstream (or our conditional request) says client cache is still fresh.
          if (upstream.status === 304) {
            return new Response(null, {
              status: 304,
              headers: { ...cacheHeaders, "X-Request-Id": requestId, ...CORS },
            });
          }
          if (!upstream.ok && upstream.status !== 458) {
            return reject(502, `Upstream returned HTTP ${upstream.status}`);
          }

          const contentType = upstream.headers.get("content-type") || "";

          // Xtream Codes uses the non-standard HTTP 458 status for live HLS
          // manifests. The response body is a valid M3U8 text playlist, but
          // the Content-Type is often wrong ("text/html"). We must read it as
          // text and rewrite URIs — never pass it through as binary.
          //
          // isMediaOrBinary is only true for genuine video/audio binary content
          // (actual .ts chunks, .mp4 init segments, etc.), NOT for 458 manifests.
          const isMediaOrBinary =
            upstream.status !== 458 &&
            (contentType.includes("video/") ||
              contentType.includes("audio/") ||
              contentType.includes("octet-stream"));

          if (isMediaOrBinary && upstream.body) {
            return new Response(upstream.body, {
              status: 200,
              headers: {
                "Content-Type": contentType || "video/mp2t",
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "X-Request-Id": requestId,
                ...CORS,
              },
            });
          }
          const contentLength = Number(upstream.headers.get("content-length") || 0);
          if (contentLength > MAX_BYTES) {
            return reject(413, `Playlist exceeds ${Math.round(MAX_BYTES / 1024 / 1024)} MiB limit`);
          }
          const raw = await readCapped(upstream, MAX_BYTES);

          // Reject empty manifest bodies — an upstream that sends a non-empty
          // status but zero bytes body is broken or returned an error page.
          if (!raw.trim()) {
            return reject(502, "Upstream returned an empty playlist body");
          }

          // Use the post-redirect URL as the base for relative URI resolution.
          // When Xtream issues a 302 → CDN, relative paths like /hls/... must
          // resolve against the CDN host, not the original Xtream URL.
          const resolvedBase = upstream.url ? new URL(upstream.url) : v.url;
          const text = rewritePlaylist(raw, resolvedBase);

          // With Cache-Control: no-store, ETags and conditional GET (304) are
          // not useful for live manifests. Skip the ETag synthesis and 304 check
          // entirely to keep the response path simple and avoid any risk of
          // caching stale token data.

          return new Response(text, {
            status: 200,
            headers: {
              "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
              ...cacheHeaders,
              "X-Request-Id": requestId,
              ...CORS,
            },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Upstream fetch failed";
          const status = msg.includes("aborted") ? 504 : 502;
          return reject(status, msg);
        } finally {
          clearTimeout(timer);
        }
      },
    },
  },
});
