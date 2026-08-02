import http from "node:http";
import https from "node:https";

/**
 * Browser-shaped upstream headers shared by IPTV playlist and segment fetches.
 * Some Xtream/CDN providers reject VLC/bot user agents on media segments even
 * when the manifest request succeeds.
 */
export const IPTV_UPSTREAM_HEADERS = {
  "User-Agent": "VLC/3.0.20 LibVLC/3.0.20",
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

/**
 * Custom lightweight HTTP/HTTPS client to bypass Cloudflare fingerprinting/blocking
 * on Node.js global fetch. Uses Node's native socket/http/https libraries.
 */
export async function customFetch(
  initialUrl: string,
  options: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    method?: string;
    redirect?: "follow" | "manual";
  } = {}
): Promise<Response> {
  const method = options.method || "GET";
  const redirectMode = options.redirect || "follow";
  const maxRedirects = 5;
  let currentUrl = initialUrl;
  let redirectCount = 0;

  while (true) {
    const parsedUrl = new URL(currentUrl);
    const isHttps = parsedUrl.protocol === "https:";
    const lib = isHttps ? https : http;

    const requestHeaders: Record<string, string> = { ...options.headers };
    const hostKey = Object.keys(requestHeaders).find(k => k.toLowerCase() === "host") || "Host";
    requestHeaders[hostKey] = parsedUrl.host;

    const res = await new Promise<any>((resolve, reject) => {
      const reqOpts = {
        method,
        headers: requestHeaders,
      };

      const req = lib.request(currentUrl, reqOpts, (response) => {
        resolve(response);
      });

      if (options.signal) {
        const onAbort = () => {
          req.destroy();
          reject(new Error("aborted"));
        };
        options.signal.addEventListener("abort", onAbort);
        req.on("close", () => {
          options.signal?.removeEventListener("abort", onAbort);
        });
      }

      req.on("error", (err) => {
        reject(err);
      });

      req.end();
    });

    const status = res.statusCode || 200;

    if (
      redirectMode === "follow" &&
      status >= 300 &&
      status < 400 &&
      res.headers.location
    ) {
      if (redirectCount >= maxRedirects) {
        throw new Error("Too many redirects");
      }
      redirectCount++;
      currentUrl = new URL(res.headers.location, currentUrl).toString();
      continue;
    }

    const headersMap = new Headers();
    Object.entries(res.headers).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach(v => headersMap.append(key, v));
      } else if (value !== undefined && value !== null) {
        headersMap.set(key, String(value));
      }
    });

    const bodyPromise = new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", (err: any) => reject(err));
    });

    const responseBody = await bodyPromise;

    const realResponse = new Response(new Uint8Array(responseBody), {
      status,
      statusText: res.statusMessage || "",
      headers: headersMap,
    });

    Object.defineProperty(realResponse, "url", {
      value: currentUrl,
      writable: false,
      configurable: true,
      enumerable: true
    });

    return realResponse;
  }
}
