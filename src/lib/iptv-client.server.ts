// Server-only IPTV client. Supports Xtream Codes API and raw M3U playlists.
// Never call from client code; imports require server env.

import type { IptvChannel } from "@/lib/m3u-parser";
export type { IptvChannel };

export interface IptvCredentials {
  server_url: string;
  username: string | null;
  password: string | null;
  connection_type: "xtream" | "m3u";
}

function normaliseBase(server: string): string {
  return server.replace(/\/+$/, "");
}

// Many IPTV providers reject requests without a browser-style User-Agent
// (401/403), and some allowlist only specific UAs (VLC, Kodi, TiviMate…).
// m3uChannels cycles through these on 401/403 before giving up.
const UPSTREAM_UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "VLC/3.0.20 LibVLC/3.0.20",
  "Lavf/60.16.100",
  "TiviMate/4.7.0 (Linux;Android 12) ExoPlayer",
] as const;
const UPSTREAM_UA = UPSTREAM_UAS[0];

// ---------- Safe debug logging ----------

/** Strip credentials from a URL so it's safe to log. */
function redactUrl(input: string): string {
  try {
    const u = new URL(input);
    if (u.username || u.password) {
      u.username = "***";
      u.password = "***";
    }
    for (const key of ["username", "password", "token", "auth", "key"]) {
      if (u.searchParams.has(key)) u.searchParams.set(key, "***");
    }
    return u.toString();
  } catch {
    return input.replace(/(username|password|token|auth|key)=[^&]+/gi, "$1=***");
  }
}

/** Whitelist of headers safe to log — never log Set-Cookie, Auth, etc. */
const SAFE_LOG_HEADERS = [
  "content-type",
  "content-length",
  "server",
  "cf-ray",
  "cf-cache-status",
  "x-powered-by",
  "www-authenticate",
  "location",
  "date",
  "retry-after",
];

function pickSafeHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of SAFE_LOG_HEADERS) {
    const v = h.get(name);
    if (v != null) out[name] = name === "www-authenticate" ? v.replace(/"[^"]*"/g, '"***"') : v;
  }
  return out;
}

/** Return the first ~200 chars of a response body, stripped of credential-shaped tokens. */
async function safeBodySnippet(res: Response, max = 200): Promise<string> {
  try {
    const text = await res.clone().text();
    const clipped = text.length > max ? text.slice(0, max) + `…(+${text.length - max}b)` : text;
    return clipped
      .replace(/(password|token|auth|key|secret)"?\s*[:=]\s*"?[^",\s&]+/gi, "$1=***")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "<unreadable body>";
  }
}

function logUpstream(
  scope: string,
  url: string,
  res: Response,
  extra: Record<string, unknown> = {},
): void {
  console.info(
    `[iptv:${scope}] status=${res.status} ${res.statusText} url=${redactUrl(url)} ` +
      `headers=${JSON.stringify(pickSafeHeaders(res.headers))}`,
    extra,
  );
}

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    redirect: "follow",
    headers: {
      Accept: "application/json",
      "User-Agent": UPSTREAM_UA,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    logUpstream("fetchJson", url, res, { snippet: await safeBodySnippet(res) });
    throw new Error(`Upstream ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// ---------- Xtream Codes ----------

export async function xtreamAuth(creds: IptvCredentials): Promise<{
  ok: boolean;
  message: string;
  server_info?: { url?: string; port?: string; https_port?: string };
}> {
  const base = normaliseBase(creds.server_url);
  const url = `${base}/player_api.php?username=${encodeURIComponent(
    creds.username ?? "",
  )}&password=${encodeURIComponent(creds.password ?? "")}`;
  try {
    const data = await fetchJson(url);
    const status = data?.user_info?.auth === 1 || data?.user_info?.status === "Active";
    return {
      ok: !!status,
      message: status ? "Authenticated" : (data?.user_info?.message ?? "Auth failed"),
      server_info: data?.server_info,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Connection failed" };
  }
}

export async function xtreamChannels(creds: IptvCredentials): Promise<IptvChannel[]> {
  const base = normaliseBase(creds.server_url);
  const streamsUrl = `${base}/player_api.php?username=${encodeURIComponent(
    creds.username ?? "",
  )}&password=${encodeURIComponent(creds.password ?? "")}&action=get_live_streams`;
  const catsUrl = `${base}/player_api.php?username=${encodeURIComponent(
    creds.username ?? "",
  )}&password=${encodeURIComponent(creds.password ?? "")}&action=get_live_categories`;

  const [streams, cats] = await Promise.all([fetchJson(streamsUrl), fetchJson(catsUrl)]);
  const catMap = new Map<string, string>();
  for (const c of Array.isArray(cats) ? cats : []) {
    if (c?.category_id != null) catMap.set(String(c.category_id), String(c.category_name ?? ""));
  }
  return (Array.isArray(streams) ? streams : []).map((s) => {
    // Build the raw Xtream stream URL (.m3u8 playlist format for universal HLS compatibility).
    const rawUrl = `${base}/live/${encodeURIComponent(creds.username ?? "")}/${encodeURIComponent(
      creds.password ?? "",
    )}/${encodeURIComponent(s.stream_id)}.m3u8`;

    // Route through /api/public/iptv/playlist proxy for CORS & HLS fragment rewriting.
    const proxiedUrl = `/api/public/iptv/playlist?url=${encodeURIComponent(rawUrl)}`;

    return {
      id: String(s.stream_id),
      name: String(s.name ?? "").trim() || `Channel ${s.stream_id}`,
      logo: s.stream_icon ? String(s.stream_icon) : null,
      group: catMap.get(String(s.category_id)) ?? null,
      tvgId: s.custom_sid ? String(s.custom_sid) : null,
      tvgName: s.name ? String(s.name) : null,
      url: proxiedUrl,
    };
  });
}

export function xtreamUpstreamUrl(creds: IptvCredentials, channelId: string): string {
  const base = normaliseBase(creds.server_url);
  return `${base}/live/${encodeURIComponent(creds.username ?? "")}/${encodeURIComponent(
    creds.password ?? "",
  )}/${encodeURIComponent(channelId)}.m3u8`;
}

export function xtreamStreamUrl(creds: IptvCredentials, channelId: string): string {
  const rawUrl = xtreamUpstreamUrl(creds, channelId);
  return `/api/public/iptv/playlist?url=${encodeURIComponent(rawUrl)}`;
}

// ---------- M3U ----------

const EXTINF_RE = /^#EXTINF:[^,]*,(.*)$/;
const ATTR_RE = /([\w-]+)="([^"]*)"/g;

export function parseM3U(text: string): IptvChannel[] {
  const lines = text.split(/\r?\n/);
  const out: IptvChannel[] = [];
  let pending: Partial<IptvChannel> | null = null;

  for (const line of lines) {
    if (line.startsWith("#EXTINF:")) {
      const attrs: Record<string, string> = {};
      let m;
      while ((m = ATTR_RE.exec(line)) !== null) attrs[m[1].toLowerCase()] = m[2];
      const nameMatch = EXTINF_RE.exec(line);
      pending = {
        id: attrs["tvg-id"] || attrs["tvg-name"] || (nameMatch?.[1] ?? "").trim(),
        name: (nameMatch?.[1] ?? "").trim() || attrs["tvg-name"] || "Untitled",
        logo: attrs["tvg-logo"] || null,
        group: attrs["group-title"] || null,
      };
    } else if (line && !line.startsWith("#") && pending) {
      out.push({
        id: pending.id || line,
        name: pending.name!,
        logo: pending.logo ?? null,
        group: pending.group ?? null,
        tvgId: pending.id || null,
        tvgName: pending.name!,
        url: line,
      });
      pending = null;
    }
  }
  return out;
}

export async function m3uChannels(creds: IptvCredentials): Promise<IptvChannel[]> {
  const acceptHeader =
    "application/vnd.apple.mpegurl, audio/x-mpegurl, application/x-mpegurl, text/plain, */*";

  let lastStatus = 0;
  let lastStatusText = "";
  for (const ua of UPSTREAM_UAS) {
    const started = Date.now();
    const res = await fetch(creds.server_url, {
      redirect: "follow",
      headers: { "User-Agent": ua, Accept: acceptHeader },
    });
    const durationMs = Date.now() - started;

    if (res.ok) {
      logUpstream("m3u", creds.server_url, res, { ua, durationMs });
      return parseM3U(await res.text());
    }

    lastStatus = res.status;
    lastStatusText = res.statusText;
    logUpstream("m3u", creds.server_url, res, {
      ua,
      durationMs,
      snippet: await safeBodySnippet(res),
    });

    // Only cycle UAs on auth-style rejections; other errors won't change with UA.
    if (res.status !== 401 && res.status !== 403) break;
  }

  if (lastStatus === 401 || lastStatus === 403) {
    throw new Error(
      `Upstream ${lastStatus} ${lastStatusText}: the playlist URL rejected our request across ${UPSTREAM_UAS.length} user agents. ` +
        `Check that the M3U URL is correct and still active (many providers embed username/password in the URL and expire it).`,
    );
  }
  throw new Error(`Upstream ${lastStatus} ${lastStatusText}`);
}

// ---------- Public dispatch ----------

export type TestConnectionCode =
  "ok" | "invalid_url" | "unreachable" | "auth_failed" | "no_channels" | "upstream_error";

export interface TestConnectionResult {
  ok: boolean;
  code: TestConnectionCode;
  message: string;
  /** Number of live channels discovered when we probe them. */
  channelCount?: number;
}

/**
 * Validate an IPTV subscription end-to-end: URL shape, reachability,
 * credentials (Xtream only), and that at least one live channel is
 * exposed. Errors are categorized so the admin UI can surface a specific,
 * actionable message rather than the raw upstream text.
 */
export async function testConnection(creds: IptvCredentials): Promise<TestConnectionResult> {
  // 1. URL sanity check (server-side belt-and-braces even though the
  //    admin form uses Zod).
  let parsed: URL;
  try {
    parsed = new URL(creds.server_url);
  } catch {
    return { ok: false, code: "invalid_url", message: "Server URL is not a valid URL" };
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    return {
      ok: false,
      code: "invalid_url",
      message: "Server URL must start with http:// or https://",
    };
  }

  if (creds.connection_type === "xtream") {
    if (!creds.username || !creds.password) {
      return {
        ok: false,
        code: "auth_failed",
        message: "Username and password are required for Xtream Codes",
      };
    }
    const auth = await xtreamAuth(creds);
    if (!auth.ok) {
      // Distinguish network failure from provider-rejected credentials.
      const isNetwork = /fetch|network|ENOTFOUND|ECONN|ETIMEDOUT|Upstream 5\d\d/i.test(
        auth.message,
      );
      return {
        ok: false,
        code: isNetwork ? "unreachable" : "auth_failed",
        message: isNetwork
          ? `Cannot reach server: ${auth.message}`
          : `Provider rejected credentials: ${auth.message}`,
      };
    }
    try {
      const channels = await xtreamChannels(creds);
      if (channels.length === 0) {
        return {
          ok: false,
          code: "no_channels",
          message: "Signed in, but the subscription has no live channels",
          channelCount: 0,
        };
      }
      return {
        ok: true,
        code: "ok",
        message: `Authenticated — ${channels.length} live channels available`,
        channelCount: channels.length,
      };
    } catch (e) {
      return {
        ok: false,
        code: "upstream_error",
        message: `Signed in but could not list channels: ${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    }
  }

  // M3U path — reuse m3uChannels so we get UA rotation, safe logging,
  // and the same actionable 401/403 error messaging as the live fetch.
  try {
    const channels = await m3uChannels(creds);
    if (channels.length === 0) {
      return {
        ok: false,
        code: "no_channels",
        message: "Playlist loaded but contains no channels",
        channelCount: 0,
      };
    }
    return {
      ok: true,
      code: "ok",
      message: `Playlist OK — ${channels.length} channels`,
      channelCount: channels.length,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Playlist unreachable";
    const isAuth = /Upstream 40[13]/i.test(msg);
    return {
      ok: false,
      code: isAuth ? "auth_failed" : "unreachable",
      message: msg,
    };
  }
}

export async function fetchChannels(creds: IptvCredentials): Promise<IptvChannel[]> {
  return creds.connection_type === "xtream" ? xtreamChannels(creds) : m3uChannels(creds);
}

export function resolveStreamUrl(
  creds: IptvCredentials,
  channelId: string,
  channelStreamUrl?: string | null,
): string {
  if (creds.connection_type === "xtream") return xtreamStreamUrl(creds, channelId);
  // For M3U the channel entry IS the URL; caller stores it and passes it in.
  if (!channelStreamUrl) throw new Error("M3U channel missing stream URL");
  return channelStreamUrl;
}
