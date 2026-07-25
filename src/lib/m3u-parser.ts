/**
 * Minimal M3U / M3U8 playlist parser.
 * Extracts channels from `#EXTINF` lines and the following URL line.
 */

export type IptvChannel = {
  id: string;
  name: string;
  logo: string | null;
  group: string | null;
  tvgId: string | null;
  tvgName: string | null;
  url: string;
};

function parseAttrs(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out[m[1].toLowerCase()] = m[2];
  return out;
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function parseM3U(text: string): IptvChannel[] {
  if (!text || typeof text !== "string") return [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const channels: IptvChannel[] = [];
  const seen = new Set<string>();
  let pending: { name: string; attrs: Record<string, string> } | null = null;

  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTM3U")) continue;
    if (line.startsWith("#EXTINF")) {
      const commaIdx = line.indexOf(",");
      const attrPart = commaIdx >= 0 ? line.slice(0, commaIdx) : line;
      const name = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : "Unnamed";
      pending = { name, attrs: parseAttrs(attrPart) };
      continue;
    }
    if (line.startsWith("#")) continue;
    // URL line
    if (!pending) {
      // Bare URL, still count as a channel
      pending = { name: "Unnamed", attrs: {} };
    }
    const url = line;
    const a = pending.attrs;
    const tvgId = a["tvg-id"] || null;
    const tvgName = a["tvg-name"] || null;
    const logo = a["tvg-logo"] || null;
    const group = a["group-title"] || null;
    const idKey = tvgId || pending.name || url;
    let id = hash(`${idKey}|${url}`);
    // Ensure uniqueness
    while (seen.has(id)) id = hash(id + "!");
    seen.add(id);
    channels.push({
      id,
      name: pending.name || tvgName || "Unnamed",
      logo,
      group,
      tvgId,
      tvgName,
      url,
    });
    pending = null;
  }
  return channels;
}

export const DEMO_M3U_URL = "https://iptv-org.github.io/iptv/index.m3u";
