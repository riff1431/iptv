// Server-only. AES-256-GCM encryption for IPTV credentials at rest.
// Format: "enc:v1:<ivB64>:<tagB64>:<ciphertextB64>"
// Values without the "enc:v1:" prefix are treated as legacy plaintext so
// existing rows keep working until they are re-saved.

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const PREFIX = "enc:v1:";

function getKey(): Buffer {
  const raw = process.env.IPTV_ENCRYPTION_KEY;
  if (!raw) throw new Error("IPTV_ENCRYPTION_KEY not configured");
  return createHash("sha256").update(raw, "utf8").digest();
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return plaintext;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(value: string | null | undefined): string {
  if (!value) return "";
  if (!value.startsWith(PREFIX)) return value; // legacy plaintext
  const [, , ivB64, tagB64, ctB64] = value.split(":");
  if (!ivB64 || !tagB64 || !ctB64) return "";
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      getKey(),
      Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64")),
      decipher.final(),
    ]);
    return dec.toString("utf8");
  } catch (err) {
    console.error("[crypto] Decryption failed (key changed or payload invalid):", err);
    return "";
  }
}

export function isEncrypted(value: string | null | undefined): boolean {
  return !!value && value.startsWith(PREFIX);
}
