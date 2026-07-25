// Dynamic sitemap served at /sitemap.xml. Combines static public routes with
// the list of active public lounges so crawlers can discover shareable rooms.
import { createFileRoute } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { listPublicLounges } from "@/lib/lounges.public.functions";

const STATIC_PATHS = ["/", "/iptv", "/privacy", "/terms"] as const;

function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === "'" ? "&apos;" : "&quot;",
  );
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const req = getRequest();
        const proto = req.headers.get("x-forwarded-proto") ?? "https";
        const host =
          req.headers.get("x-forwarded-host") ??
          req.headers.get("host") ??
          new URL(req.url).host;
        const origin = `${proto}://${host}`;

        const lounges = await listPublicLounges().catch(() => [] as Array<{ slug: string; isActive: boolean }>);
        const loungePaths = lounges
          .filter((l) => l.isActive)
          .map((l) => `/lounge/${l.slug}`);

        const urls = [...STATIC_PATHS, ...loungePaths].map((p) => {
          const priority = p === "/" ? "1.0" : p.startsWith("/lounge/") ? "0.8" : "0.6";
          const changefreq = p.startsWith("/lounge/") ? "hourly" : "weekly";
          return `  <url>\n    <loc>${xmlEscape(origin + p)}</loc>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
        });

        const xml =
          `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
          urls.join("\n") +
          `\n</urlset>\n`;

        return new Response(xml, {
          status: 200,
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=300, s-maxage=600",
          },
        });
      },
    },
  },
});
