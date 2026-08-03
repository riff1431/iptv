const source = process.env.IPTV_DIAGNOSTIC_URL;
const bearer = process.env.IPTV_DIAGNOSTIC_BEARER_TOKEN;

if (!source) {
  console.error("Set IPTV_DIAGNOSTIC_URL to the same-origin playlist route inside the container.");
  process.exitCode = 1;
} else {
  await diagnose(source);
}

function safeLocation(raw) {
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "[invalid-url]";
  }
}

function requestHeaders(raw) {
  if (!bearer) return {};
  const target = new URL(raw);
  const root = new URL(source);
  return target.origin === root.origin ? { Authorization: `Bearer ${bearer}` } : {};
}

async function timedFetch(raw) {
  const started = performance.now();
  const response = await fetch(raw, { headers: requestHeaders(raw), redirect: "follow" });
  const headersAt = performance.now();
  const reader = response.body?.getReader();
  const chunks = [];
  let bytes = 0;
  let firstByteAt = null;
  if (reader) {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      firstByteAt ??= performance.now();
      bytes += chunk.value.byteLength;
      chunks.push(chunk.value);
    }
  }
  const ended = performance.now();
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    response,
    body,
    ttfbMs: Math.round((firstByteAt ?? headersAt) - started),
    headersMs: Math.round(headersAt - started),
    totalMs: Math.round(ended - started),
  };
}

function firstMedia(text, base) {
  const lines = text.split(/\r?\n/);
  let duration = null;
  for (const line of lines) {
    const extinf = /^#EXTINF:([\d.]+)/i.exec(line.trim());
    if (extinf) duration = Number(extinf[1]);
    if (line.trim() && !line.startsWith("#")) {
      return { url: new URL(line.trim(), base).toString(), duration };
    }
  }
  return null;
}

async function diagnose(raw) {
  try {
    const playlist = await timedFetch(raw);
    const text = new TextDecoder().decode(playlist.body);
    console.log(
      JSON.stringify({
        resource: "playlist",
        url: safeLocation(raw),
        status: playlist.response.status,
        headersMs: playlist.headersMs,
        ttfbMs: playlist.ttfbMs,
        totalMs: playlist.totalMs,
        requestId: playlist.response.headers.get("x-iptv-request-id"),
        cache: playlist.response.headers.get("x-iptv-cache"),
        serverTiming: playlist.response.headers.get("server-timing"),
      }),
    );
    if (!playlist.response.ok || !text.trimStart().startsWith("#EXTM3U")) {
      throw new Error(`Playlist returned HTTP ${playlist.response.status} or invalid HLS data`);
    }
    const media = firstMedia(text, playlist.response.url || raw);
    if (!media) throw new Error("Playlist has no media URI");
    const segment = await timedFetch(media.url);
    const seconds = Math.max(segment.totalMs / 1_000, 0.001);
    const throughputMbps = (segment.body.byteLength * 8) / seconds / 1_000_000;
    console.log(
      JSON.stringify({
        resource: "first-media",
        url: safeLocation(media.url),
        status: segment.response.status,
        ttfbMs: segment.ttfbMs,
        totalMs: segment.totalMs,
        bytes: segment.body.byteLength,
        throughputMbps: Number(throughputMbps.toFixed(2)),
        segmentDurationSeconds: media.duration,
        completesWithinSegmentDuration: media.duration == null ? null : seconds < media.duration,
        requestId: segment.response.headers.get("x-iptv-request-id"),
        cache: segment.response.headers.get("x-iptv-cache"),
        serverTiming: segment.response.headers.get("server-timing"),
      }),
    );
    if (!segment.response.ok) process.exitCode = 2;
  } catch (error) {
    const safe = String(error instanceof Error ? error.message : error)
      .replace(/https?:\/\/[^\s]+/gi, "[redacted-url]")
      .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
    console.error(`IPTV diagnosis failed: ${safe}`);
    process.exitCode = 1;
  }
}
