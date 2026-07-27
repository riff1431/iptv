import { useMemo, useState } from "react";
import { Search, LayoutGrid, List, X, Star, Filter, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChannelCard } from "./ChannelCard";
import type { IptvChannel } from "@/lib/m3u-parser";
import { cn } from "@/lib/utils";

type Props = {
  channels: IptvChannel[];
  loading?: boolean;
  favorites: string[];
  activeId?: string;
  onToggleFavorite: (id: string) => void;
};

const ALL = "__all__";

export function ChannelList({
  channels,
  loading = false,
  favorites,
  activeId,
  onToggleFavorite,
}: Props) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<string>(ALL);
  const [tab, setTab] = useState<"all" | "favorites">("all");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [displayLimit, setDisplayLimit] = useState(100);

  // Group channels with exact channel count per category
  const groupsWithCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of channels) {
      if (c.group) {
        map.set(c.group, (map.get(c.group) ?? 0) + 1);
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
  }, [channels]);

  const allFiltered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const favSet = new Set(favorites);
    return channels
      .filter((c) => (tab === "favorites" ? favSet.has(c.id) : true))
      .filter((c) => (group === ALL ? true : c.group === group))
      .filter((c) => (needle ? c.name.toLowerCase().includes(needle) : true));
  }, [channels, favorites, group, q, tab]);

  const displayedChannels = useMemo(() => {
    return allFiltered.slice(0, displayLimit);
  }, [allFiltered, displayLimit]);

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Top Tabs & View Toggle */}
      <div className="flex items-center gap-2">
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as "all" | "favorites");
            setDisplayLimit(100);
          }}
          className="flex-1"
        >
          <TabsList className="grid w-full grid-cols-2 bg-muted/40 p-1">
            <TabsTrigger value="all" className="text-xs font-semibold">
              All ({channels.length})
            </TabsTrigger>
            <TabsTrigger value="favorites" className="text-xs font-semibold">
              <Star className="mr-1 h-3 w-3 fill-amber-400 text-amber-400" />
              Favorites ({favorites.length})
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex rounded-md border border-border/50 bg-muted/40 p-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "h-7 w-7 rounded-sm",
              viewMode === "list" && "bg-card text-foreground shadow-sm",
            )}
            onClick={() => setViewMode("list")}
            title="List view"
          >
            <List className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "h-7 w-7 rounded-sm",
              viewMode === "grid" && "bg-card text-foreground shadow-sm",
            )}
            onClick={() => setViewMode("grid")}
            title="Grid view"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Search Input */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search 18,000+ channels..."
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setDisplayLimit(100);
          }}
          className="h-9 border-border/60 bg-muted/20 pl-8 pr-8 text-xs placeholder:text-muted-foreground/70 focus-visible:ring-primary/40"
        />
        {q && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              setDisplayLimit(100);
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Category Dropdown Filter */}
      <Select
        value={group}
        onValueChange={(v) => {
          setGroup(v);
          setDisplayLimit(100);
        }}
      >
        <SelectTrigger className="h-9 border-border/60 bg-muted/20 text-xs">
          <div className="flex items-center gap-2 truncate">
            <Filter className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <SelectValue placeholder="All Categories" />
          </div>
        </SelectTrigger>
        <SelectContent className="max-h-72">
          <SelectItem value={ALL} className="text-xs font-medium">
            All Categories ({groupsWithCount.length} categories)
          </SelectItem>
          {groupsWithCount.map((g) => (
            <SelectItem key={g.name} value={g.name} className="text-xs">
              <span className="truncate">{g.name}</span>
              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground font-mono">
                {g.count}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Channels Items List/Grid container */}
      <div className="flex-1 overflow-y-auto pr-1">
        {loading ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="mt-3 text-xs font-medium text-muted-foreground">Loading channels…</p>
          </div>
        ) : displayedChannels.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <Search className="h-8 w-8 text-muted-foreground/40" />
            <p className="mt-2 text-xs font-medium text-muted-foreground">No channels found</p>
            {q && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 h-7 text-xs text-primary"
                onClick={() => setQ("")}
              >
                Clear search
              </Button>
            )}
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-2">
            {displayedChannels.map((c) => (
              <ChannelCard
                key={c.id}
                channel={c}
                isFavorite={favorites.includes(c.id)}
                onToggleFavorite={onToggleFavorite}
                active={c.id === activeId}
                variant="grid"
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {displayedChannels.map((c) => (
              <ChannelCard
                key={c.id}
                channel={c}
                isFavorite={favorites.includes(c.id)}
                onToggleFavorite={onToggleFavorite}
                active={c.id === activeId}
                variant="list"
              />
            ))}
          </div>
        )}

        {/* Batch Pagination Controls */}
        {displayLimit < allFiltered.length && (
          <div className="my-4 flex flex-col items-center gap-2 rounded-lg border border-white/5 bg-card/30 p-3 backdrop-blur-sm">
            <p className="text-[11px] font-medium text-muted-foreground">
              Showing{" "}
              <span className="font-semibold text-foreground">{displayedChannels.length}</span> of{" "}
              <span className="font-semibold text-foreground">{allFiltered.length}</span> matching
              channels
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setDisplayLimit((prev) => prev + 100)}
                className="h-8 text-xs font-semibold border-primary/30 hover:border-primary hover:bg-primary/10"
              >
                Load More (+100)
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setDisplayLimit(allFiltered.length)}
                className="h-8 text-xs text-muted-foreground hover:text-foreground"
              >
                Show All ({allFiltered.length})
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
