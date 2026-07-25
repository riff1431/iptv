import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { getPublicIptvChannels } from "@/lib/iptv-provider.functions";

export function useIptvPlaylist(url: string) {
  const getChannelsFn = useServerFn(getPublicIptvChannels);

  return useQuery({
    queryKey: ["iptv", "playlist", url],
    queryFn: async () => {
      if (url === "global:xtream") {
        const channels = await getChannelsFn();
        setStatus(url, { source: "direct", at: Date.now() });
        return channels;
      }
      return fetchPlaylist(url);
    },
    enabled: Boolean(url),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
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
