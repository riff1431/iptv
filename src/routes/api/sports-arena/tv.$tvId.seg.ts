import { createFileRoute } from "@tanstack/react-router";
import {
  IptvUpstreamHttpError,
  getSharedSegment,
  type SharedSegmentResult,
} from "@/lib/stream-session.server";
import {
  classifyUpstreamError,
  UpstreamAbortError,
  UpstreamTimeoutError,
} from "@/lib/iptv-upstream.server";
import {
  classifyResourceKind,
  iptvRequestId,
  iptvResponseHeaders,
  logIptvTiming,
  upstreamHostname,
} from "@/lib/iptv-diagnostics.server";

export const Route = createFileRoute("/api/sports-arena/tv/$tvId/seg")({
  server: {
    handlers: { GET: async ({ request, params }) => handleSegRequest(request, params.tvId) },
  },
});

function envInt(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

function mediaType(url: string, supplied?: string): string {
  if (supplied && !/text\/plain/i.test(supplied)) return supplied;
  let path = "";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    /* signed URL was already validated */
  }
  if (path.endsWith(".ts")) return "video/mp2t";
  if (path.endsWith(".m4s") || path.endsWith(".mp4")) return "video/mp4";
  if (path.endsWith(".aac")) return "audio/aac";
  return supplied || "application/octet-stream";
}

function responseHeaders(
  result: SharedSegmentResult,
  upstreamUrl: string,
  requestId: string,
): Headers {
  const headers = new Headers(result.headers);
  const isPlaylist = result.kind === "playlist";
  headers.set(
    "Cache-Control",
    isPlaylist ? "no-store" : "public, max-age=20, stale-while-revalidate=10, no-transform",
  );
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Accel-Buffering", "no");
  if (result.kind === "buffered" && !headers.has("Content-Length")) {
    headers.set("Content-Length", String(result.bytes.byteLength));
  }
  if (!isPlaylist)
    headers.set("Content-Type", mediaType(upstreamUrl, headers.get("content-type") ?? undefined));
  for (const [name, value] of Object.entries(
    iptvResponseHeaders(requestId, result.cache, result.timing),
  )) {
    headers.set(name, value);
  }
  return headers;
}

function streamToClient(
  result: Extract<SharedSegmentResult, { kind: "stream" }>,
  context: {
    requestId: string;
    tvId: string;
    upstreamUrl: string;
    startedAt: number;
    retryCount: number;
  },
): ReadableStream<Uint8Array> {
  const reader = result.body.getReader();
  let bytes = 0;
  let firstDownstreamAt: number | null = null;
  let logged = false;
  const finish = (
    failureCategory: string | null,
    message?: unknown,
    clientDisconnected = false,
  ) => {
    if (logged) return;
    logged = true;
    logIptvTiming({
      requestId: context.requestId,
      tvId: context.tvId,
      kind: classifyResourceKind(context.upstreamUrl, result.headers["content-type"]),
      upstreamHost: upstreamHostname(context.upstreamUrl),
      cache: result.cache,
      upstreamStatus: result.status,
      startedAt: context.startedAt,
      upstreamTiming: result.timing,
      firstDownstreamAt,
      endedAt: Date.now(),
      bytes,
      retryCount: context.retryCount,
      clientDisconnected,
      upstreamAborted:
        failureCategory === "client_abort" || failureCategory?.endsWith("timeout") === true,
      failureCategory,
      message,
    });
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          finish(null);
          controller.close();
          return;
        }
        firstDownstreamAt ??= Date.now();
        bytes += chunk.value.byteLength;
        controller.enqueue(chunk.value);
      } catch (error) {
        finish(classifyUpstreamError(error), error);
        controller.error(error);
      }
    },
    async cancel(reason) {
      finish("client_abort", reason, true);
      await reader.cancel(new UpstreamAbortError("IPTV downstream client disconnected"));
    },
  });
}

function errorStatus(error: unknown): number {
  if (error instanceof UpstreamTimeoutError) return 504;
  if (error instanceof IptvUpstreamHttpError) {
    if (error.status === 404 || error.status === 410 || error.status === 429) return error.status;
    return 502;
  }
  return 502;
}

function retryable(error: unknown): boolean {
  if (error instanceof UpstreamTimeoutError) return true;
  if (error instanceof IptvUpstreamHttpError) return error.retryable && error.status !== 429;
  return !(error instanceof UpstreamAbortError);
}

export async function handleSegRequest(request: Request, tvId: string): Promise<Response> {
  const requestId = iptvRequestId();
  const startedAt = Date.now();
  const requestUrl = new URL(request.url);
  const { verifySegmentToken } = await import("@/lib/iptv-proxy.server");
  const upstreamUrl = verifySegmentToken(
    tvId,
    requestUrl.searchParams.get("u"),
    requestUrl.searchParams.get("e"),
    requestUrl.searchParams.get("s"),
  );
  if (!upstreamUrl) {
    return new Response("Forbidden", {
      status: 403,
      headers: { "Cache-Control": "no-store", "X-IPTV-Request-Id": requestId },
    });
  }

  const maxAttempts = envInt("IPTV_SEGMENT_MAX_ATTEMPTS", 2, 1, 3);
  let lastError: unknown;
  let attemptsMade = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attemptsMade = attempt;
    try {
      const result = await getSharedSegment(tvId, upstreamUrl, {
        range: request.headers.get("range"),
        signal: request.signal,
        segmentProxyPath: `/api/sports-arena/tv/${tvId}/seg`,
      });
      const headers = responseHeaders(result, upstreamUrl, requestId);
      if (result.kind === "stream") {
        return new Response(
          streamToClient(result, {
            requestId,
            tvId,
            upstreamUrl,
            startedAt,
            retryCount: attempt - 1,
          }),
          { status: result.status, headers },
        );
      }
      const body = result.kind === "playlist" ? result.body : result.bytes;
      if (result.kind === "playlist")
        headers.set("Content-Length", String(Buffer.byteLength(result.body)));
      logIptvTiming({
        requestId,
        tvId,
        kind:
          result.kind === "playlist"
            ? "nested_playlist"
            : classifyResourceKind(upstreamUrl, result.headers["content-type"]),
        upstreamHost: upstreamHostname(upstreamUrl),
        cache: result.cache,
        upstreamStatus: result.status,
        startedAt,
        upstreamTiming: result.timing,
        firstDownstreamAt: Date.now(),
        endedAt: Date.now(),
        bytes: typeof body === "string" ? Buffer.byteLength(body) : body.byteLength,
        retryCount: attempt - 1,
      });
      const responseBody =
        typeof body === "string"
          ? body
          : (body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer);
      return new Response(responseBody, { status: result.status, headers });
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !retryable(error) || request.signal.aborted) break;
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** (attempt - 1)));
    }
  }

  const status = errorStatus(lastError);
  const category = classifyUpstreamError(lastError);
  logIptvTiming({
    requestId,
    tvId,
    kind: classifyResourceKind(upstreamUrl),
    upstreamHost: upstreamHostname(upstreamUrl),
    cache: "miss",
    startedAt,
    endedAt: Date.now(),
    retryCount: Math.max(0, attemptsMade - 1),
    clientDisconnected: request.signal.aborted,
    upstreamAborted: category !== "network_error",
    failureCategory:
      lastError instanceof IptvUpstreamHttpError ? `upstream_http_${lastError.status}` : category,
    message: lastError,
  });
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    "X-IPTV-Request-Id": requestId,
  };
  if (status === 429 || status === 502 || status === 504)
    headers["Retry-After"] = status === 429 ? "10" : "2";
  return new Response(
    status === 404 || status === 410
      ? "Upstream resource not found"
      : status === 429
        ? "Provider connection limit reached"
        : status === 504
          ? "Upstream timed out"
          : "Temporary upstream failure",
    { status, headers },
  );
}
