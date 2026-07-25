import type { SiteSettings } from "@/lib/site-settings.functions";

export type HeadMetaEntry = Record<string, string>;
export type HeadLinkEntry = Record<string, string>;

export const DEFAULT_TITLE = "Sports Lounge — PlayGroundX";
export const DEFAULT_DESCRIPTION =
  "Enter a luxury virtual sports lounge and watch four live sporting events at once. Powered by PlayGroundX.";
export const DEFAULT_SITE_NAME = "PGX Sports Lounge";

function faviconTypeFor(url: string): string {
  if (url.endsWith(".svg")) return "image/svg+xml";
  if (url.endsWith(".png")) return "image/png";
  return "image/x-icon";
}

/**
 * Pure builder for the site-wide head tags rendered from `site_settings`.
 * Shared by `__root.tsx` (the real render) and the admin preview panel so
 * both stay in lockstep.
 */
export function buildSiteHeadTags(
  s: Partial<SiteSettings> | null | undefined,
  opts: { buildId: string },
): { meta: HeadMetaEntry[]; links: HeadLinkEntry[] } {
  const title = s?.meta_title || DEFAULT_TITLE;
  const description = s?.meta_description || DEFAULT_DESCRIPTION;
  const siteName = s?.site_name || DEFAULT_SITE_NAME;
  const faviconHref = s?.favicon_url || `/favicon.ico?v=${opts.buildId}`;
  const faviconType = s?.favicon_url ? faviconTypeFor(s.favicon_url) : "image/x-icon";

  const meta: HeadMetaEntry[] = [
    { charSet: "utf-8" },
    { name: "viewport", content: "width=device-width, initial-scale=1" },
    { httpEquiv: "Cache-Control", content: "no-cache, no-store, must-revalidate" },
    { httpEquiv: "Pragma", content: "no-cache" },
    { httpEquiv: "Expires", content: "0" },
    { title },
    { name: "description", content: description },
    { name: "author", content: "PlayGroundX" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: siteName },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "x-build-id", content: opts.buildId },
  ];
  if (s?.og_image_url) {
    meta.push({ property: "og:image", content: s.og_image_url });
    meta.push({ name: "twitter:image", content: s.og_image_url });
  }
  if (s?.twitter_handle) {
    meta.push({ name: "twitter:site", content: s.twitter_handle });
  }

  const links: HeadLinkEntry[] = [
    { rel: "icon", href: faviconHref, type: faviconType },
  ];
  return { meta, links };
}

/**
 * Render a meta/link entry to the exact HTML string TanStack will emit
 * (attribute order matches what appears in the shipped `<head>`).
 */
function escapeAttr(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderMetaTag(entry: HeadMetaEntry): string {
  if ("title" in entry && Object.keys(entry).length === 1) {
    return `<title>${escapeAttr(entry.title)}</title>`;
  }
  const attrs = Object.entries(entry)
    .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
    .join(" ");
  return `<meta ${attrs} />`;
}

export function renderLinkTag(entry: HeadLinkEntry): string {
  const attrs = Object.entries(entry)
    .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
    .join(" ");
  return `<link ${attrs} />`;
}
