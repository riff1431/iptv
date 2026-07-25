import { Link } from "@tanstack/react-router";
import { Clock } from "lucide-react";
import type { IptvChannel } from "@/lib/m3u-parser";
import { cn } from "@/lib/utils";

type Props = {
  channels: IptvChannel[];
  recentIds: string[];
  activeId?: string;
  onNavigate?: () => void;
  limit?: number;
};

export function RecentlyWatched({
  channels,
  recentIds,
  activeId,
  onNavigate,
  limit = 8,
}: Props) {
  const map = new Map(channels.map((c) => [c.id, c]));
  const items = recentIds
    .map((id) => map.get(id))
    .filter((c): c is IptvChannel => Boolean(c))
    .slice(0, limit);

  if (items.length === 0) return null;

  return (
    <section
      className="rounded-md border border-border/50 bg-card/40 p-2"
      aria-label="Recently watched channels"
    >
      <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Clock className="h-3 w-3" />
        Recently Watched
      </div>
      <ul className="flex flex-col gap-0.5">
        {items.map((c) => {
          const active = c.id === activeId;
          return (
            <li key={c.id}>
              <Link
                to="/iptv/$channelId"
                params={{ channelId: c.id }}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded px-1.5 py-1 text-xs transition hover:bg-muted/60",
                  active && "bg-primary/10 text-primary",
                )}
                title={c.name}
              >
                {c.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.logo}
                    alt=""
                    loading="lazy"
                    className="h-6 w-6 shrink-0 rounded-sm object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                    }}
                  />
                ) : (
                  <div className="h-6 w-6 shrink-0 rounded-sm bg-muted" />
                )}
                <span className="truncate">{c.name}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
