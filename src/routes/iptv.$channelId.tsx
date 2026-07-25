import { useEffect } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Star, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IPTVPlayer } from "@/components/iptv/IPTVPlayer";
import { useIptvSettings } from "@/hooks/useIptvSettings";
import { useIptvPlaylist } from "@/hooks/useIptvPlaylist";
import { useIptvFavorites } from "@/hooks/useIptvFavorites";
import { useIptvRecents } from "@/hooks/useIptvRecents";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/iptv/$channelId")({
  head: () => ({
    meta: [
      { title: "IPTV — Now playing" },
      { name: "description", content: "Watch a live IPTV channel." },
    ],
  }),
  component: IptvChannelPage,
});

function IptvChannelPage() {
  const { channelId } = Route.useParams();
  const { url, ready } = useIptvSettings();
  const { data: channels = [], isLoading } = useIptvPlaylist(ready ? url : "");
  const { has, toggle } = useIptvFavorites();
  const { push } = useIptvRecents();

  const channel = channels.find((c) => c.id === channelId);

  useEffect(() => {
    if (channel) push(channel.id);
  }, [channel, push]);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading playlist…</p>;
  }
  if (!channel) {
    return (
      <div className="rounded-lg border border-border/50 bg-card/40 p-8 text-center">
        <p className="text-sm text-muted-foreground">Channel not found in the current playlist.</p>
        <div className="mt-4">
          <Button asChild variant="outline" size="sm">
            <Link to="/iptv">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const fav = has(channel.id);

  return (
    <div className="flex flex-col gap-4">
      <IPTVPlayer url={channel.url} poster={channel.logo} />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{channel.name}</h2>
          {channel.group && (
            <p className="text-xs text-muted-foreground">{channel.group}</p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => toggle(channel.id)}
          aria-pressed={fav}
        >
          <Star className={cn("mr-2 h-4 w-4", fav && "fill-amber-400 text-amber-400")} />
          {fav ? "Favorited" : "Favorite"}
        </Button>
      </div>
    </div>
  );
}
