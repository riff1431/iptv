/**
 * Browser-shaped upstream headers shared by IPTV playlist and segment fetches.
 * Some Xtream/CDN providers reject VLC/bot user agents on media segments even
 * when the manifest request succeeds.
 */
export const IPTV_UPSTREAM_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
} as const;

export function isHlsManifestBody(body: string): boolean {
  return body.trimStart().startsWith("#EXTM3U");
}

export function isUsablePlaylistResponse(status: number, body: string): boolean {
  return ((status >= 200 && status < 300) || status === 458) && isHlsManifestBody(body);
}

export function getXtreamPlaylistError(status: number, body: string): string | null {
  if (status !== 458 || isHlsManifestBody(body)) return null;
  return "Xtream provider rejected the stream (HTTP 458). The account connection limit may already be in use.";
}
