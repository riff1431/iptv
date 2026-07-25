/**
 * Performance tracing helpers.
 *
 * Goal: find *which* loader, server function, or resource is holding up a
 * page load or causing the app to feel hung. All measurements go through:
 *   1. `console.info("[perf] …", detail)` for interactive debugging,
 *   2. `performance.mark` / `performance.measure` so they show up in
 *      DevTools → Performance and Chrome tracing exports,
 *   3. `trackEvent("perf_slow", …)` when a span exceeds its budget, so the
 *      existing analytics pipeline can capture them in tests / dashboards.
 *
 * Everything is a no-op on the server unless explicitly noted so we don't
 * pay tracing cost in production SSR.
 */

import { trackEvent } from "@/lib/analytics";

/** Anything slower than this (ms) is reported as a slow span. */
export const SLOW_THRESHOLD_MS = 800;
/** Loader threshold — loaders block route render, so we're stricter. */
export const SLOW_LOADER_MS = 500;
/** Long-task threshold surfaced by PerformanceObserver. */
export const LONG_TASK_MS = 100;

function now(): number {
  if (typeof performance !== "undefined") return performance.now();
  return Date.now();
}

function mark(name: string): void {
  if (typeof performance === "undefined" || !performance.mark) return;
  try {
    performance.mark(name);
  } catch {
    /* noop */
  }
}

function measure(name: string, start: string, end: string): void {
  if (typeof performance === "undefined" || !performance.measure) return;
  try {
    performance.measure(name, start, end);
  } catch {
    /* noop */
  }
}

/**
 * Time an async span. Logs, adds User Timing marks, and fires a
 * `perf_slow` analytics event when it exceeds the threshold.
 */
export async function traceSpan<T>(
  label: string,
  fn: () => Promise<T> | T,
  opts: { thresholdMs?: number; meta?: Record<string, string | number | boolean | null> } = {},
): Promise<T> {
  const threshold = opts.thresholdMs ?? SLOW_THRESHOLD_MS;
  const startMark = `perf:${label}:start`;
  const endMark = `perf:${label}:end`;
  const started = now();
  mark(startMark);
  try {
    return await fn();
  } finally {
    const duration = now() - started;
    mark(endMark);
    measure(`perf:${label}`, startMark, endMark);
    const detail = { label, duration_ms: Math.round(duration), ...(opts.meta ?? {}) };
    if (duration >= threshold) {
      // eslint-disable-next-line no-console
      console.warn("[perf] slow", detail);
      trackEvent("perf_slow", detail);
    } else if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.info("[perf]", detail);
    }
  }
}

/**
 * Wrap a TanStack route `loader` so every invocation is traced.
 *
 *   loader: traceLoader("/posts", ({ context }) => context.queryClient.ensureQueryData(...))
 */
export function traceLoader<Args extends { route?: { id?: string } } | unknown, R>(
  routeId: string,
  loader: (args: Args) => Promise<R> | R,
): (args: Args) => Promise<R> {
  return async (args: Args) => {
    return traceSpan(`loader ${routeId}`, () => Promise.resolve(loader(args)), {
      thresholdMs: SLOW_LOADER_MS,
      meta: { kind: "loader", route: routeId },
    });
  };
}

/**
 * Wrap a `createServerFn(...)` call site so the client round-trip is traced.
 * Use at the call site, not inside the server function definition, so the
 * server bundle stays untouched:
 *
 *   const posts = await traceServerFn("getPosts", () => getPosts({ data }));
 */
export async function traceServerFn<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return traceSpan(`serverFn ${name}`, fn, {
    thresholdMs: SLOW_LOADER_MS,
    meta: { kind: "serverFn", name },
  });
}

/**
 * Install browser-side observers that surface stalls we didn't wrap
 * ourselves: long JS tasks, slow resources, and navigation timing.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
let installed = false;
export function installPerfObserver(): void {
  if (installed) return;
  if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") return;
  installed = true;

  const supported = new Set(PerformanceObserver.supportedEntryTypes ?? []);

  // Long tasks — anything blocking the main thread > LONG_TASK_MS.
  if (supported.has("longtask")) {
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration < LONG_TASK_MS) continue;
          const detail = { label: "longtask", duration_ms: Math.round(entry.duration) };
          // eslint-disable-next-line no-console
          console.warn("[perf] longtask", detail);
          trackEvent("perf_longtask", detail);
        }
      }).observe({ type: "longtask", buffered: true });
    } catch {
      /* noop */
    }
  }

  // Slow resources (network requests, scripts, images, XHR/fetch).
  if (supported.has("resource")) {
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
          if (entry.duration < SLOW_THRESHOLD_MS) continue;
          const detail = {
            label: "resource",
            duration_ms: Math.round(entry.duration),
            name: entry.name,
            initiator: entry.initiatorType,
            transfer_size: entry.transferSize ?? 0,
          };
          // eslint-disable-next-line no-console
          console.warn("[perf] slow resource", detail);
          trackEvent("perf_slow_resource", detail);
        }
      }).observe({ type: "resource", buffered: true });
    } catch {
      /* noop */
    }
  }

  // Navigation timing — one-shot summary of TTFB / DOMContentLoaded / load.
  if (supported.has("navigation")) {
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceNavigationTiming[]) {
          const detail = {
            label: "navigation",
            ttfb_ms: Math.round(entry.responseStart - entry.requestStart),
            dom_ready_ms: Math.round(entry.domContentLoadedEventEnd - entry.startTime),
            load_ms: Math.round(entry.loadEventEnd - entry.startTime),
            transfer_size: entry.transferSize ?? 0,
          };
          // eslint-disable-next-line no-console
          console.info("[perf] navigation", detail);
          trackEvent("perf_navigation", detail);
        }
      }).observe({ type: "navigation", buffered: true });
    } catch {
      /* noop */
    }
  }
}

/**
 * Attach router-level tracing so every route match reports the total time
 * spent in `beforeLoad` + `loader` + pending render. Call once with the
 * router instance (e.g. from the root component).
 */
export function installRouterPerfTracing(router: {
  subscribe: (
    event: "onBeforeLoad" | "onResolved",
    cb: (arg: { toLocation: { pathname: string } }) => void,
  ) => () => void;
}): () => void {
  if (typeof window === "undefined") return () => {};
  const inflight = new Map<string, number>();

  const offStart = router.subscribe("onBeforeLoad", ({ toLocation }) => {
    inflight.set(toLocation.pathname, now());
  });
  const offEnd = router.subscribe("onResolved", ({ toLocation }) => {
    const started = inflight.get(toLocation.pathname);
    if (started == null) return;
    inflight.delete(toLocation.pathname);
    const duration = Math.round(now() - started);
    const detail = { label: "route", route: toLocation.pathname, duration_ms: duration };
    if (duration >= SLOW_LOADER_MS) {
      // eslint-disable-next-line no-console
      console.warn("[perf] slow route", detail);
      trackEvent("perf_slow_route", detail);
    } else if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.info("[perf] route", detail);
    }
  });

  return () => {
    offStart();
    offEnd();
  };
}
