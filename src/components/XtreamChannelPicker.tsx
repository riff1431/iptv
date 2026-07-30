import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import Hls from "hls.js";
import { Search, Tv2, Loader2, CheckCircle2, XCircle, Play, RotateCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  fetchIptvChannelsForTv,
  getChannelPreviewUrl,
  type IptvChannelDTO,
} from "@/lib/iptv-admin.functions";

export type XtreamPicked = {
  id: string;
  name: string;
  logo: string;
};

type PreviewStatus =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | { kind: "ready" }
  | { kind: "error"; message: string };

/**
 * Browse the channel catalog for a saved TV row (fetched server-side via
 * Xtream Codes / M3U). Clicking a row loads a live preview on the right —
 * the row is only committed after "Use this channel" is pressed.
 * Credentials never leave the server in the initial catalog fetch.
 */
export function XtreamChannelPicker({
  open,
  onOpenChange,
  tvId,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tvId: string | null;
  onPick: (channel: XtreamPicked) => void;
}) {
  const fetchChannels = useServerFn(fetchIptvChannelsForTv);
  const resolvePreview = useServerFn(getChannelPreviewUrl);
  const [loading, setLoading] = useState(false);
  const [channels, setChannels] = useState<IptvChannelDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [catalogRetryNonce, setCatalogRetryNonce] = useState(0);
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");

  const [selected, setSelected] = useState<IptvChannelDTO | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>({ kind: "idle" });
  const [retryNonce, setRetryNonce] = useState(0);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [playback, setPlayback] = useState<{
    buffering: boolean;
    bitrateKbps: number | null;
    resolution: string | null;
    levelIndex: number | null;
    levelCount: number | null;
    lastError: string | null;
  }>({
    buffering: false,
    bitrateKbps: null,
    resolution: null,
    levelIndex: null,
    levelCount: null,
    lastError: null,
  });
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  // Cache resolved preview URLs per (tvId, channelId) so switching focus
  // between already-visited channels doesn't tear down + refetch the player.
  const previewCacheRef = useRef<Map<string, string>>(new Map());

  // Reset picker state when opening a different TV.
  useEffect(() => {
    if (!open) {
      setSelected(null);
      setPreviewUrl(null);
      setPreviewStatus({ kind: "idle" });
      previewCacheRef.current.clear();
    }
  }, [open]);

  // Clear cache if the TV row changes (different provider/credentials).
  useEffect(() => {
    previewCacheRef.current.clear();
  }, [tvId]);

  useEffect(() => {
    if (!open || !tvId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchChannels({ data: { tvId } })
      .then((rows) => {
        if (cancelled) return;
        setChannels(rows);
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Failed to load channels";
        setError(msg);
        toast.error(`Provider load failed: ${msg}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, tvId, fetchChannels, catalogRetryNonce]);

  // Resolve preview URL whenever the selection changes.
  useEffect(() => {
    if (!open || !selected || !tvId) return;
    const cacheKey = `${tvId}::${selected.id}`;
    const cached = previewCacheRef.current.get(cacheKey);
    if (cached) {
      // Reuse the previously-resolved URL. The HLS attach effect keys on
      // previewUrl, so setting the same string is a no-op and the player
      // keeps playing.
      setPreviewUrl(cached);
      setPreviewStatus((s) =>
        s.kind === "ready" ? s : { kind: "loading", message: "Connecting to stream…" },
      );
      return;
    }
    let cancelled = false;
    setPreviewUrl(null);
    setPreviewStatus({ kind: "loading", message: "Resolving preview URL…" });
    resolvePreview({ data: { tvId, channelId: selected.id } })
      .then(({ url }) => {
        if (cancelled) return;
        previewCacheRef.current.set(cacheKey, url);
        setPreviewUrl(url);
        setPreviewStatus({ kind: "loading", message: "Connecting to stream…" });
      })
      .catch((e) => {
        if (cancelled) return;
        setPreviewStatus({
          kind: "error",
          message: e instanceof Error ? e.message : "Failed to resolve preview URL",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [open, selected, tvId, resolvePreview, retryNonce]);

  // Attach HLS whenever previewUrl changes.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !previewUrl) return;
    let cancelled = false;
    let mediaRecoverCount = 0;
    let lastMediaRecoverAt = 0;

    // Belt-and-braces: HLS.js requires muted+playsInline for autoplay.
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;

    setPlayback({
      buffering: true,
      bitrateKbps: null,
      resolution: null,
      levelIndex: null,
      levelCount: null,
      lastError: null,
    });
    setAutoplayBlocked(false);

    const tryPlay = () => {
      const p = video.play();
      if (!p || typeof p.then !== "function") return;
      p.then(() => {
        if (cancelled) return;
        console.info("[xtream-preview] autoplay:success", { initiated: "auto" });
        setAutoplayBlocked(false);
      }).catch((err: unknown) => {
        if (cancelled) return;
        const name = (err as { name?: string } | null)?.name;
        // NotAllowedError = browser autoplay policy. Show click-to-play.
        if (name === "NotAllowedError" || name === "AbortError") {
          console.warn("[xtream-preview] autoplay:blocked", { reason: name });
          setAutoplayBlocked(true);
          setPreviewStatus({
            kind: "error",
            message: "Your browser blocked autoplay. Click the play button on the video to start.",
          });
          setPlayback((s) => ({
            ...s,
            buffering: false,
            lastError: `Autoplay blocked (${name})`,
          }));
        }
      });
    };

    const onCanPlay = () => {
      if (cancelled) return;
      setPreviewStatus({ kind: "ready" });
      setPlayback((p) => ({ ...p, buffering: false }));
      tryPlay();
    };
    const onWaiting = () => {
      if (cancelled) return;
      setPlayback((p) => ({ ...p, buffering: true }));
    };
    const onPlaying = () => {
      if (cancelled) return;
      setAutoplayBlocked(false);
      setPreviewStatus({ kind: "ready" });
      setPlayback((p) => ({ ...p, buffering: false }));
    };
    const onError = () => {
      if (cancelled) return;
      const err = video.error;
      const msg = err
        ? `MediaError ${err.code}${err.message ? `: ${err.message}` : ""}`
        : "Playback failed — the stream may be offline or blocked.";
      setPreviewStatus({ kind: "error", message: msg });
      setPlayback((p) => ({ ...p, buffering: false, lastError: msg }));
    };

    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("error", onError);

    const isHls = /\.m3u8(\?|$)/i.test(previewUrl);
    if (isHls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hlsRef.current = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
        if (cancelled) return;
        setPreviewStatus({ kind: "ready" });
        setPlayback((p) => ({ ...p, levelCount: data.levels?.length ?? null }));
        tryPlay();
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
        if (cancelled) return;
        const level = hls.levels?.[data.level];
        if (!level) return;
        setPlayback((p) => ({
          ...p,
          levelIndex: data.level,
          levelCount: hls.levels.length,
          bitrateKbps: level.bitrate ? Math.round(level.bitrate / 1000) : null,
          resolution: level.width && level.height ? `${level.width}×${level.height}` : null,
        }));
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (cancelled) return;
        const detail = `${data.details ?? data.type}`;
        setPlayback((p) => ({ ...p, lastError: detail }));
        if (!data.fatal) return;

        // Fatal — try to recover per hls.js recommended pattern before giving up.
        // https://github.com/video-dev/hls.js/blob/master/docs/API.md#fatal-error-recovery
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          setPreviewStatus({
            kind: "loading",
            message: `Network error (${detail}) — retrying…`,
          });
          try {
            hls.startLoad();
            return;
          } catch {
            /* fall through */
          }
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          const now = Date.now();
          mediaRecoverCount = now - lastMediaRecoverAt > 3000 ? 1 : mediaRecoverCount + 1;
          lastMediaRecoverAt = now;
          if (mediaRecoverCount <= 2) {
            setPreviewStatus({
              kind: "loading",
              message: `Media error (${detail}) — recovering…`,
            });
            try {
              if (mediaRecoverCount === 2) hls.swapAudioCodec();
              hls.recoverMediaError();
              return;
            } catch {
              /* fall through */
            }
          }
        }

        setPreviewStatus({ kind: "error", message: `Stream error: ${detail}` });
        setPlayback((p) => ({ ...p, buffering: false }));
      });
      hls.loadSource(previewUrl);
      hls.attachMedia(video);
    } else {
      // Native HLS (Safari) or progressive.
      video.src = previewUrl;
      video.load();
      tryPlay();
    }

    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      setPreviewStatus((s) =>
        s.kind === "loading" ? { kind: "error", message: "Timed out waiting for stream." } : s,
      );
    }, 15000);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("error", onError);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.removeAttribute("src");
      video.load();
    };
  }, [previewUrl]);

  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const c of channels) if (c.group) set.add(c.group);
    return Array.from(set).sort();
  }, [channels]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return channels
      .filter((c) => {
        if (group && c.group !== group) return false;
        if (!needle) return true;
        return c.name.toLowerCase().includes(needle) || c.id.toLowerCase().includes(needle);
      })
      .slice(0, 500);
  }, [channels, q, group]);

  function confirmSelection() {
    if (!selected) return;
    onPick({ id: selected.id, name: selected.name, logo: selected.logo ?? "" });
    onOpenChange(false);
  }

  const handleUserPlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    console.info("[xtream-preview] user-play:click", {
      wasAutoplayBlocked: autoplayBlocked,
    });
    // Ensure the video is muted and inline so the user gesture is allowed.
    video.muted = true;
    video.playsInline = true;
    // If the HLS instance is attached but stalled, nudge it to start loading.
    const hls = hlsRef.current;
    if (hls && hls.media === video) {
      try {
        hls.startLoad();
      } catch {
        /* ignore */
      }
    }
    const promise = video.play();
    if (!promise || typeof promise.then !== "function") return;
    promise
      .then(() => {
        console.info("[xtream-preview] user-play:success");
        setAutoplayBlocked(false);
        setPreviewStatus({ kind: "ready" });
        setPlayback((s) => ({ ...s, lastError: null }));
      })
      .catch((err: unknown) => {
        const name = (err as { name?: string } | null)?.name;
        if (name === "NotAllowedError" || name === "AbortError") {
          console.warn("[xtream-preview] user-play:blocked", { reason: name });
          setAutoplayBlocked(true);
          setPlayback((s) => ({ ...s, lastError: `Autoplay blocked (${name})` }));
        } else {
          const message = err instanceof Error ? err.message : "Playback failed";
          console.error("[xtream-preview] user-play:error", { message });
          setPreviewStatus({ kind: "error", message });
          setPlayback((s) => ({ ...s, lastError: message }));
        }
      });
  }, [autoplayBlocked]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Pick a channel from your provider</DialogTitle>
          <DialogDescription>
            Click a channel to preview it on the right, then confirm to save. Credentials never
            leave the server.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search channel name or id…"
              className="w-full rounded-md border border-arena-border bg-arena-panel-2/60 py-2 pl-8 pr-3 text-sm"
            />
          </div>
          <select
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            className="rounded-md border border-arena-border bg-arena-panel-2/60 px-3 py-2 text-sm"
          >
            <option value="">All categories</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <div className="text-xs text-muted-foreground">
            {loading ? "Loading…" : `${filtered.length} / ${channels.length}`}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* Left: channel list */}
          <ScrollArea className="h-[520px] rounded-md border border-arena-border">
            {loading ? (
              <div className="flex h-full items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Fetching channels from provider…
              </div>
            ) : error ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                <div className="text-sm text-destructive">{error}</div>
                <Button
                  size="sm"
                  variant="arenaOutline"
                  onClick={() => setCatalogRetryNonce((value) => value + 1)}
                >
                  <RotateCw className="mr-1 h-3.5 w-3.5" />
                  Retry provider
                </Button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No channels match your search.
              </div>
            ) : (
              <ul className="divide-y divide-arena-border">
                {filtered.map((c) => {
                  const active = selected?.id === c.id;
                  return (
                    <li
                      key={c.id}
                      className={`flex items-center gap-3 p-2 cursor-pointer transition-colors ${
                        active
                          ? "bg-arena-violet/15 border-l-2 border-arena-violet"
                          : "hover:bg-arena-panel-2/40 border-l-2 border-transparent"
                      }`}
                      data-testid="xtream-channel-row"
                      onClick={() => setSelected(c)}
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-arena-panel-2">
                        {c.logo ? (
                          <img
                            src={c.logo}
                            alt=""
                            className="h-full w-full object-contain"
                            onError={(e) =>
                              ((e.currentTarget as HTMLImageElement).style.display = "none")
                            }
                          />
                        ) : (
                          <Tv2 className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{c.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {c.group || "—"} · id {c.id}
                        </div>
                      </div>
                      {active && (
                        <Play className="h-4 w-4 shrink-0 text-arena-violet" aria-hidden />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </ScrollArea>

          {/* Right: preview panel */}
          <div className="flex h-[520px] flex-col gap-3 rounded-md border border-arena-border bg-arena-panel-2/30 p-3">
            {!selected ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                <Tv2 className="h-8 w-8" aria-hidden />
                <div>Click a channel to preview it here.</div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-arena-panel-2">
                    {selected.logo ? (
                      <img
                        src={selected.logo}
                        alt=""
                        className="h-full w-full object-contain"
                        onError={(e) =>
                          ((e.currentTarget as HTMLImageElement).style.display = "none")
                        }
                      />
                    ) : (
                      <Tv2 className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{selected.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {selected.group || "—"} · id {selected.id}
                    </div>
                  </div>
                </div>

                <div className="relative overflow-hidden rounded-md border border-arena-border bg-black">
                  <video
                    ref={videoRef}
                    controls
                    muted
                    autoPlay
                    playsInline
                    className="aspect-video w-full bg-black"
                    data-testid="xtream-preview-video"
                  />
                  {autoplayBlocked && (
                    <button
                      type="button"
                      onClick={handleUserPlay}
                      className="absolute inset-0 flex flex-col cursor-pointer items-center justify-center gap-2 bg-black/70 text-white transition hover:bg-black/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                      data-testid="xtream-preview-unmute-play"
                      aria-label="Browser blocked autoplay — click to start playback"
                    >
                      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 backdrop-blur">
                        <Play className="h-7 w-7" aria-hidden />
                      </span>
                      <span className="max-w-[80%] text-center text-xs">
                        Your browser blocked autoplay. Click to start playback.
                      </span>
                    </button>
                  )}
                </div>

                <div
                  className={`flex items-start gap-2 rounded-md border p-2 text-xs ${
                    previewStatus.kind === "ready"
                      ? "border-success/40 bg-success/10 text-success"
                      : previewStatus.kind === "error"
                        ? "border-destructive/40 bg-destructive/10 text-destructive"
                        : "border-arena-border bg-arena-panel-2/60 text-muted-foreground"
                  }`}
                  role="status"
                  aria-live="polite"
                >
                  {previewStatus.kind === "loading" ? (
                    <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
                  ) : previewStatus.kind === "ready" ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  ) : previewStatus.kind === "error" ? (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  ) : null}
                  <span className="flex-1">
                    {previewStatus.kind === "loading"
                      ? previewStatus.message
                      : previewStatus.kind === "ready"
                        ? "Stream is playing — confirm to save this channel."
                        : previewStatus.kind === "error"
                          ? previewStatus.message
                          : ""}
                  </span>
                  {previewStatus.kind === "error" && (
                    <button
                      type="button"
                      onClick={() => {
                        if (selected && tvId) {
                          previewCacheRef.current.delete(`${tvId}::${selected.id}`);
                        }
                        setRetryNonce((n) => n + 1);
                      }}
                      className="inline-flex shrink-0 items-center gap-1 rounded border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive hover:bg-destructive/20"
                      data-testid="xtream-preview-retry"
                      aria-label="Retry preview"
                    >
                      <RotateCw className="h-3 w-3" aria-hidden />
                      Retry
                    </button>
                  )}
                </div>

                <dl
                  className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md border border-arena-border bg-arena-panel-2/40 p-2 text-[11px]"
                  data-testid="xtream-preview-stats"
                  aria-label="Playback stats"
                >
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">Buffering</dt>
                    <dd className="font-medium">
                      {playback.buffering ? (
                        <span className="inline-flex items-center gap-1 text-warning">
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                          Yes
                        </span>
                      ) : (
                        <span className="text-muted-foreground">No</span>
                      )}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">Bitrate</dt>
                    <dd className="font-medium">
                      {playback.bitrateKbps != null
                        ? `${playback.bitrateKbps.toLocaleString()} kbps`
                        : "—"}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">Resolution</dt>
                    <dd className="font-medium">{playback.resolution ?? "—"}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">Level</dt>
                    <dd className="font-medium">
                      {playback.levelIndex != null && playback.levelCount != null
                        ? `${playback.levelIndex + 1} / ${playback.levelCount}`
                        : playback.levelCount != null
                          ? `— / ${playback.levelCount}`
                          : "—"}
                    </dd>
                  </div>
                  {playback.lastError && (
                    <div className="col-span-2 flex items-start justify-between gap-2 border-t border-arena-border pt-1">
                      <dt className="text-muted-foreground">Last error</dt>
                      <dd
                        className="max-w-[70%] truncate text-right font-medium text-destructive"
                        title={playback.lastError}
                      >
                        {playback.lastError}
                      </dd>
                    </div>
                  )}
                </dl>

                <div className="mt-auto flex items-center justify-end gap-2">
                  <Button size="sm" variant="arenaOutline" onClick={() => setSelected(null)}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={confirmSelection} data-testid="xtream-confirm-channel">
                    Use this channel
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
