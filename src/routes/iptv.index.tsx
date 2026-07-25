import { Link, createFileRoute } from "@tanstack/react-router";
import { Tv, History } from "lucide-react";
import { useIptvSettings } from "@/hooks/useIptvSettings";
import { useIptvPlaylist } from "@/hooks/useIptvPlaylist";
import { useIptvRecents } from "@/hooks/useIptvRecents";
import { useIptvFavorites } from "@/hooks/useIptvFavorites";
import { ChannelCard } from "@/components/iptv/ChannelCard";

export const Route = createFileRoute("/iptv/")({
  head: () => ({
    meta: [
      { title: "IPTV — Pick a channel" },
      { name: "description", content: "Choose a channel from your IPTV playlist." },
    ],
  }),
  component: IptvIndex,
});

function IptvIndex() {
  const { url, ready } = useIptvSettings();
  const { data: channels = [] } = useIptvPlaylist(ready ? url : "");
  const { ids: recents } = useIptvRecents();
  const { ids: favorites, toggle } = useIptvFavorites();

  const byId = new Map(channels.map((c) => [c.id, c]));
  const recentChannels = recents.map((id) => byId.get(id)).filter(Boolean) as typeof channels;
  const favoriteChannels = favorites.map((id) => byId.get(id)).filter(Boolean) as typeof channels;

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-border/50 bg-card/40 p-8 text-center">
        <Tv className="mx-auto h-10 w-10 text-muted-foreground" />
        <h2 className="mt-3 text-lg font-semibold">Select a channel to start watching</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Use the sidebar to browse, search, and filter by category.
        </p>
      </section>

      {recentChannels.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
            <History className="h-4 w-4" /> Recently watched
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {recentChannels.slice(0, 8).map((c) => (
              <ChannelCard
                key={c.id}
                channel={c}
                isFavorite={favorites.includes(c.id)}
                onToggleFavorite={toggle}
              />
            ))}
          </div>
        </section>
      )}

      {favoriteChannels.length > 0 && (
        <section>
          <div className="mb-2 text-sm font-semibold text-foreground">Favorites</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {favoriteChannels.slice(0, 8).map((c) => (
              <ChannelCard
                key={c.id}
                channel={c}
                isFavorite
                onToggleFavorite={toggle}
              />
            ))}
          </div>
        </section>
      )}

      {channels.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No playlist loaded.{" "}
          <Link to="/iptv/settings" className="text-primary underline">
            Load one in settings
          </Link>
          .
        </p>
      )}
    </div>
  );
}
