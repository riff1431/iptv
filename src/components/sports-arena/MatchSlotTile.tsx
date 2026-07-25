import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import Hls from "hls.js";
import {
  Maximize2,
  Volume2,
  VolumeX,
  RotateCcw,
  Tv as TvIcon,
  AlertTriangle,
  Loader2,
  Settings2,
  Activity,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { trackStreamEvent } from "@/lib/stream-analytics";


export type MatchSlotTileProps = {
  slot: number;
  channelName: string | null;
  channelLogo: string | null;
  /** Resolved HLS/stream URL for this slot's channel; null if unresolved. */
  url: string | null;
  /** True while the parent playlist is still loading. */
  loadingPlaylist?: boolean;
  /** True when the parent could not load the playlist at all. */
  playlistError?: string | null;
  /** True when the slot is configured but the channel isn't in the playlist. */
  channelMissing?: boolean;
  /** True when the slot has no channel_id assigned. */
  notConfigured?: boolean;
  /** Optional link to the slot editor shown only when the slot is not configured. */
  configureTo?: { to: string; search?: Record<string, unknown> };
  /** Active provider type label, e.g. "M3U", "Xtream", or "Demo playlist". */
  providerType?: string | null;
  /** Active playlist name shown to confirm the source. */
  playlistName?: string | null;
  active: boolean;
  onActivate: () => void;
  /** Bumping this value forces the tile to re-attempt playback. */
  reloadKey?: number;
  /** Fires whenever this tile's derived health changes. */
  onHealthChange?: (slot: number, health: SlotHealth) => void;
};

/** Public health rollup emitted by MatchSlotTile via onHealthChange. */
export type SlotHealth = "unknown" | "healthy" | "degraded" | "unavailable";


/**
 * Single tile for a match's channel slot. Reuses the arena 2x2 look:
 * only the active tile is unmuted; all others stay muted and autoplay.
 */
export function MatchSlotTile({
  slot,
  channelName,
  channelLogo,
  url,
  loadingPlaylist,
  playlistError,
  channelMissing,
  notConfigured,
  configureTo,
  providerType,
  playlistName,
  active,
  onActivate,
  reloadKey = 0,
  onHealthChange,
}: MatchSlotTileProps) {

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [buffering, setBuffering] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [hlsAutoRetries, setHlsAutoRetries] = useState(0);
  /** Consecutive warm-up timeouts; drives exponential backoff. Reset on playing. */
  const [warmupFailures, setWarmupFailures] = useState(0);
  /** Seconds remaining before the next automatic retry; null = no pending retry. */
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null);
  /**
   * Progress phase across a single playback attempt. Advances only forward
   * so late events (e.g. `waiting` after `playing`) don't downgrade the UI.
   *   idle       — waiting for URL / no attempt yet
   *   attaching  — hls attached / native src set, nothing back from server
   *   manifest   — HLS MANIFEST_PARSED (variant playlist loaded)
   *   canplay    — enough data buffered to start
   *   playing    — first frame actually rendered
   */
  type PlaybackPhase = "idle" | "attaching" | "manifest" | "canplay" | "playing";
  const PHASE_ORDER: PlaybackPhase[] = ["idle", "attaching", "manifest", "canplay", "playing"];
  const [phase, setPhase] = useState<PlaybackPhase>("idle");
  const MAX_HLS_AUTO_RETRIES = 3;
  const MAX_WARMUP_AUTO_RETRIES = 4;
  const WARMUP_TIMEOUT_MS = 15_000;
  const HEALTH_WINDOW_MS = 60_000;
  /** Exponential backoff: 2s, 4s, 8s, 16s, capped at 30s. */
  const backoffSeconds = (failures: number) =>
    Math.min(30, Math.max(2, Math.pow(2, Math.max(1, failures))));

  // Rolling counters that feed the health indicator. Refs (mutated by media
  // listeners) + a tick to re-render the derived label on a schedule.
  const errorTimestampsRef = useRef<number[]>([]);
  const rebufferTimestampsRef = useRef<number[]>([]);
  const [, setHealthTick] = useState(0);
  const bumpHealth = () => setHealthTick((n) => (n + 1) % 1_000_000);
  const recordHealthEvent = (
    bucket: "error" | "rebuffer",
    ts: number = Date.now(),
  ) => {
    const arr = bucket === "error" ? errorTimestampsRef.current : rebufferTimestampsRef.current;
    arr.push(ts);
    const cutoff = ts - HEALTH_WINDOW_MS;
    while (arr.length && arr[0] < cutoff) arr.shift();
    bumpHealth();
  };




  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;
    setError(null);
    setErrorDetail(null);
    setLoading(true);
    setBuffering(false);
    setHlsAutoRetries(0);
    setPhase("attaching");

    // Monotonic phase advance — never downgrade (e.g. `waiting` after `playing`
    // must not knock us back to `canplay`).
    const advancePhase = (next: PlaybackPhase) => {
      if (destroyed) return;
      setPhase((cur) => {
        if (PHASE_ORDER.indexOf(next) <= PHASE_ORDER.indexOf(cur)) return cur;
        trackStreamEvent("stream_phase", {
          slot,
          channelName,
          url,
          attempt,
          phase: next,
          fromPhase: cur,
          durationMs: Math.round(performance.now() - startedAt),
        });
        return next;
      });
    };

    const startedAt = performance.now();
    const isRetry = attempt > 0;
    let destroyed = false;
    let succeeded = false;
    const isHls = /\.m3u8($|\?)/i.test(url);

    trackStreamEvent("stream_start_attempt", {
      slot,
      channelName,
      url,
      attempt,
      isRetry,
    });

    const reportSuccess = () => {
      if (succeeded || destroyed) return;
      succeeded = true;
      const durationMs = Math.round(performance.now() - startedAt);
      trackStreamEvent("stream_start_success", { slot, channelName, url, attempt, durationMs });
      if (isRetry) {
        trackStreamEvent("stream_retry_success", { slot, channelName, url, attempt, durationMs });
      }
    };

    const reportFailure = (errorType: string, errorDetails: string, fatal = true) => {
      if (succeeded || destroyed) return;
      const durationMs = Math.round(performance.now() - startedAt);
      trackStreamEvent("stream_start_failure", {
        slot,
        channelName,
        url,
        attempt,
        errorType,
        errorDetails,
        fatal,
        durationMs,
      });
      if (isRetry) {
        trackStreamEvent("stream_retry_failure", {
          slot,
          channelName,
          url,
          attempt,
          errorType,
          errorDetails,
          durationMs,
        });
      }
    };

    let warmupTimer: ReturnType<typeof setTimeout> | null = null;
    const clearWarmup = () => {
      if (warmupTimer !== null) {
        clearTimeout(warmupTimer);
        warmupTimer = null;
      }
    };
    const triggerWarmupTimeout = () => {
      if (destroyed || succeeded) return;
      setWarmupFailures((n) => n + 1);
      setError("Stream is taking too long");
      setErrorDetail("No response after 15 seconds.");
      setLoading(false);
      setBuffering(false);
      reportFailure("warmup_timeout", `no media events within ${WARMUP_TIMEOUT_MS}ms`, true);
    };
    warmupTimer = setTimeout(triggerWarmupTimeout, WARMUP_TIMEOUT_MS);

    let hasStartedPlaying = false;
    const onWaiting = () => {
      if (destroyed) return;
      setBuffering(true);
      // Only count rebuffers that happen after playback actually started —
      // pre-roll "waiting" is expected and shouldn't flag a healthy stream.
      if (hasStartedPlaying) recordHealthEvent("rebuffer");
    };
    const onCanPlayEvt = () => advancePhase("canplay");
    const onPlaying = () => {
      if (!destroyed) {
        hasStartedPlaying = true;
        advancePhase("playing");
        clearWarmup();
        setBuffering(false);
        setLoading(false);
        // Successful playback — clear backoff so the next failure starts fresh.
        setWarmupFailures(0);
        reportSuccess();
        bumpHealth();
      }
    };

    video.addEventListener("canplay", onCanPlayEvt);
    const onStalled = () => {
      if (destroyed) return;
      setBuffering(true);
      if (hasStartedPlaying) recordHealthEvent("rebuffer");
    };
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("stalled", onStalled);
    video.addEventListener("playing", onPlaying);


    let cleanupNative: (() => void) | null = null;

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        liveDurationInfinity: true,
        lowLatencyMode: false,
        maxBufferLength: 20,
      });
      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (destroyed) return;
        advancePhase("manifest");
        setLoading(false);
        void video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        // Every error (fatal or not) feeds the health window so a stream
        // that recovers but is flaky still shows as Degraded.
        recordHealthEvent("error");
        if (!data.fatal) return;

        if (
          data.type === Hls.ErrorTypes.NETWORK_ERROR ||
          data.type === Hls.ErrorTypes.MEDIA_ERROR
        ) {
          setHlsAutoRetries((count) => {
            const next = count + 1;
            if (next > MAX_HLS_AUTO_RETRIES) {
              clearWarmup();
              setError("Stream failed to start");
              setErrorDetail("This channel isn't loading right now. Try again in a moment.");
              setLoading(false);
              setBuffering(false);
              reportFailure(data.type, data.details || "auto-retries exhausted", true);
              return next;
            }
            setBuffering(true);
            setErrorDetail(
              data.type === Hls.ErrorTypes.NETWORK_ERROR ? "Reconnecting…" : "Recovering media…",
            );
            trackStreamEvent("stream_auto_retry", {
              slot,
              channelName,
              url,
              attempt,
              autoRetries: next,
              errorType: data.type,
              errorDetails: data.details,
            });
            // Reset the warm-up window so an auto-retry gets a fresh 15s to
            // succeed instead of inheriting whatever's left from the first try.
            clearWarmup();
            warmupTimer = setTimeout(triggerWarmupTimeout, WARMUP_TIMEOUT_MS);
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              hls.startLoad();
            } else {
              hls.recoverMediaError();
            }
            return next;
          });
        } else {
          clearWarmup();
          setError("Stream error");
          setErrorDetail(data.details || "This stream can't be played at the moment.");
          setLoading(false);
          setBuffering(false);
          reportFailure(data.type, data.details || "fatal hls error", true);
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl") || !isHls) {
      video.src = url;
      const onCanPlay = () => setLoading(false);
      const onErr = () => {
        clearWarmup();
        setError("Stream failed");
        setErrorDetail("The source could not be played");
        setLoading(false);
        setBuffering(false);
        reportFailure("native_media_error", video.error?.message || "video element error", true);
      };
      video.addEventListener("canplay", onCanPlay);
      video.addEventListener("error", onErr);
      void video.play().catch(() => {});
      cleanupNative = () => {
        video.removeEventListener("canplay", onCanPlay);
        video.removeEventListener("error", onErr);
        video.removeAttribute("src");
        video.load();
      };
    } else {
      clearWarmup();
      setError("HLS not supported");
      setErrorDetail("This browser can't play HLS streams");
      setLoading(false);
      reportFailure("hls_unsupported", "browser cannot play HLS", true);
    }

    return () => {
      destroyed = true;
      clearWarmup();
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("stalled", onStalled);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("canplay", onCanPlayEvt);
      cleanupNative?.();
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [url, attempt, reloadKey, slot, channelName]);

  // Active-audio: only the active tile is unmuted.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !active;
    if (active) void v.play().catch(() => {});
  }, [active]);

  const isWarmupError = error === "Stream is taking too long";
  const canAutoRetry = isWarmupError && warmupFailures <= MAX_WARMUP_AUTO_RETRIES;

  // Exponential-backoff auto-retry after a warm-up timeout. Countdown ticks
  // once per second and a "Try now" button lets the user skip the wait.
  useEffect(() => {
    if (!canAutoRetry) {
      setRetryCountdown(null);
      return;
    }
    const delay = backoffSeconds(warmupFailures);
    setRetryCountdown(delay);
    trackStreamEvent("stream_backoff_scheduled", {
      slot,
      channelName,
      url,
      attempt,
      warmupFailures,
      backoffSeconds: delay,
    });
    const tick = setInterval(() => {
      setRetryCountdown((s) => (s === null ? null : Math.max(0, s - 1)));
    }, 1000);
    const fire = setTimeout(() => {
      trackStreamEvent("stream_backoff_retry", {
        slot,
        channelName,
        url,
        attempt: attempt + 1,
        warmupFailures,
      });
      setHlsAutoRetries(0);
      setAttempt((n) => n + 1);
    }, delay * 1000);
    return () => {
      clearInterval(tick);
      clearTimeout(fire);
    };
  }, [canAutoRetry, warmupFailures, attempt, slot, channelName, url]);

  // Slide the health window forward: re-render every 5s so aged-out events
  // stop counting even when nothing new is happening.
  useEffect(() => {
    if (!url) return;
    const id = setInterval(() => {
      const cutoff = Date.now() - HEALTH_WINDOW_MS;
      const err = errorTimestampsRef.current;
      const reb = rebufferTimestampsRef.current;
      let changed = false;
      while (err.length && err[0] < cutoff) {
        err.shift();
        changed = true;
      }
      while (reb.length && reb[0] < cutoff) {
        reb.shift();
        changed = true;
      }
      if (changed) bumpHealth();
    }, 5000);
    return () => clearInterval(id);
  }, [url]);



  async function toggleFullscreen(e: React.MouseEvent) {
    e.stopPropagation();
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      await document.exitFullscreen().catch(() => {});
    } else {
      await el.requestFullscreen().catch(() => {});
    }
  }

  const placeholder = !url;
  const showError = !!error || !!playlistError || channelMissing;
  const showBufferingOverlay = !placeholder && !showError && !loading && buffering;

  // Compact status descriptor shown as a per-tile badge so operators can
  // immediately see where a stream is stuck without opening devtools.
  type StatusTone = "neutral" | "info" | "warn" | "error" | "ok";
  const status: { label: string; tone: StatusTone; dot: string } = notConfigured
    ? { label: "Not configured", tone: "neutral", dot: "bg-white/40" }
    : loadingPlaylist
      ? { label: "Resolving", tone: "info", dot: "bg-sky-400 animate-pulse" }
      : playlistError
        ? { label: "Playlist error", tone: "error", dot: "bg-live" }
        : channelMissing
          ? { label: "Channel missing", tone: "warn", dot: "bg-amber-400" }
          : placeholder
            ? { label: "No channel", tone: "neutral", dot: "bg-white/40" }
            : error
              ? { label: "Error", tone: "error", dot: "bg-live" }
              : buffering
                ? { label: "Buffering", tone: "warn", dot: "bg-amber-400 animate-pulse" }
                : phase === "playing"
                  ? { label: "Playing", tone: "ok", dot: "bg-emerald-400" }
                  : phase === "canplay"
                    ? { label: "Ready", tone: "info", dot: "bg-sky-400 animate-pulse" }
                    : phase === "manifest"
                      ? { label: "Manifest parsed", tone: "info", dot: "bg-sky-400 animate-pulse" }
                      : phase === "attaching"
                        ? { label: "Attaching", tone: "info", dot: "bg-sky-400 animate-pulse" }
                        : { label: "Idle", tone: "neutral", dot: "bg-white/40" };
  const statusToneClass: Record<StatusTone, string> = {
    neutral: "bg-black/70 text-white/80",
    info: "bg-sky-500/25 text-sky-100 ring-1 ring-inset ring-sky-400/40",
    warn: "bg-amber-500/25 text-amber-100 ring-1 ring-inset ring-amber-400/40",
    error: "bg-live/25 text-white ring-1 ring-inset ring-live/50",
    ok: "bg-emerald-500/25 text-emerald-100 ring-1 ring-inset ring-emerald-400/40",
  };

  // Health rollup — combines the current error state with the rolling
  // 60s window of HLS errors and post-play rebuffers.
  //   Unavailable → fatal error is currently displayed
  //   Degraded    → playing, but errors/rebuffers crossed thresholds, OR
  //                 warm-up has already timed out at least once this session
  //   Healthy     → playing cleanly with no recent hiccups
  //   Unknown     → not playing yet (attaching/manifest/ready/idle)
  type Health = SlotHealth;
  const recentErrors = errorTimestampsRef.current.length;
  const recentRebuffers = rebufferTimestampsRef.current.length;
  const health: Health = showError
    ? "unavailable"
    : phase !== "playing"
      ? "unknown"
      : recentErrors >= 3 || recentRebuffers >= 3 || warmupFailures > 0
        ? "degraded"
        : recentErrors > 0 || recentRebuffers > 1 || buffering
          ? "degraded"
          : "healthy";
  const healthMeta: Record<
    Health,
    { label: string; tone: StatusTone; dot: string; hint: string }
  > = {
    healthy: {
      label: "Healthy",
      tone: "ok",
      dot: "bg-emerald-400",
      hint: "No errors or rebuffers in the last 60s.",
    },
    degraded: {
      label: "Degraded",
      tone: "warn",
      dot: "bg-amber-400 animate-pulse",
      hint: `Last 60s: ${recentErrors} error${recentErrors === 1 ? "" : "s"}, ${recentRebuffers} rebuffer${recentRebuffers === 1 ? "" : "s"}${warmupFailures > 0 ? `, ${warmupFailures} warm-up timeout${warmupFailures === 1 ? "" : "s"}` : ""}.`,
    },
    unavailable: {
      label: "Unavailable",
      tone: "error",
      dot: "bg-live",
      hint: "Stream is not currently playing.",
    },
    unknown: {
      label: "Warming up",
      tone: "info",
      dot: "bg-sky-400 animate-pulse",
      hint: "Waiting for first frame.",
    },
  };
  const healthInfo = healthMeta[health];

  // Report health up to the grid so it can compute the aggregate summary.
  useEffect(() => {
    onHealthChange?.(slot, health);
  }, [health, slot, onHealthChange]);



  // User-friendly copy per progress milestone. Shown inside the loading overlay
  // so viewers see "we're getting somewhere" instead of an indefinite spinner.
  const phaseMessage: { title: string; hint: string } = loadingPlaylist
    ? { title: "Resolving channel", hint: "Fetching the playlist source" }
    : phase === "playing"
      ? { title: "Starting playback", hint: "First frame incoming" }
      : phase === "canplay"
        ? { title: "Buffering first frame", hint: "Enough data — pressing play" }
        : phase === "manifest"
          ? { title: "Manifest parsed", hint: "Downloading video segments" }
          : phase === "attaching"
            ? { title: "Attaching to stream", hint: "Reaching the channel source" }
            : { title: "Preparing tile", hint: "Waking things up" };

  // Ordered progress steps rendered as a mini stepper inside the loading
  // skeleton so operators can see exactly which milestone is next.
  const LOADING_STEPS: { key: PlaybackPhase; label: string }[] = [
    { key: "attaching", label: "Attach" },
    { key: "manifest", label: "Manifest" },
    { key: "canplay", label: "Ready" },
    { key: "playing", label: "Playing" },
  ];
  const activePhaseIndex = PHASE_ORDER.indexOf(phase);



  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            ref={containerRef}
            onClick={onActivate}
            role="button"
            tabIndex={0}
            aria-label={`Slot ${slot}${channelName ? ` — ${channelName}` : ""}${active ? " — audio active" : ""}`}
            aria-pressed={active}
            aria-busy={loading || buffering || !!loadingPlaylist}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onActivate();
              }
            }}
            className={`group relative aspect-video cursor-pointer overflow-hidden rounded-2xl border bg-black transition focus:outline-none focus-visible:ring-2 focus-visible:ring-arena-violet ${
              active
                ? "border-arena-violet shadow-[0_0_40px_-8px_var(--arena-violet)]"
                : "border-arena-border hover:border-white/25"
            }`}
          >
            {channelLogo && (
              <img
                src={channelLogo}
                alt=""
                className={`pointer-events-none absolute inset-0 h-full w-full object-contain p-8 opacity-30 transition-opacity duration-300 ${
                  !loading && !error && !placeholder ? "!opacity-0" : ""
                }`}
              />
            )}

            {!placeholder && (
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="absolute inset-0 h-full w-full object-contain bg-black"
              />
            )}

            {(placeholder || loading || showError) && (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-black/50 via-black/60 to-black/85 text-center">
                <div className="max-w-[80%]">
                  {placeholder && !loadingPlaylist && !playlistError ? (
                    <>
                      <TvIcon className="mx-auto h-6 w-6 text-muted-foreground" />
                      <div className="mt-2 text-xs uppercase tracking-widest text-muted-foreground">
                        {notConfigured
                          ? `Slot ${slot} — not configured`
                          : `Slot ${slot} — no channel`}
                      </div>
                      {notConfigured ? (
                        <>
                          <div className="mt-1 text-[11px] text-white/50">No channel assigned</div>
                          {configureTo && (
                            <Link
                              {...configureTo}
                              onClick={(e) => e.stopPropagation()}
                              className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-arena-violet px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-arena-violet/80"
                            >
                              <Settings2 className="h-3 w-3" /> Configure streaming
                            </Link>
                          )}
                        </>
                      ) : (
                        <div className="mt-1 text-[11px] text-white/50">
                          {channelName ? `Waiting for “${channelName}”` : "Channel not resolved"}
                        </div>
                      )}
                    </>
                  ) : channelMissing ? (
                    <>
                      <AlertTriangle className="mx-auto h-6 w-6 text-amber-400" />
                      <div className="mt-2 text-xs uppercase tracking-widest text-muted-foreground">
                        Channel unavailable
                      </div>
                      <div className="mt-1 text-[11px] text-white/70">
                        {channelName
                          ? `“${channelName}” isn't in the current playlist`
                          : "Not in the current playlist"}
                      </div>
                    </>
                  ) : playlistError ? (
                    <>
                      <AlertTriangle className="mx-auto h-6 w-6 text-amber-400" />
                      <div className="mt-2 text-xs font-semibold text-live">Playlist error</div>
                      <div className="mt-1 text-[11px] text-white/70">{playlistError}</div>
                    </>
                  ) : error ? (
                    <>
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-live/10">
                        <AlertTriangle className="h-6 w-6 text-live" />
                      </div>
                      <div className="mt-3 text-xs font-semibold text-live">{error}</div>
                      {errorDetail && (
                        <div className="mt-1 text-[11px] text-white/60">{errorDetail}</div>
                      )}
                      {isWarmupError && retryCountdown !== null && retryCountdown > 0 && (
                        <div
                          className="mt-2 text-[11px] text-white/70"
                          role="status"
                          aria-live="polite"
                        >
                          Retrying automatically in{" "}
                          <span className="font-bold text-white">{retryCountdown}s</span>
                          <span className="text-white/40">
                            {" "}
                            (attempt {warmupFailures + 1}/{MAX_WARMUP_AUTO_RETRIES + 1})
                          </span>
                        </div>
                      )}
                      {isWarmupError && !canAutoRetry && (
                        <div className="mt-2 text-[11px] text-white/50">
                          Auto-retry gave up after {warmupFailures} attempts.
                        </div>
                      )}
                      <div className="mt-4 flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            trackStreamEvent("stream_retry_click", {
                              slot,
                              channelName,
                              url,
                              attempt: attempt + 1,
                              errorType: error ?? undefined,
                              errorDetails: errorDetail ?? undefined,
                            });
                            // Manual retry: cancel any pending backoff and treat
                            // as a fresh attempt (reset the failure counter so
                            // the next warm-up gets the full 2s starting delay).
                            setRetryCountdown(null);
                            setWarmupFailures(0);
                            setHlsAutoRetries(0);
                            setAttempt((n) => n + 1);
                          }}
                          className="inline-flex items-center gap-2 rounded-lg bg-arena-violet px-4 py-2 text-[12px] font-bold uppercase tracking-wider text-white shadow-lg shadow-arena-violet/20 hover:bg-arena-violet/80 active:scale-95"
                        >
                          <RotateCcw className="h-4 w-4" />
                          {isWarmupError && retryCountdown !== null && retryCountdown > 0
                            ? "Try now"
                            : "Retry"}
                        </button>
                      </div>
                    </>

                  ) : (
                    <div className="flex w-full flex-col items-center">
                      {/* Shimmer skeleton block — mimics the incoming video frame */}
                      <div className="relative mb-4 h-16 w-40 overflow-hidden rounded-lg bg-white/[0.06] ring-1 ring-inset ring-white/10">
                        <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.6s_infinite] bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                      </div>
                      {/* Stepper — 4 dots for attaching → manifest → canplay → playing */}
                      <div
                        className="mb-3 flex items-center gap-1.5"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={LOADING_STEPS.length}
                        aria-valuenow={Math.max(0, activePhaseIndex)}
                        aria-valuetext={phaseMessage.title}
                      >
                        {LOADING_STEPS.map((step, i) => {
                          const stepIndex = PHASE_ORDER.indexOf(step.key);
                          const done = stepIndex < activePhaseIndex;
                          const current = stepIndex === activePhaseIndex;
                          return (
                            <div key={step.key} className="flex items-center gap-1.5">
                              <span
                                className={`h-1.5 w-1.5 rounded-full transition-colors ${
                                  done
                                    ? "bg-emerald-400"
                                    : current
                                      ? "bg-sky-400 animate-pulse"
                                      : "bg-white/20"
                                }`}
                                aria-label={`${step.label}${current ? " (current)" : done ? " (done)" : ""}`}
                              />
                              {i < LOADING_STEPS.length - 1 && (
                                <span
                                  className={`h-px w-4 ${done ? "bg-emerald-400/60" : "bg-white/15"}`}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <div
                        className="text-xs font-semibold uppercase tracking-widest text-white/90"
                        data-phase={phase}
                      >
                        {phaseMessage.title}
                      </div>
                      <div className="mt-1 text-[11px] text-white/60">{phaseMessage.hint}</div>
                      {channelName && (
                        <div className="mt-1 text-[11px] text-white/50 truncate max-w-full">
                          {channelName}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {showBufferingOverlay && (
              <div className="pointer-events-none absolute inset-x-0 bottom-14 flex justify-center">
                <div className="inline-flex items-center gap-2 rounded-full bg-black/75 px-3 py-1.5 text-[11px] font-semibold text-white/90 backdrop-blur-sm">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {errorDetail || "Rebuffering…"}
                </div>
              </div>
            )}


            <div className="pointer-events-none absolute left-2 top-2 flex max-w-[calc(100%-5.5rem)] items-center gap-1.5 sm:left-3 sm:top-3 sm:gap-2">
              <span className="shrink-0 rounded-md bg-black/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white/95 sm:px-2 sm:py-1 sm:text-[10px]">
                Slot {slot}
              </span>
              <span
                data-status-phase={phase}
                data-status-label={status.label}
                className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider backdrop-blur-sm sm:gap-1.5 sm:px-2 sm:py-1 sm:text-[10px] ${statusToneClass[status.tone]}`}
                aria-label={`Stream status: ${status.label}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                <span className="hidden sm:inline">{status.label}</span>
              </span>
              {channelName && (
                <span className="hidden min-w-0 max-w-[220px] truncate rounded-md bg-black/60 px-2 py-1 text-[10px] font-semibold text-white/90 sm:inline">
                  {channelName}
                </span>
              )}
            </div>


            <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 sm:right-3 sm:top-3">
              {!placeholder && (
                <span
                  data-stream-health={health}
                  title={healthInfo.hint}
                  aria-label={`Stream health: ${healthInfo.label}. ${healthInfo.hint}`}
                  className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider backdrop-blur-sm sm:gap-1.5 sm:px-2 sm:py-1 sm:text-[10px] ${statusToneClass[healthInfo.tone]}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${healthInfo.dot}`} />
                  <Activity className="h-3 w-3" />
                  <span className="hidden sm:inline">{healthInfo.label}</span>
                </span>
              )}
              {active ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-arena-violet/90 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white sm:px-2 sm:py-1 sm:text-[10px]">
                  <Volume2 className="h-3 w-3" />
                  <span className="hidden sm:inline">Audio</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold text-white/80 sm:px-2 sm:py-1 sm:text-[10px]">
                  <VolumeX className="h-3 w-3" />
                  <span className="hidden sm:inline">Muted</span>
                </span>
              )}
            </div>



            {!placeholder && (
              <button
                type="button"
                onClick={toggleFullscreen}
                className="pointer-events-auto absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-md bg-black/70 px-2 py-1 text-[10px] font-semibold text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100"
                aria-label="Fullscreen"
              >
                <Maximize2 className="h-3 w-3" /> Full
              </button>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="start"
          sideOffset={8}
          className="max-w-[260px] border border-arena-border bg-black/90 text-white"
        >
          <div className="space-y-1 text-[11px]">
            <div className="font-semibold text-white/90">Source</div>
            <div className="text-white/70">
              {providerType
                ? `${providerType} · ${playlistName || "Unknown playlist"}`
                : playlistName || "No provider configured"}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
