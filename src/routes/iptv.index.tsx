import { Link, createFileRoute } from "@tanstack/react-router";
import { Tv, History, Star, Play, Sparkles, Radio, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIptvSettings } from "@/hooks/useIptvSettings";
import { useIptvPlaylist } from "@/hooks/useIptvPlaylist";
import { useIptvRecents } from "@/hooks/useIptvRecents";
import { useIptvFavorites } from "@/hooks/useIptvFavorites";
import { ChannelCard } from "@/components/iptv/ChannelCard";

export const Route = createFileRoute("/iptv/")({
  head: () => ({
    meta: [
      { title: "IPTV — Select a Live Channel" },
      { name: "description", content: "Select a channel from your live IPTV playlist to start watching." },
    ],
  }),
  component: IptvIndex,
});

function IptvIndex() {
  const { url, ready } = useIptvSettings();
  const { data: channels = [], isLoading } = useIptvPlaylist(ready ? url : "");
  const { ids: recents } = useIptvRecents();
  const { ids: favorites, toggle } = useIptvFavorites();

  const byId = new Map(channels.map((c) => [c.id, c]));
  const recentChannels = recents.map((id) => byId.get(id)).filter(Boolean) as typeof channels;
  const favoriteChannels = favorites.map((id) => byId.get(id)).filter(Boolean) as typeof channels;

  // Pick first 6 channels as featured recommendations if available
  const featuredChannels = channels.slice(0, 6);

  return (
    <div className="flex flex-col gap-6 pb-6">
      {/* Hero Welcome Banner */}
      <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-r from-primary/20 via-purple-950/40 to-background p-6 backdrop-blur-xl shadow-2xl shadow-primary/5">
        <div className="absolute right-0 top-0 -mr-16 -mt-16 h-64 w-64 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              PGX Live Cinema Experience
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Stream 18,000+ Live Channels
            </h2>
            <p className="text-xs text-muted-foreground sm:text-sm">
              Select any channel from the sidebar or pick from your favorites below to start instant HD stream playback.
            </p>
          </div>
          {featuredChannels.length > 0 && (
            <Button asChild size="lg" className="shrink-0 gap-2 font-bold shadow-lg shadow-primary/20">
              <Link to="/iptv/$channelId" params={{ channelId: featuredChannels[0].id }}>
                <Play className="h-4 w-4 fill-current" />
                Quick Watch
              </Link>
            </Button>
          )}
        </div>
      </section>

      {/* Recently Watched Grid */}
      {recentChannels.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-foreground">
            <History className="h-4 w-4 text-primary" />
            <span>Recently Watched</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recentChannels.slice(0, 6).map((c) => (
              <ChannelCard
                key={c.id}
                channel={c}
                isFavorite={favorites.includes(c.id)}
                onToggleFavorite={toggle}
                variant="grid"
              />
            ))}
          </div>
        </section>
      )}

      {/* Favorites Grid */}
      {favoriteChannels.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
            <span>Favorite Channels</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {favoriteChannels.slice(0, 6).map((c) => (
              <ChannelCard
                key={c.id}
                channel={c}
                isFavorite
                onToggleFavorite={toggle}
                variant="grid"
              />
            ))}
          </div>
        </section>
      )}

      {/* Featured Suggestions Grid when no recents/favorites */}
      {recentChannels.length === 0 && favoriteChannels.length === 0 && featuredChannels.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Zap className="h-4 w-4 text-amber-400" />
              <span>Recommended Live Channels</span>
            </div>
            <span className="text-xs text-muted-foreground">{channels.length.toLocaleString()} available</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {featuredChannels.map((c) => (
              <ChannelCard
                key={c.id}
                channel={c}
                isFavorite={favorites.includes(c.id)}
                onToggleFavorite={toggle}
                variant="grid"
              />
            ))}
          </div>
        </section>
      )}

      {/* Empty State */}
      {channels.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-card/30 p-12 text-center backdrop-blur-md">
          <Tv className="h-12 w-12 text-muted-foreground/40" />
          <h3 className="mt-4 text-base font-semibold text-foreground">No IPTV Playlist Configured</h3>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Configure an IPTV provider in settings to access live channels.
          </p>
          <Button asChild size="sm" className="mt-4">
            <Link to="/iptv/settings">Open Settings</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
