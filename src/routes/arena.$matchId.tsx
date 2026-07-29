import { useEffect, useMemo, useState } from "react";
import { withAuth } from "@/components/RequireAuth";
import { Link, createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, AlertTriangle, Settings } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { publicMatchesQuery, type PublicMatch } from "@/lib/matches.public.functions";
import { getRequestOrigin } from "@/lib/origin.functions";
import { useIptvSettings } from "@/hooks/useIptvSettings";
import { useIptvPlaylist } from "@/hooks/useIptvPlaylist";
import { MatchGrid } from "@/components/sports-arena/MatchGrid";
import { resolveTvTileLayout, TV_TILE_LAYOUT_SIZE } from "@/lib/match-slot-count";
import { MatchAccessGate } from "@/components/sports-arena/MatchAccessGate";
import { useLiveTick, liveViewers, liveIsLive } from "@/hooks/useLiveTick";
import { SportImage } from "@/components/SportImage";
import { useAuth } from "@/hooks/useAuth";
import { getMatchSlotPref, setMatchSlotPref } from "@/lib/match-slot-prefs.functions";
import { getPublicIptvChannelPlaybacks } from "@/lib/iptv-provider.functions";
import { useLoungePresence } from "@/hooks/useLoungePresence";
import { ArenaHeader } from "@/components/sports-arena/ArenaHeader";
import { ArenaChatPanel } from "@/components/sports-arena/ArenaChatPanel";
import { ArenaActionBar } from "@/components/sports-arena/ArenaActionBar";
import theatreBg from "@/assets/arena-theatre-bg.jpg.asset.json";

export const Route = createFileRoute("/arena/$matchId")({
  loader: async ({ context, params }) => {
    const [matches, origin] = await Promise.all([
      context.queryClient.ensureQueryData(publicMatchesQuery()),
      getRequestOrigin(),
    ]);
    const match = matches.find((m: PublicMatch) => m.id === params.matchId);
    return {
      origin,
      match: match
        ? {
            id: match.id,
            title: match.title,
            sport: match.sport,
            thumbnailUrl: match.thumbnailUrl,
            homeLabel: match.homeLabel,
            awayLabel: match.awayLabel,
          }
        : null,
    };
  },
  head: ({ loaderData, params }) => {
    const origin = loaderData?.origin ?? "";
    const url = origin ? `${origin}/arena/${params.matchId}` : `/arena/${params.matchId}`;
    const match = loaderData?.match;
    const title = match
      ? `${match.title} — Watch Live | PGX Sports Arena`
      : `Watch match — PGX Sports Arena`;
    const description = match
      ? `Watch ${match.title}${match.sport ? ` (${match.sport})` : ""} live with 4 channel feeds in PGX Sports Arena.`
      : `Watch all 4 live channel feeds for match ${params.matchId} in PGX Sports Arena.`;
    const meta: Array<Record<string, string>> = [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "video.other" },
      { property: "og:url", content: url },
      { property: "og:site_name", content: "PGX Sports Lounge" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ];
    if (match?.thumbnailUrl) {
      meta.push({ property: "og:image", content: match.thumbnailUrl });
      meta.push({ name: "twitter:image", content: match.thumbnailUrl });
    }
    return {
      meta,
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: withAuth(MatchWatchPage),
  errorComponent: ({ error, reset }) => (
    <div className="p-6 text-sm text-red-400">
      Failed to load match: {error.message}
      <button className="ml-3 underline" onClick={reset}>
        Retry
      </button>
    </div>
  ),
  notFoundComponent: () => (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center">
      <h1 className="text-lg font-bold">Match not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This match may have ended or been removed.
      </p>
      <Link
        to="/arena"
        className="mt-6 inline-flex items-center gap-2 rounded-lg bg-arena-violet px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-white"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Arena
      </Link>
    </main>
  ),
});

function MatchWatchPage() {
  const { matchId } = Route.useParams();
  const { data: matches } = useSuspenseQuery(publicMatchesQuery());
  const queryClient = useQueryClient();

  const match = matches.find((m) => m.id === matchId);
  if (!match) throw notFound();

  useEffect(() => {
    const suffix = Math.random().toString(36).slice(2);
    const channel = supabase
      .channel(`arena-match-${matchId}-${suffix}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches", filter: `id=eq.${matchId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["publicMatches"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "match_slots", filter: `match_id=eq.${matchId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["publicMatches"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId, queryClient]);

  // Key on match.id so switching matches from the grid fully resets internal
  // state (activeSlot, initialized flag, reloadKey, dialogs) and re-runs every
  // effect: realtime subscription, presence join, chat subscription, playlist
  // reload, and slot-preference initialization.
  return <MatchWatchInner key={match.id} match={match} />;
}

function MatchGridSkeleton({ slotCount }: { slotCount: number }) {
  const count = Math.max(1, Math.min(slotCount || 4, 8));
  const cols =
    count <= 1
      ? "grid-cols-1"
      : count <= 4
        ? "grid-cols-1 sm:grid-cols-2"
        : "grid-cols-2 lg:grid-cols-3";
  return (
    <div className="animate-fade-in" aria-busy="true" aria-label="Loading match streams">
      {/* Tile grid placeholder — matches the live grid columns/aspect. */}
      <div className={`grid gap-3 ${cols}`}>
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="relative overflow-hidden rounded-2xl border border-arena-border bg-arena-panel/60"
          >
            <Skeleton className="aspect-video w-full rounded-none" />
            {/* Overlay pills to hint at tile chrome while loading. */}
            <div className="pointer-events-none absolute inset-x-2 top-2 flex items-center justify-between gap-2">
              <Skeleton className="h-4 w-10 rounded-md" />
              <div className="flex items-center gap-1.5">
                <Skeleton className="hidden h-4 w-16 rounded-md sm:block" />
                <Skeleton className="h-4 w-14 rounded-md" />
              </div>
            </div>
            <div className="pointer-events-none absolute inset-x-2 bottom-2">
              <Skeleton className="h-3 w-2/3 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchWatchInner({ match }: { match: PublicMatch }) {
  const navigate = useNavigate();
  const {
    url: playlistUrl,
    ready,
    source,
    globalUrl,
    hasLocalOverride,
    providerType,
  } = useIptvSettings();
  const {
    data: channels = [],
    isLoading,
    error,
    refetch,
  } = useIptvPlaylist(ready ? playlistUrl : "");
  const playlistError = error instanceof Error ? error.message : error ? String(error) : null;
  const relayChannelIds = useMemo(
    () =>
      providerType === "xtream"
        ? Array.from(
            new Set(
              match.slots
                .filter((slot) => slot.enabled && slot.channelId)
                .map((slot) => slot.channelId as string),
            ),
          )
        : [],
    [match.slots, providerType],
  );
  const relayChannelKey = relayChannelIds.join("|");
  const [relayUrls, setRelayUrls] = useState<Record<string, string>>({});
  const [relayLoading, setRelayLoading] = useState(false);
  const [relayError, setRelayError] = useState<string | null>(null);

  useEffect(() => {
    if (providerType !== "xtream" || relayChannelIds.length === 0) {
      setRelayUrls({});
      setRelayError(null);
      setRelayLoading(false);
      return;
    }

    let cancelled = false;
    setRelayLoading(true);
    setRelayError(null);
    void getPublicIptvChannelPlaybacks({ data: { channelIds: relayChannelIds } })
      .then((urls) => {
        if (!cancelled) setRelayUrls(urls);
      })
      .catch((relayFailure: unknown) => {
        if (cancelled) return;
        setRelayUrls({});
        setRelayError(
          relayFailure instanceof Error
            ? relayFailure.message
            : "Could not prepare secure IPTV playback URLs",
        );
      })
      .finally(() => {
        if (!cancelled) setRelayLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // The joined key changes only when the configured slot IDs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerType, relayChannelKey]);

  const playbackChannels = useMemo(
    () =>
      providerType === "xtream"
        ? channels.map((channel) =>
            relayUrls[channel.id] ? { ...channel, url: relayUrls[channel.id] } : channel,
          )
        : channels,
    [channels, providerType, relayUrls],
  );
  const playbackLoading = isLoading || relayLoading;
  const playbackError = playlistError || relayError;
  const [reloadKey, setReloadKey] = useState(0);
  const handleRefresh = () => {
    void refetch();
    setReloadKey((n) => n + 1);
  };

  const tick = useLiveTick(5000);
  // Real viewer count from presence on the match room, mirroring /lounge/$id.
  // Falls back to the synthetic live tick before the channel is joined so the
  // header never renders blank.
  const presence = useLoungePresence(match.id);
  const baselineViewers = liveViewers(match.viewerCount, match.id, tick);
  const viewers = presence ?? baselineViewers;
  const autoLive = liveIsLive(match.id, tick);
  const isLive = match.status === "live" || (match.status === "scheduled" && autoLive);

  const noProviderConfigured = source === "demo" && !globalUrl && !hasLocalOverride;

  const enabledSlots = useMemo(
    () => match.slots.filter((s) => s.enabled && s.channelId),
    [match.slots],
  );

  const { user, isAdmin, loading: authLoading } = useAuth();
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [chatVisible, setChatVisible] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;

    const readLocal = (): number | null => {
      try {
        const raw = window.localStorage.getItem("arena.activeSlot");
        const parsed = raw ? JSON.parse(raw) : {};
        const v = parsed[match.id];
        return typeof v === "number" ? v : null;
      } catch {
        return null;
      }
    };

    const apply = (saved: number | null) => {
      if (cancelled) return;
      if (saved != null && enabledSlots.some((s) => s.slot === saved)) {
        setActiveSlot(saved);
      } else {
        setActiveSlot(enabledSlots[0]?.slot ?? null);
      }
      setInitialized(true);
    };

    if (user) {
      void getMatchSlotPref({ data: { matchId: match.id } })
        .then((res) => apply(res?.slot ?? readLocal()))
        .catch(() => apply(readLocal()));
    } else {
      apply(readLocal());
    }

    return () => {
      cancelled = true;
    };
  }, [authLoading, user, match.id, enabledSlots]);

  useEffect(() => {
    if (!initialized) return;
    if (activeSlot != null && enabledSlots.some((s) => s.slot === activeSlot)) return;
    setActiveSlot(enabledSlots[0]?.slot ?? null);
  }, [initialized, enabledSlots, activeSlot]);

  useEffect(() => {
    if (!initialized) return;
    try {
      const raw = window.localStorage.getItem("arena.activeSlot") || "{}";
      const parsed = JSON.parse(raw);
      if (activeSlot != null) {
        parsed[match.id] = activeSlot;
      } else {
        delete parsed[match.id];
      }
      window.localStorage.setItem("arena.activeSlot", JSON.stringify(parsed));
    } catch {
      /* ignore */
    }
    if (user) {
      void setMatchSlotPref({ data: { matchId: match.id, slot: activeSlot } }).catch(() => {
        /* best-effort */
      });
    }
  }, [initialized, activeSlot, match.id, user]);

  return (
    <>
      <main className="mx-auto max-w-[1600px] px-3 pt-3 sm:px-6 sm:pt-4">
        <ArenaHeader liveGames={enabledSlots.length} viewers={viewers} />

        {/* Utility row: back link to arena browse */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Link
            to="/arena"
            onClick={(e) => {
              // Prefer browser history so the grid restores scroll and filters
              // when we came from /arena. Fall back to a fresh Link navigation
              // on direct loads (no prior history entry for this app).
              if (typeof window !== "undefined" && window.history.length > 1) {
                e.preventDefault();
                window.history.back();
              }
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-arena-border bg-arena-panel/70 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Arena
          </Link>
        </div>

        {/* Theatre card */}
        <div className="relative isolate overflow-hidden rounded-3xl border border-arena-border">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${theatreBg.url})` }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--arena-bg)_55%,transparent)_0%,color-mix(in_oklab,var(--arena-bg)_30%,transparent)_45%,color-mix(in_oklab,var(--arena-bg)_80%,transparent)_100%)]"
          />

          {/* Match summary strip inside theatre card */}
          <section className="relative m-3 flex items-center gap-4 rounded-2xl border border-arena-border bg-arena-panel/70 p-3 sm:m-5 sm:p-4 lg:m-6">
            <div className="hidden h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-black/50 sm:block">
              {match.thumbnailUrl ? (
                <img src={match.thumbnailUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <SportImage sport={match.sport ?? ""} width={192} height={128} alt="" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {match.sport && (
                  <span className="rounded-md bg-black/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/95">
                    {match.sport}
                  </span>
                )}
                <span
                  className={`inline-flex h-5 items-center rounded-[6px] px-2 text-[10px] font-bold uppercase leading-none ${
                    isLive
                      ? "bg-live text-live-foreground"
                      : match.status === "final"
                        ? "bg-black/70 text-white/80 ring-1 ring-inset ring-arena-border"
                        : "bg-arena-panel-2/80 text-muted-foreground ring-1 ring-inset ring-arena-border"
                  }`}
                >
                  {isLive
                    ? "Live"
                    : match.status === "final"
                      ? "Final"
                      : match.status === "halftime"
                        ? "Half"
                        : "Soon"}
                </span>
              </div>
              <h1 className="mt-1 truncate font-display text-lg font-bold">{match.title}</h1>
              {match.homeLabel && match.awayLabel && (
                <div className="mt-1 flex items-center gap-2 text-sm text-white/90">
                  <span className="truncate font-semibold">{match.homeLabel}</span>
                  <span className="text-muted-foreground">vs</span>
                  <span className="truncate font-semibold">{match.awayLabel}</span>
                </div>
              )}
            </div>
          </section>

          <div
            className={`relative grid gap-4 px-3 pb-3 sm:gap-5 sm:px-5 sm:pb-5 lg:px-6 lg:pb-6 ${
              chatVisible ? "lg:grid-cols-[minmax(0,1fr)_360px]" : "lg:grid-cols-1"
            }`}
          >
            <div className="min-w-0">
              <MatchAccessGate matchId={match.id} autoEnter>
                {() =>
                  !initialized || (isLoading && channels.length === 0) ? (
                    <MatchGridSkeleton slotCount={match.slots.length || 4} />
                  ) : (
                    <div key={match.id} className="animate-fade-in">
                      {noProviderConfigured && (
                        <div
                          role="status"
                          className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-arena-border bg-arena-panel/60 px-3 py-2 text-[11px] text-muted-foreground"
                        >
                          <AlertTriangle
                            className="h-3.5 w-3.5 text-amber-400"
                            aria-hidden="true"
                          />
                          <span className="flex-1 min-w-0">
                            Showing the iptv-org demo playlist while a live IPTV provider isn't
                            configured.
                          </span>
                          {isAdmin && (
                            <Link
                              to="/admin/iptv-provider"
                              className="inline-flex items-center gap-1 rounded-md bg-amber-500/20 px-2 py-1 text-[11px] font-bold uppercase text-amber-100 hover:bg-amber-500/30"
                            >
                              <Settings className="h-3 w-3" /> Configure provider
                            </Link>
                          )}
                        </div>
                      )}
                      {isAdmin &&
                        (() => {
                          const layout = resolveTvTileLayout(match.slots, (n) => ({
                            slot: n,
                            channelId: null,
                            channelName: null,
                            channelLogo: null,
                            enabled: false,
                          }));
                          if (layout.overflowCount === 0) return null;
                          const droppedNums = layout.overflow.map((s) => s.slot);
                          return (
                            <div
                              role="alert"
                              className="mb-3 flex flex-wrap items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-100"
                            >
                              <AlertTriangle
                                className="mt-0.5 h-4 w-4 shrink-0 text-amber-300"
                                aria-hidden="true"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="font-semibold">
                                  Admin: {layout.overflowCount} extra slot
                                  {layout.overflowCount === 1 ? "" : "s"} hidden from viewers
                                </div>
                                <div className="mt-0.5 text-amber-100/80">
                                  The arena TV view is locked to {TV_TILE_LAYOUT_SIZE} tiles (slots
                                  1–{TV_TILE_LAYOUT_SIZE}). Dropped:{" "}
                                  <span className="font-mono font-semibold">
                                    slot {droppedNums.join(", slot ")}
                                  </span>
                                  . Lower this match's slot count or move channels into slots 1–
                                  {TV_TILE_LAYOUT_SIZE}.
                                </div>
                                <Link
                                  to="/admin/arena"
                                  className="mt-1.5 inline-flex items-center gap-1 text-amber-200 underline underline-offset-2 hover:text-amber-100"
                                >
                                  <Settings className="h-3 w-3" /> Edit match slots
                                </Link>
                              </div>
                            </div>
                          );
                        })()}
                      <MatchGrid
                        match={match}
                        channels={playbackChannels}
                        activeSlot={activeSlot}
                        onActiveSlotChange={setActiveSlot}
                        loadingPlaylist={playbackLoading}
                        playlistError={playbackError}
                        reloadKey={reloadKey}
                        onRetry={handleRefresh}
                      />
                    </div>
                  )
                }
              </MatchAccessGate>
            </div>

            <div className={`min-w-0 ${chatVisible ? "lg:flex lg:flex-col" : "hidden"}`}>
              <ArenaChatPanel matchId={match.id} online={viewers} visible={chatVisible} />
            </div>
          </div>

          <div className="relative px-3 pb-3 sm:px-5 sm:pb-5 lg:px-6 lg:pb-6">
            <ArenaActionBar
              loungeId={match.id}
              matchId={match.id}
              hostUserId={match.ownerUserId}
              hostName={match.hostDisplayName ?? "Match host"}
              tvs={[]}
              slots={match.slots}
              isHost={!!user && (isAdmin || (!!match.ownerUserId && match.ownerUserId === user.id))}
              chatVisible={chatVisible}
              onToggleChat={() => setChatVisible((v) => !v)}
              onLeave={() => navigate({ to: "/arena" })}
            />
          </div>
        </div>
      </main>
    </>
  );
}
