/**
 * Lightweight client-side analytics for HLS/stream reliability.
 *
 * Emits three signals for every event so any downstream tool can consume them:
 *  1. `console.info` with a stable `[stream-analytics]` prefix (always on)
 *  2. `window.dispatchEvent(new CustomEvent("stream-analytics", { detail }))`
 *  3. Best-effort forwarding to common analytics globals if they're present
 *     (`window.gtag`, `window.plausible`, `window.dataLayer`, `window.posthog`).
 *
 * Nothing here throws — analytics must never break playback.
 */

export type StreamEventName =
  | "stream_start_attempt"
  | "stream_start_success"
  | "stream_start_failure"
  | "stream_auto_retry"
  | "stream_retry_click"
  | "stream_retry_success"
  | "stream_retry_failure"
  | "stream_backoff_scheduled"
  | "stream_backoff_retry"
  | "stream_phase";


export type StreamEventPayload = {
  slot?: number;
  channelName?: string | null;
  url?: string | null;
  attempt?: number;
  autoRetries?: number;
  errorType?: string;
  errorDetails?: string;
  fatal?: boolean;
  durationMs?: number;
  [key: string]: unknown;
};

type AnalyticsGlobals = {
  gtag?: (...args: unknown[]) => void;
  plausible?: (name: string, opts?: { props?: Record<string, unknown> }) => void;
  dataLayer?: Array<Record<string, unknown>>;
  posthog?: { capture?: (name: string, props?: Record<string, unknown>) => void };
};

function redactUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    // Drop query/auth tokens — keep host + path shape for debugging.
    return `${u.origin}${u.pathname}`;
  } catch {
    return "[unparseable-url]";
  }
}

export function trackStreamEvent(name: StreamEventName, payload: StreamEventPayload = {}): void {
  const detail = {
    event: name,
    timestamp: new Date().toISOString(),
    ...payload,
    url: redactUrl(payload.url),
  };

  try {
    // 1. Console — always visible in prod for support debugging.
    console.info(`[stream-analytics] ${name}`, detail);

    if (typeof window === "undefined") return;

    // 2. DOM CustomEvent — anyone can subscribe (in-app dashboards, tests).
    window.dispatchEvent(new CustomEvent("stream-analytics", { detail }));

    // 3. Best-effort forwarding to installed analytics providers.
    const g = window as unknown as AnalyticsGlobals;
    g.gtag?.("event", name, detail);
    g.plausible?.(name, { props: detail as Record<string, unknown> });
    g.dataLayer?.push({ ...detail, event: name });
    g.posthog?.capture?.(name, detail as Record<string, unknown>);
  } catch {
    // Never let analytics break playback.
  }
}
