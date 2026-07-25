import { useEffect, useMemo, useState } from "react";
import { Search, Tv2, Radio, Play, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useIptvOrgCatalog, type IptvOrgMergedChannel } from "@/lib/iptv-org";
import { HlsPlayer } from "@/components/HlsPlayer";

export type PickedChannel = {
  id: string;
  name: string;
  logo: string;
  streamUrl?: string;
  country: string;
  categories: string[];
};


export function IptvChannelPicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (channel: PickedChannel) => void;
}) {
  const { data: channels = [], isLoading, error } = useIptvOrgCatalog();
  const [q, setQ] = useState("");
  const [country, setCountry] = useState("");
  const [category, setCategory] = useState("");
  const [onlyWithStream, setOnlyWithStream] = useState(true);
  const [selected, setSelected] = useState<IptvOrgMergedChannel | null>(null);

  // Persist + restore the last selected channel id across reloads.
  const LS_KEY = "iptv-picker:last-selected-id";
  useEffect(() => {
    if (!open || selected || channels.length === 0) return;
    try {
      const id = localStorage.getItem(LS_KEY);
      if (!id) return;
      const match = channels.find((c) => c.id === id);
      if (match) setSelected(match);
    } catch {
      // ignore storage errors (private mode, quota, etc.)
    }
  }, [open, channels, selected]);

  useEffect(() => {
    if (!selected) return;
    try {
      localStorage.setItem(LS_KEY, selected.id);
    } catch {
      // ignore
    }
  }, [selected]);

  const countries = useMemo(() => {
    const set = new Set<string>();
    for (const c of channels) if (c.country) set.add(c.country);
    return Array.from(set).sort();
  }, [channels]);

  const categoryList = useMemo(() => {
    const set = new Set<string>();
    for (const c of channels) for (const k of c.categories) set.add(k);
    return Array.from(set).sort();
  }, [channels]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return channels
      .filter((c) => {
        if (onlyWithStream && !c.streamUrl) return false;
        if (country && c.country !== country) return false;
        if (category && !c.categories.includes(category)) return false;
        if (!needle) return true;
        return (
          c.name.toLowerCase().includes(needle) ||
          c.id.toLowerCase().includes(needle) ||
          (c.alt_names ?? []).some((n) => n.toLowerCase().includes(needle))
        );
      })
      .slice(0, 500);
  }, [channels, q, country, category, onlyWithStream]);


  function confirm() {
    if (!selected) return;
    onPick({
      id: selected.id,
      name: selected.name,
      logo: selected.logo,
      streamUrl: selected.streamUrl,
      country: selected.country,
      categories: selected.categories,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <Tv2 className="h-5 w-5" /> Pick a channel from iptv-org
          </DialogTitle>
          <DialogDescription>
            {channels.length
              ? `${channels.length.toLocaleString()} channels available. Click a channel to preview it on the right.`
              : "Loading free IPTV catalog…"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name or id…"
              className="w-full rounded-md border border-border bg-background pl-8 pr-3 py-2 text-sm focus:border-primary focus:outline-none"
              autoFocus
            />
          </div>
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-2 text-sm"
          >
            <option value="">All countries</option>
            {countries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-2 text-sm"
          >
            <option value="">All categories</option>
            {categoryList.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 rounded-md border border-border bg-background px-2 text-xs">
            <input
              type="checkbox"
              checked={onlyWithStream}
              onChange={(e) => setOnlyWithStream(e.target.checked)}
            />
            Playable only
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-md border border-border">
            <ScrollArea className="h-[460px]">
              {isLoading ? (
                <div className="p-6 text-sm text-muted-foreground">Loading channels…</div>
              ) : error ? (
                <div className="p-6 text-sm text-destructive">
                  {error instanceof Error ? error.message : "Failed to load catalog"}
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">No channels match.</div>
              ) : (
                <ul className="divide-y divide-border">
                  {filtered.map((c) => (
                    <ChannelRow
                      key={c.id}
                      channel={c}
                      isSelected={selected?.id === c.id}
                      onSelect={() => setSelected(c)}
                    />
                  ))}
                </ul>
              )}
            </ScrollArea>
          </div>

          <PreviewPanel channel={selected} onConfirm={confirm} />
        </div>

        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>Showing up to 500 results. Refine filters to see more.</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => {
              try {
                localStorage.removeItem(LS_KEY);
                localStorage.removeItem("hls-player:muted");
                localStorage.removeItem("hls-player:paused");
              } catch {
                // ignore
              }
              setSelected(null);
            }}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Reset saved playback
          </Button>
        </div>

      </DialogContent>
    </Dialog>
  );
}

function ChannelRow({
  channel,
  isSelected,
  onSelect,
}: {
  channel: IptvOrgMergedChannel;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={isSelected}
        className={`flex w-full items-center gap-3 p-2.5 text-left transition hover:bg-muted/40 focus:outline-none focus-visible:bg-muted/60 ${
          isSelected ? "bg-primary/10" : ""
        }`}
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
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
            <Radio className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{channel.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {channel.country}
            {channel.categories.length ? ` · ${channel.categories.join(", ")}` : ""}
            {channel.streamQuality ? ` · ${channel.streamQuality}` : ""}
          </div>
        </div>
        {!channel.streamUrl && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            no stream
          </span>
        )}
      </button>
    </li>
  );
}

function PreviewPanel({
  channel,
  onConfirm,
}: {
  channel: IptvOrgMergedChannel | null;
  onConfirm: () => void;
}) {
  return (
    <div className="flex h-[460px] flex-col overflow-hidden rounded-md border border-border">
      {channel ? (
        <HlsPlayer src={channel.streamUrl ?? null} />
      ) : (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-black text-xs text-muted-foreground">
          <Play className="h-6 w-6" />
          Click a channel to preview it here.
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-3">
        {channel ? (
          <>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                {channel.logo ? (
                  <img
                    src={channel.logo}
                    alt=""
                    className="h-full w-full object-contain"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <Radio className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{channel.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {channel.country}
                  {channel.categories.length ? ` · ${channel.categories.join(", ")}` : ""}
                  {channel.streamQuality ? ` · ${channel.streamQuality}` : ""}
                </div>
              </div>
            </div>
            {!channel.streamUrl && (
              <p className="text-xs text-muted-foreground">
                This channel has no playable stream in the catalog.
              </p>
            )}
            <Button
              className="mt-auto"
              onClick={onConfirm}
              variant={channel.streamUrl ? "default" : "outline"}
            >
              {channel.streamUrl ? "Use this channel" : "Use anyway (no stream)"}
            </Button>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Select a channel from the list to see its details and preview.
          </p>
        )}
      </div>
    </div>
  );
}

