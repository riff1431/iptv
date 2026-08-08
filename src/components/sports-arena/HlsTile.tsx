import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { Maximize2, Volume2, VolumeX, RotateCcw, WifiOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SportImage } from "@/components/SportImage";

const stableLoadPolicy = (firstByteMs: number, loadMs: number) => ({
  default: {
    maxTimeToFirstByteMs: firstByteMs,
    maxLoadTimeMs: loadMs,
    timeoutRetry: {
      maxNumRetry: 2,
      retryDelayMs: 500,
      maxRetryDelayMs: 4_000,
      backoff: "exponential" as const,
    },
    errorRetry: {
      maxNumRetry: 2,
      retryDelayMs: 1_000,
      maxRetryDelayMs: 8_000,
      backoff: "exponential" as const,
    },
  },
});

export type HlsTileProps = {
  tvId: string;
  slot: number;
  displayName: string | null;
  channelName: string | null;
  status: "online" | "offline" | "unknown" | string;
  active: boolean;
  onActivate: () => void;
  /** Pause the underlying stream (e.g. during an ad break overlay). */
  paused?: boolean;
  /** Optional admin-set matchup label ("Lakers vs Celtics"). */
  matchup?: string | null;
  /** Optional admin-set sport label ("NBA"). */
  sport?: string | null;
};

/**
 * Single TV tile. Loads HLS from the server proxy with the current user's
 * bearer token, auto-recovers from stalls/errors, supports per-tile fullscreen,
 * and defers to the parent for which tile owns audio.
 */
export function HlsTile({
  tvId,
  slot,
  displayName,
  channelName,
  status,
  active,
  onActivate,
  paused = false,
  matchup = null,
  sport = null,
}: HlsTileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [phase, setPhase] = useState<"attaching" | "manifest" | "ready" | "playing">("attaching");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let hlsAutoRetries = 0;
    let warmupTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let bufferingTimer: ReturnType<typeof setTimeout> | null = null;
    let watchdogTimer: ReturnType<typeof setInterval> | null = null;
    let lastProgressAt = Date.now();
    let stableSince = Date.now();

    const clearWarmup = () => {
      if (warmupTimer !== null) {
        clearTimeout(warmupTimer);
        warmupTimer = null;
      }
    };
    const fail = (message: string, detail?: string) => {
      if (cancelled) return;
      clearWarmup();
      setError(message);
      setErrorDetail(detail ?? null);
      setLoading(false);
      setPlaying(false);
      setBuffering(false);
    };
    const armWarmup = () => {
      clearWarmup();
      warmupTimer = setTimeout(() => {
        fail(
          "Stream is taking too long",
          "No playable video frame arrived within 30 seconds. Retry or check the channel in Admin TVs.",
        );
      }, 30_000);
    };
    const onCanPlay = () => {
      if (cancelled) return;
      setPhase("ready");
      void video.play().catch(() => {});
    };
    const onPlaying = () => {
      if (cancelled) return;
      clearWarmup();
      if (bufferingTimer !== null) {
        clearTimeout(bufferingTimer);
        bufferingTimer = null;
      }
      setPhase("playing");
      setError(null);
      setErrorDetail(null);
      setLoading(false);
      setPlaying(true);
      setBuffering(false);
      lastProgressAt = Date.now();
    };
    const onWaiting = () => {
      if (cancelled || bufferingTimer) return;
      bufferingTimer = setTimeout(() => {
        bufferingTimer = null;
        if (!cancelled && !video.paused) setBuffering(true);
      }, 400);
    };
    const onProgress = () => {
      lastProgressAt = Date.now();
      if (bufferingTimer !== null) {
        clearTimeout(bufferingTimer);
        bufferingTimer = null;
      }
      setBuffering(false);
      if (Date.now() - stableSince >= 30_000) hlsAutoRetries = 0;
    };
    const onMediaError = () => {
      if (hlsRef.current) return;
      fail(
        "Stream failed to play",
        video.error?.message || "The media source could not be decoded.",
      );
    };

    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("stalled", onWaiting);
    video.addEventListener("timeupdate", onProgress);
    video.addEventListener("error", onMediaError);

    async function boot() {
      setLoading(true);
      setPlaying(false);
      setBuffering(false);
      setError(null);
      setErrorDetail(null);
      setPhase("attaching");

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        fail("Sign in to watch");
        return;
      }
      if (cancelled || !video) return;

      const src = `/api/sports-arena/tv/${tvId}/playlist`;
      armWarmup();

      if (Hls.isSupported()) {
        const hls = new Hls({
          xhrSetup: (xhr, rawUrl) => {
            const target = new URL(rawUrl, window.location.href);
            if (target.origin === window.location.origin) {
              xhr.setRequestHeader("Authorization", `Bearer ${token}`);
            }
          },
          liveDurationInfinity: true,
          lowLatencyMode: true,
          backBufferLength: 5,
          maxBufferLength: 10,
          maxMaxBufferLength: 20,
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 6,
          manifestLoadPolicy: stableLoadPolicy(15_000, 30_000),
          playlistLoadPolicy: stableLoadPolicy(15_000, 30_000),
          fragLoadPolicy: stableLoadPolicy(15_000, 60_000),
        });
        hlsRef.current = hls;
        // Match the proven Arena attachment sequence.
        hls.loadSource(src);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (cancelled) return;
          setPhase("manifest");
          void video.play().catch(() => {});
        });
        hls.on(Hls.Events.FRAG_BUFFERED, onProgress);
        hls.on(Hls.Events.ERROR, (_evt, data) => {
          if (cancelled) return;
          const httpCode = data.response?.code;
          if (httpCode === 409) {
            fail("Stream is offline", "Start this TV's shared stream from Admin TVs.");
            hls.destroy();
            reconnectTimer = setTimeout(() => setAttempt((n) => n + 1), 10_000);
            return;
          }
          if (httpCode === 429) {
            fail(
              "Provider connection limit reached",
              "This IPTV account already has too many active streams. Stop another provider stream and retry.",
            );
            hls.destroy();
            reconnectTimer = setTimeout(() => setAttempt((n) => n + 1), 10_000);
            return;
          }

          if (!data.fatal) return;

          if (
            data.type === Hls.ErrorTypes.NETWORK_ERROR ||
            data.type === Hls.ErrorTypes.MEDIA_ERROR
          ) {
            hlsAutoRetries += 1;
            if (hlsAutoRetries <= 3) {
              stableSince = Date.now();
              onWaiting();
              setErrorDetail(
                data.type === Hls.ErrorTypes.NETWORK_ERROR
                  ? "Reconnecting to the lounge stream…"
                  : "Recovering the video decoder…",
              );
              armWarmup();
              if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
              else hls.recoverMediaError();
              return;
            }
          }

          fail(
            "Stream failed to start",
            data.details || "The playlist loaded, but video segments could not be played.",
          );
        });
        watchdogTimer = setInterval(() => {
          if (cancelled || video.paused || Date.now() - lastProgressAt < 6_000) return;
          if (video.seekable.length) {
            const liveEdge = video.seekable.end(video.seekable.length - 1);
            if (liveEdge - video.currentTime > 45) {
              const safeTarget = hls.liveSyncPosition ?? liveEdge - 12;
              video.currentTime = Math.max(
                video.seekable.start(0),
                Math.min(liveEdge - 2, safeTarget),
              );
            }
          }
          onWaiting();
        }, 5_000);
      } else if (!video.canPlayType("application/vnd.apple.mpegurl")) {
        fail("HLS not supported in this browser");
      } else {
        // Native HLS cannot attach the Bearer header required by this endpoint.
        fail("Secure HLS playback is not supported in this browser");
      }
    }

    void boot();

    return () => {
      cancelled = true;
      clearWarmup();
      if (bufferingTimer !== null) clearTimeout(bufferingTimer);
      if (watchdogTimer !== null) clearInterval(watchdogTimer);
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("stalled", onWaiting);
      video.removeEventListener("timeupdate", onProgress);
      video.removeEventListener("error", onMediaError);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.removeAttribute("src");
      video.load();
    };
  }, [tvId, attempt]);
  // Active-audio: only the active tile is unmuted.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !active || paused;
    if (active && !paused) void v.play().catch(() => {});
  }, [active, paused]);

  // Pause/resume the underlying HLS stream during ad breaks.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (paused) {
      v.pause();
    } else {
      void v.play().catch(() => {});
    }
  }, [paused]);

  async function toggleFullscreen() {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      await document.exitFullscreen().catch(() => {});
    } else {
      await el.requestFullscreen().catch(() => {});
    }
  }

  const offline = status === "offline";
  const label = displayName ?? `TV ${slot}`;
  // The selected IPTV channel is the authoritative identity for a lounge TV.
  // `sport` / `matchup` can contain old manually entered demo data, so use
  // them only as a fallback when no real channel has been selected.
  const topLabel = channelName || sport || label.replace(/^tv\s*\d+\s*-\s*/i, "");
  const secondaryLabel = channelName ? null : matchup;

  const sportLabel = sport || channelName || null;
  const statusLabel = offline
    ? "offline"
    : error
      ? `error: ${error}`
      : playing
        ? "live"
        : buffering
          ? "buffering"
          : "connecting";
  const tileAriaLabel = [
    `TV ${slot}`,
    sportLabel,
    matchup,
    statusLabel,
    active ? "audio active" : null,
  ]
    .filter(Boolean)
    .join(" — ");
  const backdropAlt = sportLabel
    ? `${sportLabel}${matchup ? `: ${matchup}` : ""} backdrop image`
    : "";

  return (
    <div
      ref={containerRef}
      onClick={onActivate}
      role="button"
      tabIndex={0}
      aria-label={tileAriaLabel}
      aria-pressed={active}
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
      {/* Sport backdrop is mounted once and stays mounted across all state
          transitions (loading → error → offline → live). This eliminates the
          flicker you'd otherwise see when the image unmounts/remounts, and
          the video element above it hides it once frames are decoded. */}
      {sportLabel && (
        <SportImage
          sport={sportLabel}
          alt={backdropAlt}
          eager
          role="img"
          wrapperClassName="pointer-events-none"
          imgClassName={
            loading || buffering || error || offline
              ? "!opacity-60 transition-opacity duration-300"
              : "!opacity-0 transition-opacity duration-300"
          }
        />
      )}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        aria-label={sportLabel ? `${sportLabel} live stream` : `TV ${slot} live stream`}
        className="absolute inset-0 h-full w-full object-cover"
      />

      {(loading || buffering || error || offline) && (
        <>
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-black/50 via-black/60 to-black/85 text-center">
            <div className="max-w-[80%]">
              {offline ? (
                <>
                  <WifiOff className="mx-auto h-6 w-6 text-muted-foreground" />
                  <div className="mt-2 text-xs uppercase tracking-widest text-muted-foreground">
                    TV offline
                  </div>
                </>
              ) : error ? (
                <>
                  <div className="text-xs font-semibold text-live">{error}</div>
                  {errorDetail && (
                    <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                      {errorDetail}
                    </div>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setAttempt((n) => n + 1);
                    }}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-arena-violet px-2.5 py-1 text-[11px] font-semibold text-white"
                  >
                    <RotateCcw className="h-3 w-3" /> Retry
                  </button>
                </>
              ) : (
                <>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">
                    {buffering ? "Buffering stream…" : "Connecting stream…"}
                  </div>
                  <div className="mt-1 text-[10px] text-white/45">
                    {phase === "manifest"
                      ? "Playlist attached · waiting for video"
                      : phase === "ready"
                        ? "Video ready · starting playback"
                        : "Attaching secure lounge feed"}
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* Top-left label — actual IPTV channel, with legacy metadata as fallback */}
      <div className="pointer-events-none absolute left-3 top-3 max-w-[70%]">
        <span className="block truncate rounded-md bg-black/70 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white/95 backdrop-blur">
          TV {slot} · {topLabel}
        </span>
        {secondaryLabel && (
          <span className="mt-1 block truncate rounded-md bg-black/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/80 backdrop-blur">
            {secondaryLabel}
          </span>
        )}
      </div>

      {/* Top-right playback badge — LIVE only after the first playing event */}
      <div className="pointer-events-none absolute right-3 top-3">
        <span
          className={`inline-flex h-6 items-center rounded-[6px] px-2.5 text-[11px] font-bold uppercase leading-none tracking-[0.08em] ${
            offline || error
              ? "bg-muted text-muted-foreground"
              : playing
                ? "bg-live text-live-foreground"
                : "bg-warning/90 text-black"
          }`}
        >
          {offline || error ? "OFF" : playing ? "LIVE" : buffering ? "BUFFER" : "CONNECT"}
        </span>
      </div>

      {/* Hover controls */}
      <div className="pointer-events-none absolute bottom-3 right-3 flex gap-1.5 opacity-0 transition group-hover:opacity-100">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onActivate();
          }}
          className="pointer-events-auto rounded-md bg-black/80 p-1.5 text-white backdrop-blur transition hover:bg-arena-violet"
          aria-label={active ? "Mute" : "Unmute"}
        >
          {active ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            void toggleFullscreen();
          }}
          className="pointer-events-auto rounded-md bg-black/80 p-1.5 text-white backdrop-blur transition hover:bg-arena-violet"
          aria-label="Fullscreen"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
