import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "crypto";

const RELAY_TOKEN_TTL_SECONDS = 15 * 60;
const RELAY_ACCESS_TTL_SECONDS = 6 * 60 * 60;

function getSecret(): Buffer {
  const raw = process.env.IPTV_PROXY_SIGNING_KEY;
  if (!raw) throw new Error("IPTV_PROXY_SIGNING_KEY not configured");
  return createHash("sha256").update(`pgx-iptv-relay:${raw}`, "utf8").digest();
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(input: string): Buffer {
  const pad = input.length % 4;
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + (pad ? "=".repeat(4 - pad) : "");
  return Buffer.from(b64, "base64");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signRelayAccess(scope: string, ttlSeconds = RELAY_ACCESS_TTL_SECONDS): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${scope}.${exp}`;
  const sig = b64url(createHmac("sha256", getSecret()).update(payload).digest());
  return `${exp}.${sig}`;
}

export function verifyRelayAccess(scope: string, token: string | null): boolean {
  if (!token) return false;
  const separator = token.indexOf(".");
  if (separator <= 0) return false;
  const expRaw = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const exp = Number(expRaw);
  if (!Number.isSafeInteger(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = b64url(createHmac("sha256", getSecret()).update(`${scope}.${expRaw}`).digest());
  return safeEqual(expected, signature);
}

export function sealRelayUrl(
  scope: string,
  upstreamUrl: string,
  ttlSeconds = RELAY_TOKEN_TTL_SECONDS,
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const plaintext = JSON.stringify({ url: upstreamUrl, exp });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getSecret(), iv);
  cipher.setAAD(Buffer.from(scope, "utf8"));
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${b64url(iv)}.${b64url(tag)}.${b64url(encrypted)}`;
}

export function openRelayUrl(scope: string, token: string | null): string | null {
  if (!token) return null;
  const [ivRaw, tagRaw, ciphertextRaw, ...extra] = token.split(".");
  if (!ivRaw || !tagRaw || !ciphertextRaw || extra.length > 0) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", getSecret(), fromB64url(ivRaw));
    decipher.setAAD(Buffer.from(scope, "utf8"));
    decipher.setAuthTag(fromB64url(tagRaw));
    const plaintext = Buffer.concat([
      decipher.update(fromB64url(ciphertextRaw)),
      decipher.final(),
    ]).toString("utf8");
    const payload = JSON.parse(plaintext) as { url?: unknown; exp?: unknown };
    if (
      typeof payload.url !== "string" ||
      !Number.isSafeInteger(payload.exp) ||
      Number(payload.exp) < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    const parsed = new URL(payload.url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
