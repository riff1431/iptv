import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
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

type Props = {
  channels: IptvChannel[];
  favorites: string[];
  activeId?: string;
  onToggleFavorite: (id: string) => void;
};

const ALL = "__all__";

export function ChannelList({ channels, favorites, activeId, onToggleFavorite }: Props) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<string>(ALL);
  const [tab, setTab] = useState<"all" | "favorites">("all");

  const groups = useMemo(() => {
    const s = new Set<string>();
    for (const c of channels) if (c.group) s.add(c.group);
    return Array.from(s).sort();
  }, [channels]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const favSet = new Set(favorites);
    return channels
      .filter((c) => (tab === "favorites" ? favSet.has(c.id) : true))
      .filter((c) => (group === ALL ? true : c.group === group))
      .filter((c) => (needle ? c.name.toLowerCase().includes(needle) : true))
      .slice(0, 500); // cap for perf on huge lists
  }, [channels, favorites, group, q, tab]);

  return (
    <div className="flex h-full flex-col gap-3">
      <Tabs value={tab} onValueChange={(v) => setTab(v as "all" | "favorites")}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="all">All Channels</TabsTrigger>
          <TabsTrigger value="favorites">Favorites</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search channels..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-8"
        />
      </div>
      <Select value={group} onValueChange={setGroup}>
        <SelectTrigger>
          <SelectValue placeholder="Category" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All categories</SelectItem>
          {groups.map((g) => (
            <SelectItem key={g} value={g}>
              {g}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex-1 overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">No channels match.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {filtered.map((c) => (
              <ChannelCard
                key={c.id}
                channel={c}
                isFavorite={favorites.includes(c.id)}
                onToggleFavorite={onToggleFavorite}
                active={c.id === activeId}
              />
            ))}
          </div>
        )}
        {channels.length > 500 && (
          <p className="p-3 text-center text-xs text-muted-foreground">
            Showing first 500 matches — refine your search to narrow.
          </p>
        )}
      </div>
    </div>
  );
}
