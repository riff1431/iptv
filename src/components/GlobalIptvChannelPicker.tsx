import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Play, Radio, RotateCcw, Search, Tv2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { HlsPlayer } from "@/components/HlsPlayer";
import { useIptvPlaylist } from "@/hooks/useIptvPlaylist";
import { getPublicIptvChannelPlayback } from "@/lib/iptv-provider.functions";
import type { IptvChannel } from "@/lib/m3u-parser";

export type PickedChannel = {
  id: string;
  name: string;
  logo: string;
  streamUrl?: string;
  country: string;
  categories: string[];
};

const LAST_SELECTED_KEY = "global-iptv-picker:last-selected-id";

export function GlobalIptvChannelPicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onPick: (channel: PickedChannel) => void;
}) {
  const catalog = useIptvPlaylist(open ? "global:xtream" : "");
  const resolvePlayback = useServerFn(getPublicIptvChannelPlayback);
  const channels = catalog.data ?? [];
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [selected, setSelected] = useState<IptvChannel | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!open || selected || channels.length === 0) return;
    try {
      const savedId = localStorage.getItem(LAST_SELECTED_KEY);
      const saved = savedId ? channels.find((channel) => channel.id === savedId) : null;
      if (saved) setSelected(saved);
    } catch {
      // Storage can be unavailable in private browsing.
    }
  }, [channels, open, selected]);

  useEffect(() => {
    if (!selected) {
      setPreviewUrl(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }

    try {
      localStorage.setItem(LAST_SELECTED_KEY, selected.id);
    } catch {
      // Storage can be unavailable in private browsing.
    }

    if (selected.url) {
      setPreviewUrl(selected.url);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }

    let cancelled = false;
    setPreviewUrl(null);
    setPreviewError(null);
    setPreviewLoading(true);
    resolvePlayback({ data: { channelId: selected.id } })
      .then(({ url }) => {
        if (!cancelled) setPreviewUrl(url);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPreviewError(
          error instanceof Error ? error.message : "Could not prepare the channel preview",
        );
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [resolvePlayback, selected]);

  const groups = useMemo(
    () =>
      Array.from(
        new Set(
          channels.map((channel) => channel.group).filter((value): value is string => !!value),
        ),
      ).sort(),
    [channels],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return channels
      .filter((channel) => {
        if (group && channel.group !== group) return false;
        if (!needle) return true;
        return (
          channel.name.toLowerCase().includes(needle) ||
          channel.id.toLowerCase().includes(needle) ||
          channel.group?.toLowerCase().includes(needle)
        );
      })
      .slice(0, 500);
  }, [channels, group, query]);

  function confirmSelection() {
    if (!selected) return;
    onPick({
      id: selected.id,
      name: selected.name,
      logo: selected.logo ?? "",
      streamUrl: selected.url || undefined,
      country: "",
      categories: selected.group ? [selected.group] : [],
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <Tv2 className="h-5 w-5" /> Pick a channel from your provider
          </DialogTitle>
          <DialogDescription>
            {channels.length
              ? `${channels.length.toLocaleString()} cached provider channels available. Select one to preview securely.`
              : "Loading channels from your configured provider…"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by channel name, category, or id…"
              className="w-full rounded-md border border-border bg-background py-2 pl-8 pr-3 text-sm focus:border-primary focus:outline-none"
              autoFocus
            />
          </div>
          <select
            value={group}
            onChange={(event) => setGroup(event.target.value)}
            className="rounded-md border border-border bg-background px-2 py-2 text-sm"
          >
            <option value="">All categories</option>
            {groups.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-md border border-border">
            <ScrollArea className="h-[460px]">
              {catalog.isLoading ? (
                <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading cached provider channels…
                </div>
              ) : catalog.error ? (
                <div className="p-6 text-sm text-destructive">
                  {catalog.error instanceof Error
                    ? catalog.error.message
                    : "Failed to load provider catalog"}
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">No channels match.</div>
              ) : (
                <ul className="divide-y divide-border">
                  {filtered.map((channel) => (
                    <ChannelRow
                      key={channel.id}
                      channel={channel}
                      selected={selected?.id === channel.id}
                      onSelect={() => setSelected(channel)}
                    />
                  ))}
                </ul>
              )}
            </ScrollArea>
          </div>

          <div className="flex h-[460px] flex-col overflow-hidden rounded-md border border-border">
            {selected ? (
              previewLoading ? (
                <div className="flex aspect-video items-center justify-center gap-2 bg-black text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Preparing secure preview…
                </div>
              ) : previewError ? (
                <div className="flex aspect-video items-center justify-center bg-black p-4 text-center text-xs text-destructive">
                  {previewError}
                </div>
              ) : (
                <HlsPlayer src={previewUrl} />
              )
            ) : (
              <div className="flex aspect-video flex-col items-center justify-center gap-2 bg-black text-xs text-muted-foreground">
                <Play className="h-6 w-6" />
                Click a channel to preview it here.
              </div>
            )}

            <div className="flex flex-1 flex-col gap-2 p-3">
              {selected ? (
                <>
                  <div className="flex items-center gap-2">
                    <ChannelLogo channel={selected} className="h-8 w-8" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{selected.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {selected.group || "Uncategorized"} · id {selected.id}
                      </div>
                    </div>
                  </div>
                  <Button className="mt-auto" onClick={confirmSelection}>
                    Use this channel
                  </Button>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Select a channel from the configured provider catalog.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            Showing {filtered.length.toLocaleString()} of {channels.length.toLocaleString()}{" "}
            channels. Refine search to see more.
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => {
              try {
                localStorage.removeItem(LAST_SELECTED_KEY);
              } catch {
                // Ignore storage errors.
              }
              setSelected(null);
            }}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Reset selection
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChannelRow({
  channel,
  selected,
  onSelect,
}: {
  channel: IptvChannel;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`flex w-full items-center gap-3 p-2.5 text-left transition hover:bg-muted/40 focus:outline-none focus-visible:bg-muted/60 ${
          selected ? "bg-primary/10" : ""
        }`}
      >
        <ChannelLogo channel={channel} className="h-10 w-10" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{channel.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {channel.group || "Uncategorized"} · id {channel.id}
          </div>
        </div>
      </button>
    </li>
  );
}

function ChannelLogo({ channel, className }: { channel: IptvChannel; className: string }) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded bg-muted ${className}`}
    >
      {channel.logo ? (
        <img
          src={channel.logo}
          alt=""
          className="h-full w-full object-contain"
          loading="lazy"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : (
        <Radio className="h-4 w-4 text-muted-foreground" />
      )}
    </div>
  );
}
