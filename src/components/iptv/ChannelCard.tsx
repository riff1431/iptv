import { Star, Tv, Play } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { ThumbFallback } from "@/components/ThumbFallback";
import { cn } from "@/lib/utils";
import type { IptvChannel } from "@/lib/m3u-parser";

type Props = {
  channel: IptvChannel;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
  active?: boolean;
  variant?: "list" | "grid";
};

export function ChannelCard({
  channel,
  isFavorite,
  onToggleFavorite,
  active,
  variant = "list",
}: Props) {
  if (variant === "grid") {
    return (
      <div
        className={cn(
          "group relative flex flex-col overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-card/80 to-card/40 backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10",
          active && "border-primary bg-primary/10 ring-1 ring-primary shadow-lg shadow-primary/20",
        )}
      >
        <Link
          to="/iptv/$channelId"
          params={{ channelId: channel.id }}
          className="flex flex-col p-3"
        >
          <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black/40 p-2 flex items-center justify-center">
            {channel.logo ? (
              <img
                src={channel.logo}
                alt={channel.name}
                className="max-h-full max-w-full object-contain transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <ThumbFallback icon={Tv} size="md" />
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md">
                <Play className="h-4 w-4 fill-current ml-0.5" />
              </div>
            </div>
            {active && (
              <div className="absolute top-2 left-2 flex items-center gap-1.5 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider animate-pulse">
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
                Playing
              </div>
            )}
          </div>
          <div className="mt-2.5 flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                {channel.name}
              </h3>
              {channel.group && (
                <p className="truncate text-[11px] text-muted-foreground">{channel.group}</p>
              )}
            </div>
            <button
              type="button"
              aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleFavorite(channel.id);
              }}
              className="rounded-full p-1 text-muted-foreground hover:bg-white/10 hover:text-amber-400"
            >
              <Star className={cn("h-3.5 w-3.5", isFavorite && "fill-amber-400 text-amber-400")} />
            </button>
          </div>
        </Link>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group relative flex items-center gap-3 rounded-lg border border-white/5 bg-card/60 p-2 backdrop-blur-sm transition-all duration-200 hover:border-primary/40 hover:bg-card/90",
        active && "border-primary/80 bg-primary/10 shadow-sm shadow-primary/20",
      )}
    >
      <Link
        to="/iptv/$channelId"
        params={{ channelId: channel.id }}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <div className="relative h-10 w-14 shrink-0 overflow-hidden rounded-md bg-black/40 p-1 flex items-center justify-center border border-white/5">
          {channel.logo ? (
            <img
              src={channel.logo}
              alt=""
              className="max-h-full max-w-full object-contain"
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
          <div className="truncate text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
            {channel.name}
          </div>
          {channel.group && (
            <div className="truncate text-[10px] text-muted-foreground">{channel.group}</div>
          )}
        </div>
      </Link>
      <button
        type="button"
        aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
        onClick={() => onToggleFavorite(channel.id)}
        className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/10 hover:text-amber-400 transition-colors"
      >
        <Star className={cn("h-4 w-4", isFavorite && "fill-amber-400 text-amber-400")} />
      </button>
    </div>
  );
}
