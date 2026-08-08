import http, { type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import https from "node:https";
import { Readable } from "node:stream";

/** Browser-shaped headers accepted by providers without leaking application auth. */
export const IPTV_UPSTREAM_HEADERS = {
  "User-Agent": "VLC/3.0.20 LibVLC/3.0.20",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
} as const;

const ALLOWED_REQUEST_HEADERS = new Set([
  "accept",
  "accept-language",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "if-range",
  "if-unmodified-since",
  "range",
  "user-agent",
]);

const httpAgent = new http.Agent({ keepAlive: true, keepAliveMsecs: 1000, maxSockets: 500, maxFreeSockets: 50 });
const httpsAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 1000, maxSockets: 500, maxFreeSockets: 50 });

function envInt(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

export type UpstreamTimeoutPhase = "headers" | "idle";

export class UpstreamTimeoutError extends Error {
  readonly name = "AbortError";
  readonly code = "IPTV_UPSTREAM_TIMEOUT";

  constructor(readonly phase: UpstreamTimeoutPhase) {
    super(`IPTV upstream ${phase} timeout`);
  }
}

export class UpstreamAbortError extends Error {
  readonly name = "AbortError";
  readonly code = "IPTV_UPSTREAM_ABORTED";

  constructor(message = "IPTV upstream request aborted") {
    super(message);
  }
}

export function classifyUpstreamError(
  error: unknown,
): "headers_timeout" | "idle_timeout" | "client_abort" | "network_error" {
  if (error instanceof UpstreamTimeoutError) return `${error.phase}_timeout`;
  if (
    error instanceof UpstreamAbortError ||
    (error as { name?: string } | null)?.name === "AbortError"
  ) {
    return "client_abort";
  }
  return "network_error";
}

export type UpstreamTiming = {
  startedAt: number;
  headersAt: number;
  firstByteAt: number | null;
  endedAt: number | null;
  bytes: number;
  redirectCount: number;
};

const timingByResponse = new WeakMap<Response, UpstreamTiming>();

export function getUpstreamTiming(response: Response): UpstreamTiming | undefined {
  return timingByResponse.get(response);
}

export function isHlsManifestBody(body: string): boolean {
  return body.trimStart().startsWith("#EXTM3U");
}

export function isUsablePlaylistResponse(status: number, body: string): boolean {
  if (!((status >= 200 && status < 300) || status === 458)) return false;
  const upper = body.toUpperCase();
  return upper.includes("#EXTM3U") && (upper.includes("#EXTINF") || upper.includes("#EXT-X-STREAM-INF") || upper.includes("#EXT-X-TARGETDURATION"));
}

export function getXtreamPlaylistError(status: number, body: string): string | null {
  if (status === 403 && !isHlsManifestBody(body)) {
    return "Xtream provider returned HTTP 403 Forbidden. The account connection limit may be exceeded.";
  }
  if (status !== 458 || isHlsManifestBody(body)) return null;
  return "Xtream provider rejected the stream (HTTP 458). The account connection limit may already be in use.";
}

function safeRequestHeaders(
  input: Record<string, string> | undefined,
  target: URL,
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (ALLOWED_REQUEST_HEADERS.has(key.toLowerCase())) output[key] = value;
  }
  output.Host = target.host;
  return output;
}

function responseHeaders(input: IncomingHttpHeaders): Headers {
  const output = new Headers();
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) value.forEach((item) => output.append(key, item));
    else if (value !== undefined) output.set(key, String(value));
  }
  return output;
}

type NativeResult = { response: IncomingMessage; request: http.ClientRequest; headersAt: number };

function nativeRequest(
  target: URL,
  method: string,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
  headersTimeoutMs: number,
  idleTimeoutMs: number,
): Promise<NativeResult> {
  return new Promise((resolve, reject) => {
    const transport = target.protocol === "https:" ? https : http;
    let settled = false;
    let activeResponse: IncomingMessage | undefined;
    let abortListener: (() => void) | undefined;
    const request = transport.request(target, {
      method,
      headers,
      agent: target.protocol === "https:" ? httpsAgent : httpAgent,
    });

    const fail = (error: Error) => {
      if (activeResponse) activeResponse.destroy(error);
      request.destroy(error);
      if (!settled) {
        settled = true;
        cleanupEarly();
        reject(error);
      }
    };
    const cleanupEarly = () => {
      clearTimeout(headerTimer);
      if (signal && abortListener) signal.removeEventListener("abort", abortListener);
    };
    const onError = (error: Error) => {
      if (!settled) {
        settled = true;
        cleanupEarly();
        reject(error);
      }
    };

    request.once("error", onError);
    request.setTimeout(idleTimeoutMs, () => fail(new UpstreamTimeoutError("idle")));
    const headerTimer = setTimeout(
      () => fail(new UpstreamTimeoutError("headers")),
      headersTimeoutMs,
    );

    if (signal) {
      abortListener = () => fail(new UpstreamAbortError());
      if (signal.aborted) {
        abortListener();
        return;
      }
      signal.addEventListener("abort", abortListener, { once: true });
    }

    request.once("response", (response) => {
      if (settled) {
        response.destroy();
        return;
      }
      settled = true;
      activeResponse = response;
      clearTimeout(headerTimer);

      const cleanupBody = () => {
        request.setTimeout(0);
        if (signal && abortListener) signal.removeEventListener("abort", abortListener);
      };
      response.once("end", cleanupBody);
      response.once("close", cleanupBody);
      response.once("error", cleanupBody);
      resolve({ response, request, headersAt: Date.now() });
    });
    request.end();
  });
}

async function discardRedirect(response: IncomingMessage): Promise<void> {
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      response.removeListener("end", finish);
      response.removeListener("close", finish);
      response.removeListener("error", finish);
      resolve();
    };
    response.once("end", finish);
    response.once("close", finish);
    response.once("error", finish);
    response.resume();
  });
}

/**
 * Node HTTP(S) client that resolves at upstream headers and exposes the native
 * response as a web stream. It never buffers media and never decompresses it.
 */
export async function customFetch(
  initialUrl: string,
  options: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    method?: string;
    redirect?: "follow" | "manual";
    maxRedirects?: number;
    headersTimeoutMs?: number;
    idleTimeoutMs?: number;
  } = {},
): Promise<Response> {
  const startedAt = Date.now();
  const method = options.method ?? "GET";
  const redirectMode = options.redirect ?? "follow";
  const maxRedirects = Math.min(10, Math.max(0, options.maxRedirects ?? 5));
  const headersTimeoutMs =
    options.headersTimeoutMs ?? envInt("IPTV_UPSTREAM_HEADERS_TIMEOUT_MS", 10_000, 500, 60_000);
  const idleTimeoutMs =
    options.idleTimeoutMs ?? envInt("IPTV_UPSTREAM_IDLE_TIMEOUT_MS", 40_000, 1_000, 120_000);
  let currentUrl = new URL(initialUrl);
  let redirectCount = 0;

  if (currentUrl.protocol !== "http:" && currentUrl.protocol !== "https:") {
    throw new Error("Unsupported IPTV upstream protocol");
  }

  for (;;) {
    const { response, headersAt } = await nativeRequest(
      currentUrl,
      method,
      safeRequestHeaders(options.headers, currentUrl),
      options.signal,
      headersTimeoutMs,
      idleTimeoutMs,
    );
    const status = response.statusCode ?? 502;
    const location = response.headers.location;
    if (redirectMode === "follow" && status >= 300 && status < 400 && location) {
      if (redirectCount >= maxRedirects) {
        response.destroy();
        throw new Error("Too many IPTV upstream redirects");
      }
      await discardRedirect(response);
      const nextUrl = new URL(location, currentUrl);
      // Xtream Codes often hardcodes its local HTTP IP in redirects.
      // Force it to stay on the original hostname/protocol (e.g. Cloudflare) to prevent IP mismatch.
      if (nextUrl.pathname.startsWith("/auth/")) {
        nextUrl.protocol = currentUrl.protocol;
        nextUrl.hostname = currentUrl.hostname;
        nextUrl.port = currentUrl.port;
      }
      currentUrl = nextUrl;
      if (currentUrl.protocol !== "http:" && currentUrl.protocol !== "https:") {
        throw new Error("Unsupported IPTV redirect protocol");
      }
      redirectCount += 1;
      continue;
    }

    const timing: UpstreamTiming = {
      startedAt,
      headersAt,
      firstByteAt: null,
      endedAt: null,
      bytes: 0,
      redirectCount,
    };

    const noBody = method === "HEAD" || status === 204 || status === 205 || status === 304;

    // Wrap the Node.js IncomingMessage as a Web ReadableStream.
    // The CALLER (stream-session.server.ts) is responsible for buffering this body
    // at server-to-server speed before forwarding to the browser client.
    // Do NOT buffer here — doing so would double-buffer and cause idle-timer races
    // where response.on("close") fires before "end", leaving the Promise unresolved
    // until the idle timeout destroys the socket with a generic Error → 502.
    const body = Readable.toWeb(response) as ReadableStream<Uint8Array>;
    const reader = body.getReader();
    const webStream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            timing.endedAt ??= Date.now();
            controller.close();
            return;
          }
          timing.firstByteAt ??= Date.now();
          timing.bytes += chunk.value.byteLength;
          controller.enqueue(chunk.value);
        } catch (error) {
          timing.endedAt ??= Date.now();
          controller.error(error);
        }
      },
      async cancel(reason) {
        timing.endedAt ??= Date.now();
        await reader.cancel(reason);
      },
    });

    const result = new Response(noBody ? null : webStream, {
      status,
      statusText: response.statusMessage ?? "",
      headers: responseHeaders(response.headers),
    });
    Object.defineProperty(result, "url", { value: currentUrl.toString(), configurable: true });
    timingByResponse.set(result, timing);
    return result;
  }
}
