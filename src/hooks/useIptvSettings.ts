import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { DEMO_M3U_URL } from "@/lib/m3u-parser";
import { getPublicIptvProvider } from "@/lib/iptv-provider.functions";

const KEY = "iptv.playlistUrl";

/**
 * Resolves the effective IPTV playlist URL:
 *   1. Admin-configured global provider (app_settings.iptv_m3u_url) — used by
 *      every match automatically.
 *   2. Per-browser override saved via setUrl() (kept in localStorage).
 *   3. Public iptv-org demo playlist as the final fallback.
 *
 * Any admin change to /admin/iptv-provider invalidates the shared query key
 * `["iptv-provider", "public"]` so all consumers pick it up immediately.
 */
export function useIptvSettings() {
  const qc = useQueryClient();
  const getProvider = useServerFn(getPublicIptvProvider);

  const provider = useQuery({
    queryKey: ["iptv-provider", "public"],
    queryFn: () => getProvider(),
    staleTime: 60_000,
  });

  const [localOverride, setLocalOverride] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(KEY);
      if (v) setLocalOverride(v);
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  const providerType: "m3u" | "xtream" | null = provider.data?.provider_type ?? null;
  const globalUrl =
    providerType === "xtream"
      ? "global:xtream"
      : provider.data?.m3u_url?.trim() || "";

  // When an admin provider is active, use it as default so stale localStorage overrides don't break playback.
  const hasGlobalProvider = Boolean(globalUrl);
  const url = (hasGlobalProvider ? globalUrl : localOverride && localOverride.trim()) || DEMO_M3U_URL;
  const source: "override" | "global" | "demo" = (hasGlobalProvider ? false : Boolean(localOverride))
    ? "override"
    : globalUrl
      ? "global"
      : "demo";

  const setUrl = useCallback(
    (next: string) => {
      const trimmed = next.trim();
      setLocalOverride(trimmed || null);
      try {
        if (trimmed) window.localStorage.setItem(KEY, trimmed);
        else window.localStorage.removeItem(KEY);
      } catch {
        /* ignore */
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setLocalOverride(null);
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    // Refresh in case the admin just updated the global provider.
    qc.invalidateQueries({ queryKey: ["iptv-provider", "public"] });
  }, [qc]);

  return {
    url,
    setUrl,
    reset,
    ready: ready && !provider.isLoading,
    demoUrl: DEMO_M3U_URL,
    globalUrl,
    hasLocalOverride: !!localOverride,
    source,
    providerType,
  };
}
