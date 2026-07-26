/**
 * /api/public/iptv/stream — Binary media segment proxy.
 *
 * Purpose: Pipe HLS `.ts` chunks (and any other binary media segments) from
 * an upstream IPTV provider back to the browser with zero-copy streaming.
 *
 * Why a separate route from /playlist?
 *   • No 8 MiB text cap — video segments are binary and can be multi-megabyte.
 *   • No ETag / Last-Modified rewriting — live segments are ephemeral.
 *   • `no-store` cache policy — browsers must never cache live chunks.
 *   • Streaming passthrough via ReadableStream — keeps time-to-first-byte low
 *     and avoids buffering the entire segment in server memory.
 *   • Skips the Supabase throttle logic that only makes sense for SSRF probing.
 *
 * Security:
 *   • Reuses the same SSRF guard (`validateUrl`) from the playlist proxy to
 *     prevent the endpoint being used as a general-purpose HTTP relay.
 *   • Only GET and OPTIONS are handled; all other methods get 405.
 *   • The upstream User-Agent matches browser patterns (providers often 403
 *     bot-style UAs on segment requests).
 */

import { createFileRoute } from "@tanstack/react-router";
import { Readable } from "node:stream";

// ─── SSRF Guard ────────────────────────────────────────────────────────────

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);
// Same port allowlist as the playlist proxy — keep in sync.
const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);
const MAX_URL_LEN = 2048;
// 30 s — segments should arrive well within this on any reasonable CDN.
const TIMEOUT_MS = 30_000;

function ipv4Blocked(a: number, b: number): boolean {
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51) return true;
  if (a === 203 && b === 0) return true;
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (h === "metadata.google.internal" || h === "metadata" || h === "instance-data") return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    if (parts.some((p) => p > 255)) return true;
    if (ipv4Blocked(parts[0], parts[1])) return true;
  }
  if (/^[0-9]+$/.test(h) || /^0x[0-9a-f]+$/.test(h)) return true;
  const h6 = h.replace(/^\[|\]$/g, "");
  if (h6 === "::" || h6 === "::1") return true;
  if (h6.startsWith("fe80") || h6.startsWith("fc") || h6.startsWith("fd")) return true;
  if (h6.startsWith("::ffff:")) return true;
  return false;
}

function validateUrl(raw: string): { ok: true; url: URL } | { ok: false; message: string } {
  if (typeof raw !== "string" || raw.length === 0) return { ok: false, message: "Missing URL" };
  if (raw.length > MAX_URL_LEN) return { ok: false, message: "URL exceeds maximum length" };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F\s]/.test(raw))
    return { ok: false, message: "URL contains disallowed characters" };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, message: "Invalid URL" };
  }
  if (!ALLOWED_SCHEMES.has(u.protocol)) return { ok: false, message: "Only http(s) URLs allowed" };
  if (u.username || u.password) return { ok: false, message: "URL must not contain credentials" };
  if (!ALLOWED_PORTS.has(u.port))
    return { ok: false, message: `Port ${u.port || "(none)"} is not allowed` };
  if (!u.hostname) return { ok: false, message: "URL host is required" };
  if (isBlockedHost(u.hostname)) return { ok: false, message: "URL host is not allowed" };
  if (u.hostname.startsWith("xn--") || u.hostname.includes(".xn--"))
    return { ok: false, message: "Internationalised hostnames are not allowed" };
  u.hash = "";
  return { ok: true, url: u };
}

// ─── CORS Headers ──────────────────────────────────────────────────────────

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Content-Type",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Content-Type",
  "Access-Control-Max-Age": "86400",
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function errorJson(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

/**
 * Derive a safe Content-Type from the upstream response and segment URL.
 * Falls back to `video/mp2t` for `.ts` files regardless of what the upstream
 * sends (some providers return `application/octet-stream` or `text/plain`).
 */
function resolveContentType(upstreamCt: string | null, segmentUrl: string): string {
  if (upstreamCt) {
    const ct = upstreamCt.toLowerCase();
    if (
      ct.includes("video/") ||
      ct.includes("audio/") ||
      ct.includes("application/octet-stream") ||
      ct.includes("application/vnd.apple.mpegurl") ||
      ct.includes("application/x-mpegurl")
    ) {
      return upstreamCt;
    }
  }
  // Infer from extension when the upstream type is ambiguous.
  const lower = segmentUrl.toLowerCase().split("?")[0];
  if (lower.endsWith(".ts")) return "video/mp2t";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".mp4") || lower.endsWith(".m4s")) return "video/mp4";
  if (lower.endsWith(".m3u8") || lower.endsWith(".m3u")) return "application/vnd.apple.mpegurl";
  if (lower.endsWith(".vtt")) return "text/vtt";
  return "application/octet-stream";
}

// ─── Route ─────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/api/public/iptv/stream")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      GET: async ({ request }) => {
        const target = new URL(request.url).searchParams.get("url");

        if (!target) return errorJson(400, "Missing 'url' query parameter");

        const v = validateUrl(target);
        if (!v.ok) return errorJson(400, v.message);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

        try {
          // Forward the browser's Range header so partial-content / seek works.
          const forwardHeaders: Record<string, string> = {
            // Use a browser-style UA — some CDNs return 403 to bot UAs on segments.
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            Accept: "*/*",
          };
          const rangeHeader = request.headers.get("range");
          if (rangeHeader) forwardHeaders["Range"] = rangeHeader;

          const upstream = await fetch(v.url.toString(), {
            method: "GET",
            redirect: "follow",
            signal: controller.signal,
            headers: forwardHeaders,
          });

          // Surface upstream auth / not-found errors as structured JSON.
          // Note: Xtream Codes servers return HTTP status 458 for live media streams.
          if (!upstream.ok && upstream.status !== 206 && upstream.status !== 458) {
            return errorJson(
              upstream.status === 403 || upstream.status === 401 ? upstream.status : 502,
              `Upstream returned HTTP ${upstream.status}`,
            );
          }

          const contentType = resolveContentType(
            upstream.headers.get("content-type"),
            v.url.toString(),
          );

          // Build response headers.
          const resHeaders: Record<string, string> = {
            "Content-Type": contentType,
            // Live segments must never be cached by intermediate proxies or browsers.
            "Cache-Control": "no-store",
            // Disable Nginx / Cloudflare response buffering for real-time chunk delivery.
            "X-Accel-Buffering": "no",
            ...CORS,
          };

          // Pass through Content-Length if present so hls.js can track progress.
          const cl = upstream.headers.get("content-length");
          if (cl) resHeaders["Content-Length"] = cl;

          // Pass through Content-Range for 206 Partial Content responses.
          const cr = upstream.headers.get("content-range");
          if (cr) resHeaders["Content-Range"] = cr;

          // Stream the body directly through Node.js / Nitro stream handler.
          const bodyStream = upstream.body
            ? (Readable.fromWeb as any)(upstream.body)
            : upstream.body;

          return new Response(bodyStream as any, {
            status: upstream.status === 206 ? 206 : 200,
            headers: resHeaders,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Upstream fetch failed";
          const status = msg.toLowerCase().includes("abort") ? 504 : 502;
          return errorJson(status, msg);
        } finally {
          clearTimeout(timer);
        }
      },
    },
  },
});
