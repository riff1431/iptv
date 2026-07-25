import { createFileRoute } from "@tanstack/react-router";

/**
 * Prometheus text exposition endpoint for playlist proxy rejection counters.
 *
 * Aggregates rows from `iptv_proxy_rejections` into two metric families:
 *   - `iptv_proxy_rejections_total{reason,status}`     counter (all-time)
 *   - `iptv_proxy_rejections_last_hour{reason,status}` gauge (rolling 60m)
 *
 * Access is gated by a bearer token from IPTV_METRICS_TOKEN. Point Prometheus
 * (or any compatible scraper) at:
 *     GET /api/public/iptv/proxy-metrics
 *     Authorization: Bearer <IPTV_METRICS_TOKEN>
 */

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function escapeLabel(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store",
      ...CORS,
    },
  });
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface Bucket {
  reason: string;
  status: number;
  count: number;
}

function aggregate(rows: Array<{ reason: string | null; status: number | null }>): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const r of rows) {
    const reason = r.reason ?? "unknown";
    const status = r.status ?? 0;
    const key = `${status}\u0000${reason}`;
    const existing = map.get(key);
    if (existing) existing.count++;
    else map.set(key, { reason, status, count: 1 });
  }
  return [...map.values()].sort((a, b) =>
    a.status === b.status ? a.reason.localeCompare(b.reason) : a.status - b.status,
  );
}

function renderMetric(name: string, help: string, type: "counter" | "gauge", buckets: Bucket[]): string {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`];
  if (buckets.length === 0) {
    lines.push(`${name} 0`);
  } else {
    for (const b of buckets) {
      lines.push(
        `${name}{reason="${escapeLabel(b.reason)}",status="${b.status}"} ${b.count}`,
      );
    }
  }
  return lines.join("\n");
}

export const Route = createFileRoute("/api/public/iptv/proxy-metrics")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const expected = process.env.IPTV_METRICS_TOKEN;
        if (!expected) {
          return textResponse("# metrics disabled: IPTV_METRICS_TOKEN unset\n", 503);
        }

        // Accept either `Authorization: Bearer <token>` or `?token=<token>` so
        // scrapers that can't set headers (basic curl, some k8s configs) still work.
        const auth = request.headers.get("authorization") ?? "";
        const bearer = auth.toLowerCase().startsWith("bearer ")
          ? auth.slice(7).trim()
          : "";
        const queryToken = new URL(request.url).searchParams.get("token") ?? "";
        const presented = bearer || queryToken;

        if (!presented || !timingSafeEqualStr(presented, expected)) {
          return new Response("Unauthorized\n", {
            status: 401,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "WWW-Authenticate": 'Bearer realm="metrics"',
              ...CORS,
            },
          });
        }

        try {
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );

          const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

          const [allTime, lastHour] = await Promise.all([
            supabaseAdmin
              .from("iptv_proxy_rejections")
              .select("reason, status")
              .limit(100_000),
            supabaseAdmin
              .from("iptv_proxy_rejections")
              .select("reason, status")
              .gte("created_at", oneHourAgo)
              .limit(100_000),
          ]);

          if (allTime.error) throw new Error(allTime.error.message);
          if (lastHour.error) throw new Error(lastHour.error.message);

          const totalBuckets = aggregate(allTime.data ?? []);
          const hourBuckets = aggregate(lastHour.data ?? []);
          const grandTotal = totalBuckets.reduce((s, b) => s + b.count, 0);

          const body = [
            renderMetric(
              "iptv_proxy_rejections_total",
              "Total playlist proxy requests rejected, by reason and HTTP status.",
              "counter",
              totalBuckets,
            ),
            renderMetric(
              "iptv_proxy_rejections_last_hour",
              "Playlist proxy requests rejected in the last 60 minutes.",
              "gauge",
              hourBuckets,
            ),
            "# HELP iptv_proxy_rejections_scrape_ok Whether the last scrape read from the audit table (1) or failed (0).",
            "# TYPE iptv_proxy_rejections_scrape_ok gauge",
            "iptv_proxy_rejections_scrape_ok 1",
            "# HELP iptv_proxy_rejections_rows_scanned Rows read from the audit table on this scrape.",
            "# TYPE iptv_proxy_rejections_rows_scanned gauge",
            `iptv_proxy_rejections_rows_scanned ${grandTotal}`,
            "",
          ].join("\n");

          return textResponse(body);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "scrape failed";
          const body = [
            "# HELP iptv_proxy_rejections_scrape_ok Whether the last scrape read from the audit table (1) or failed (0).",
            "# TYPE iptv_proxy_rejections_scrape_ok gauge",
            "iptv_proxy_rejections_scrape_ok 0",
            `# scrape_error: ${escapeLabel(msg)}`,
            "",
          ].join("\n");
          return textResponse(body, 500);
        }
      },
    },
  },
});
