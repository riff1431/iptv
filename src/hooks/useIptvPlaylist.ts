import { useEffect, useRef, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { parseM3U, type IptvChannel } from "@/lib/m3u-parser";

const PROXY_PATH = "/api/public/iptv/playlist";

export type PlaylistSource = "direct" | "proxy";

export type PlaylistStatus = {
  source: PlaylistSource;
  directError?: string;
  proxyError?: string;
  at: number;
};

// Module-level store keyed by playlist URL. Updated inside fetchPlaylist and
// read by useIptvPlaylistStatus so consumers can render a source badge/message
// without threading the info through react-query's `data` shape.
const statusByUrl = new Map<string, PlaylistStatus>();
const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}
function setStatus(url: string, next: PlaylistStatus) {
  statusByUrl.set(url, next);
  emit();
}

async function fetchDirect(url: string): Promise<string> {
  const res = await fetch(url, { method: "GET", redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function fetchViaProxy(url: string): Promise<string> {
  const res = await fetch(`${PROXY_PATH}?url=${encodeURIComponent(url)}`, { method: "GET" });
  if (!res.ok) {
    let msg = `Proxy HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.text();
}

async function fetchPlaylist(url: string): Promise<IptvChannel[]> {
  if (!url) throw new Error("Playlist URL is empty");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid playlist URL");
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Playlist URL must be http(s)");

  // Try same-origin direct fetch first (avoids proxy hop when provider allows CORS).
  // On any failure — CORS, network, non-2xx — fall back to the server-side proxy.
  let text: string;
  try {
    text = await fetchDirect(url);
    setStatus(url, { source: "direct", at: Date.now() });
  } catch (directErr) {
    const directMsg = directErr instanceof Error ? directErr.message : String(directErr);
    try {
      text = await fetchViaProxy(url);
      setStatus(url, { source: "proxy", directError: directMsg, at: Date.now() });
    } catch (proxyErr) {
      const proxyMsg = proxyErr instanceof Error ? proxyErr.message : String(proxyErr);
      setStatus(url, {
        source: "proxy",
        directError: directMsg,
        proxyError: proxyMsg,
        at: Date.now(),
      });
      throw new Error(`Could not load playlist: ${proxyMsg}`);
    }
  }

  const channels = parseM3U(text);
  if (channels.length === 0) throw new Error("Playlist parsed but contained no channels");
  return channels;
}

import { useServerFn } from "@tanstack/react-start";
import { getPublicIptvChannels, refreshPublicIptvCatalog } from "@/lib/iptv-provider.functions";

type CompactCatalog = { v: 1; g: unknown[]; c: unknown[][] };

function deserializeIptvCatalog(serialized: string): IptvChannel[] {
  const parsed = JSON.parse(serialized) as CompactCatalog;
  if (parsed?.v !== 1 || !Array.isArray(parsed.g) || !Array.isArray(parsed.c)) {
    throw new Error("Provider returned an invalid channel catalog");
  }
  const groups = parsed.g.map((group) => String(group));
  return parsed.c.map((row) => {
    if (!Array.isArray(row) || row.length < 4) {
      throw new Error("Provider returned an invalid channel row");
    }
    const groupIndex = Number(row[3]);
    return {
      id: String(row[0]),
      name: String(row[1]),
      logo: typeof row[2] === "string" && row[2] ? row[2] : null,
      group: Number.isInteger(groupIndex) && groupIndex >= 0 ? (groups[groupIndex] ?? null) : null,
      tvgId: null,
      tvgName: null,
      url: typeof row[4] === "string" ? row[4] : "",
    };
  });
}

export function useIptvPlaylist(url: string) {
  const getChannelsFn = useServerFn(getPublicIptvChannels);
  const refreshChannelsFn = useServerFn(refreshPublicIptvCatalog);
  const queryClient = useQueryClient();
  const refreshStartedFor = useRef("");

  const query = useQuery({
    queryKey: ["iptv", "playlist", url],
    queryFn: async () => {
      if (url === "global:xtream") {
        const serialized = await getChannelsFn();
        const channels = deserializeIptvCatalog(serialized);
        setStatus(url, { source: "direct", at: Date.now() });
        return channels;
      }
      return fetchPlaylist(url);
    },
    enabled: Boolean(url),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  useEffect(() => {
    if (url !== "global:xtream" || !query.isSuccess || refreshStartedFor.current === url) return;
    refreshStartedFor.current = url;
    void refreshChannelsFn()
      .then((result) => {
        if (result.refreshed) {
          return queryClient.invalidateQueries({ queryKey: ["iptv", "playlist", url] });
        }
      })
      .catch(() => {
        // The last good catalog remains usable; admins can inspect the sync error.
      });
  }, [query.isSuccess, queryClient, refreshChannelsFn, url]);

  return query;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useIptvPlaylistStatus(url: string): PlaylistStatus | null {
  return useSyncExternalStore(
    subscribe,
    () => statusByUrl.get(url) ?? null,
    () => null,
  );
}
