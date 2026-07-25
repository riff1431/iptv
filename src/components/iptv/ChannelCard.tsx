import { Star, Tv } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { ThumbFallback } from "@/components/ThumbFallback";
import { cn } from "@/lib/utils";
import type { IptvChannel } from "@/lib/m3u-parser";

type Props = {
  channel: IptvChannel;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
  active?: boolean;
};

export function ChannelCard({ channel, isFavorite, onToggleFavorite, active }: Props) {
  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-md border border-border/50 bg-card/50 p-2 transition hover:bg-muted/60",
        active && "border-primary bg-muted",
      )}
    >
      <Link
        to="/iptv/$channelId"
        params={{ channelId: channel.id }}
        className="flex flex-1 items-center gap-3 min-w-0"
      >
        <div className="relative h-10 w-16 shrink-0 overflow-hidden rounded bg-muted">
          {channel.logo ? (
            <img
              src={channel.logo}
              alt=""
              className="h-full w-full object-contain"
              loading="lazy"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <ThumbFallback icon={Tv} size="sm" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">{channel.name}</div>
          {channel.group && (
            <div className="truncate text-xs text-muted-foreground">{channel.group}</div>
          )}
        </div>
      </Link>
      <button
        type="button"
        aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
        onClick={() => onToggleFavorite(channel.id)}
        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-amber-400"
      >
        <Star className={cn("h-4 w-4", isFavorite && "fill-amber-400 text-amber-400")} />
      </button>
    </div>
  );
}
