// Server-only helpers for signing proxied HLS segment URLs.
// Credentials never leave the server — we hand the browser opaque, short-lived
// URLs pointing back to our own segment proxy, which then fetches upstream.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "crypto";

const TOKEN_TTL_SECONDS = 60 * 10; // 10 minutes

function getKey(): string {
  const k = process.env.IPTV_PROXY_SIGNING_KEY;
  if (!k) throw new Error("IPTV_PROXY_SIGNING_KEY not configured");
  return k;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(input: string): Buffer {
  const pad = 4 - (input.length % 4);
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + (pad < 4 ? "=".repeat(pad) : "");
  return Buffer.from(b64, "base64");
}

function encryptionKey(): Buffer {
  return createHash("sha256").update(getKey()).digest();
}

/** Sign an upstream URL for `tvId`. Returns `?u=...&e=...&s=...`. */
export function signSegmentUrl(tvId: string, upstreamUrl: string): string {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`${tvId}.${exp}`));
  const ciphertext = Buffer.concat([cipher.update(upstreamUrl, "utf8"), cipher.final()]);
  const u = b64url(Buffer.concat([iv, cipher.getAuthTag(), ciphertext]));
  const payload = `${tvId}.${u}.${exp}`;
  const sig = b64url(createHmac("sha256", getKey()).update(payload).digest());
  return `u=${u}&e=${exp}&s=${sig}`;
}

/** Returns the original upstream URL if the token is valid + fresh, else null. */
export function verifySegmentToken(
  tvId: string,
  u: string | null,
  e: string | null,
  s: string | null,
): string | null {
  if (!u || !e || !s) return null;
  const exp = Number(e);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  const expected = b64url(createHmac("sha256", getKey()).update(`${tvId}.${u}.${exp}`).digest());
  const a = Buffer.from(expected);
  const b = Buffer.from(s);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const sealed = fromB64url(u);
    if (sealed.byteLength < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), sealed.subarray(0, 12));
    decipher.setAAD(Buffer.from(`${tvId}.${exp}`));
    decipher.setAuthTag(sealed.subarray(12, 28));
    const plaintext = Buffer.concat([
      decipher.update(sealed.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
    const parsed = new URL(plaintext);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? plaintext : null;
  } catch {
    return null;
  }
}

/**
 * Rewrite a text HLS playlist so every media/segment URI is routed through our
 * signed segment proxy. Preserves comments/tags and resolves relative URIs
 * against the upstream playlist URL.
 */
export function rewritePlaylist(
  playlist: string,
  tvId: string,
  upstreamPlaylistUrl: string,
  segmentProxyPath: string, // e.g. "/api/sports-arena/tv/<id>/seg"
): string {
  const base = new URL(upstreamPlaylistUrl);
  const rewriteOne = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return raw;
    const abs = new URL(trimmed, base).toString();
    return `${segmentProxyPath}?${signSegmentUrl(tvId, abs)}`;
  };

  return playlist
    .split(/\r?\n/)
    .map((line) => {
      if (!line || line.startsWith("#")) {
        // Also rewrite URI="..." inside tags (EXT-X-KEY, EXT-X-MAP, EXT-X-MEDIA).
        return line.replace(/URI="([^"]+)"/g, (_m, uri: string) => {
          const abs = new URL(uri, base).toString();
          return `URI="${segmentProxyPath}?${signSegmentUrl(tvId, abs)}"`;
        });
      }
      return rewriteOne(line);
    })
    .join("\n");
}
