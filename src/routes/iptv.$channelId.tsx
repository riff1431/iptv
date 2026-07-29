import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Star, ArrowLeft, Radio, Layers, Tv, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IPTVPlayer } from "@/components/iptv/IPTVPlayer";
import { useIptvSettings } from "@/hooks/useIptvSettings";
import { useIptvPlaylist } from "@/hooks/useIptvPlaylist";
import { useIptvFavorites } from "@/hooks/useIptvFavorites";
import { useIptvRecents } from "@/hooks/useIptvRecents";
import { ChannelCard } from "@/components/iptv/ChannelCard";
import { cn } from "@/lib/utils";
import { getPublicIptvChannelPlayback } from "@/lib/iptv-provider.functions";
import type { IptvChannel } from "@/lib/m3u-parser";

export const Route = createFileRoute("/iptv/$channelId")({
  head: () => ({
    meta: [
      { title: "IPTV Cinema — Live Playing" },
      { name: "description", content: "Watch live channel in high definition." },
    ],
  }),
  component: IptvChannelPage,
});

function IptvChannelPage() {
  const { channelId } = Route.useParams();
  const { url, ready } = useIptvSettings();
  const { data: channels = [], isLoading } = useIptvPlaylist(ready ? url : "");
  const getPlayback = useServerFn(getPublicIptvChannelPlayback);
  const { has, toggle } = useIptvFavorites();
  const { push } = useIptvRecents();

  const channel = channels.find((c) => c.id === channelId);
  const isGlobalXtream = url === "global:xtream";
  const playback = useQuery({
    queryKey: ["iptv", "playback", channelId],
    queryFn: () => getPlayback({ data: { channelId } }),
    // The signed relay URL only needs the channel ID. Start it alongside the
    // large catalog request instead of waiting for all ~19k channels to parse.
    enabled: ready && isGlobalXtream,
    staleTime: 5 * 60 * 1000,
  });
  const playbackUrl = isGlobalXtream ? (playback.data?.url ?? "") : (channel?.url ?? "");
  const activeChannel: IptvChannel | undefined =
    channel ??
    (isGlobalXtream
      ? {
          id: channelId,
          name: `Channel ${channelId}`,
          logo: null,
          group: null,
          tvgId: null,
          tvgName: null,
          url: "",
        }
      : undefined);

  useEffect(() => {
    if (channel) push(channel.id);
  }, [channel, push]);

  // Find other channels in the same category for quick switching
  const categoryChannels = useMemo(() => {
    if (!channel || !channel.group) return [];
    return channels.filter((c) => c.group === channel.group && c.id !== channel.id).slice(0, 6);
  }, [channels, channel]);

  if ((!isGlobalXtream && isLoading) || (isGlobalXtream && !playbackUrl && playback.isLoading)) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 bg-card/30 p-8 backdrop-blur-md">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-xs font-medium text-muted-foreground">Connecting to live stream…</p>
      </div>
    );
  }

  if (!activeChannel) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-card/30 p-12 text-center backdrop-blur-md">
        <Tv className="h-10 w-10 text-muted-foreground/40" />
        <h3 className="mt-3 text-base font-semibold text-foreground">Channel Not Found</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          The requested channel could not be found in the current IPTV playlist.
        </p>
        <Button asChild variant="outline" size="sm" className="mt-4 border-white/10">
          <Link to="/iptv">
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back to Channels
          </Link>
        </Button>
      </div>
    );
  }

  if (playback.isError || !playbackUrl) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-destructive/30 bg-card/30 p-12 text-center">
        <Tv className="h-10 w-10 text-destructive/70" />
        <h3 className="mt-3 text-base font-semibold text-foreground">Stream unavailable</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {playback.error instanceof Error
            ? playback.error.message
            : "Could not prepare this channel for playback."}
        </p>
      </div>
    );
  }

  const fav = has(activeChannel.id);

  return (
    <div className="flex flex-col gap-5 pb-8">
      {/* Video Player Box with Ambient Glow */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl shadow-primary/10">
        <IPTVPlayer url={playbackUrl} poster={activeChannel.logo} />
      </div>

      {/* Live Channel Info Bar */}
      <div className="flex flex-col gap-4 rounded-xl border border-white/10 bg-card/50 p-4 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-black/60 p-1 flex items-center justify-center border border-white/10">
            {activeChannel.logo ? (
              <img
                src={activeChannel.logo}
                alt={activeChannel.name}
                className="max-h-full max-w-full object-contain"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <Tv className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-base font-bold text-foreground sm:text-lg">
                {activeChannel.name}
              </h2>
              <Badge
                variant="outline"
                className="border-red-500/40 bg-red-500/10 text-red-400 text-[10px] font-bold"
              >
                <Radio className="mr-1 h-3 w-3 animate-pulse" />
                LIVE
              </Badge>
            </div>
            {activeChannel.group && (
              <p className="truncate text-xs font-medium text-muted-foreground">
                {activeChannel.group}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => toggle(activeChannel.id)}
            aria-pressed={fav}
            className={cn(
              "h-9 border-white/10 text-xs font-semibold backdrop-blur-sm transition-colors",
              fav && "border-amber-400/50 bg-amber-400/10 text-amber-400 hover:bg-amber-400/20",
            )}
          >
            <Star className={cn("mr-1.5 h-4 w-4", fav && "fill-amber-400 text-amber-400")} />
            {fav ? "Favorited" : "Add Favorite"}
          </Button>
        </div>
      </div>

      {/* Same Category Quick Switcher */}
      {categoryChannels.length > 0 && channel && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <Layers className="h-3.5 w-3.5 text-primary" />
              <span>More in {channel.group}</span>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {categoryChannels.map((c) => (
              <ChannelCard
                key={c.id}
                channel={c}
                isFavorite={has(c.id)}
                onToggleFavorite={toggle}
                variant="grid"
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
