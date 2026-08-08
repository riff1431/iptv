import { useCallback, useEffect, useRef, useState } from "react";
import Hls, { type ErrorData } from "hls.js";
import mpegts from "mpegts.js";
import {
  Loader2,
  AlertTriangle,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Volume1,
  Maximize,
  Minimize,
  Radio,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { getIptvPlaybackErrorMessage, isIptvHlsUrl } from "@/lib/iptv-playback-error";
import { cn } from "@/lib/utils";
import { getBufferedSecondsAhead } from "./iptv-player-utils";

type Props = {
  url: string;
  poster?: string | null;
};

const CONTROLS_HIDE_MS = 2500;
const IPTV_STARTUP_BUFFER_SECONDS = 12;
const IPTV_MIN_STARTUP_BUFFER_SECONDS = 4;
const IPTV_STARTUP_BUFFER_DEADLINE_MS = 30_000;
const VOLUME_STORAGE_KEY = "iptv-player-volume";
const MUTED_STORAGE_KEY = "iptv-player-muted";

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
function readStoredVolume(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(VOLUME_STORAGE_KEY);
  const n = raw ? parseFloat(raw) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

function readStoredMuted(): boolean | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(MUTED_STORAGE_KEY);
  return raw === "true" ? true : raw === "false" ? false : null;
}

export function IPTVPlayer({ url, poster }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<string>("Connecting…");
  const [loadProgress, setLoadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [fallbackToHls, setFallbackToHls] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  // Reset failover on channel URL change
  useEffect(() => {
    setFallbackToHls(false);
  }, [url]);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(() => readStoredMuted() ?? false);
  const [volume, setVolume] = useState(() => readStoredVolume() ?? 1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isLive, setIsLive] = useState(true);

  // Restore persisted volume/mute on the active video element.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
    video.volume = volume;
  }, [url, muted, volume]);

  // HLS / MPEG-TS / source setup
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;

    setLoading(true);
    setLoadingStage("Connecting…");
    setLoadProgress(null);
    setError(null);
    setAutoplayBlocked(false);
    let hls: Hls | null = null;
    let mpegtsPlayer: mpegts.Player | null = null;
    let recoveryAttempts: number[] = [];
    let stableSince = Date.now();
    let recoveryTimer: number | null = null;
    let cancelled = false;
    let waitForStartupBuffer = false;
    let playbackStarted = false;
    let playPending = false;
    let startupBufferTarget = IPTV_STARTUP_BUFFER_SECONDS;
    const startupBufferDeadline = Date.now() + IPTV_STARTUP_BUFFER_DEADLINE_MS;
    let waitingTimer: number | null = null;

    const clearLoading = () => {
      if (waitingTimer) {
        window.clearTimeout(waitingTimer);
        waitingTimer = null;
      }
      setLoading(false);
      setLoadProgress(null);
    };
    const markAutoplayBlocked = () => {
      if (cancelled) return;
      setAutoplayBlocked(true);
      clearLoading();
    };
    const startPlayback = () => {
      if (playPending || cancelled) return;
      if (waitForStartupBuffer && !playbackStarted) {
        const bufferedSeconds = getBufferedSecondsAhead(video);
        const deadlineReached = Date.now() >= startupBufferDeadline;
        const requiredSeconds = deadlineReached
          ? Math.min(startupBufferTarget, IPTV_MIN_STARTUP_BUFFER_SECONDS)
          : startupBufferTarget;
        if (bufferedSeconds < requiredSeconds) {
          setLoading(true);
          setLoadingStage("Building stable buffer...");
          setLoadProgress(80 + Math.min(15, (bufferedSeconds / requiredSeconds) * 15));
          return;
        }
      }

      playPending = true;
      const attemptPlay = video.play();
      if (!attemptPlay || typeof attemptPlay.then !== "function") {
        playPending = false;
        return;
      }
      void attemptPlay
        .then(() => {
          playPending = false;
          playbackStarted = true;
          if (!cancelled) setAutoplayBlocked(false);
        })
        .catch((playError: unknown) => {
          playPending = false;
          if (cancelled) return;
          const name = (playError as { name?: string } | null)?.name;
          if (name === "NotAllowedError" && !video.muted) {
            // Chrome blocks audible autoplay in fresh/incognito sessions. Retry
            // muted so live playback starts, while keeping the volume control
            // available for an explicit user unmute.
            video.muted = true;
            setMuted(true);
            playPending = true;
            void video
              .play()
              .then(() => {
                playPending = false;
                playbackStarted = true;
                setAutoplayBlocked(false);
              })
              .catch(() => {
                playPending = false;
                markAutoplayBlocked();
              });
          } else if (name === "NotAllowedError") {
            markAutoplayBlocked();
          }
          // AbortError is normal while HLS is still attaching. onCanPlay below
          // retries once media is actually ready.
        });
    };
    const onPlaying = () => {
      playbackStarted = true;
      playPending = false;
      setAutoplayBlocked(false);
      clearLoading();
    };
    const onCanPlay = () => {
      clearLoading();
      startPlayback();
    };
    let lastTime = 0;
    let lastAdvanceTime = Date.now();
    let stallCheckTimer: number | null = null;

    const onTimeUpdate = () => {
      clearLoading();
      const now = Date.now();
      if (video.currentTime > lastTime + 0.1) {
        lastTime = video.currentTime;
        lastAdvanceTime = now;
        if (now - stableSince >= 30_000) recoveryAttempts = [];
      }
    };

    const onWaiting = () => {
      // Debounce transient 50ms MSE buffer catch-ups — only show buffering if stall > 600ms
      if (waitingTimer) window.clearTimeout(waitingTimer);
      waitingTimer = window.setTimeout(() => {
        if (!video.paused) {
          setLoading(true);
          setLoadingStage("Buffering…");
          setLoadProgress(null);
        }
      }, 600);
    };
    const onSrcError = () => {
      if (!fallbackToHls) {
        // Automatic Engine Recovery: If native or mpegts playback fails, switch to HLS engine (.m3u8)
        setFallbackToHls(true);
        setLoadingStage("Switching player engine…");
        return;
      }
      // Native <video> element error (non-HLS/MPEG-TS path or Safari native player).
      const mediaErr = video.error;
      const code = mediaErr?.code;
      if (code === 2) setError("Network error — the stream could not be reached.");
      else if (code === 3) setError("This stream is corrupted or unsupported.");
      else if (code === 4) setError("The stream format is not supported by your browser.");
      else setError("Stream failed to play.");
      setLoading(false);
    };
    video.addEventListener("playing", onPlaying);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("stalled", onWaiting);
    video.addEventListener("error", onSrcError);

    // Ordinary live jitter is not a reason to restart the loader. After a
    // sustained stall, only correct excessive drift from the live edge.
    stallCheckTimer = window.setInterval(() => {
      if (
        videoRef.current &&
        !videoRef.current.paused &&
        !videoRef.current.ended &&
        Date.now() - lastAdvanceTime > 6000
      ) {
        if (mpegtsPlayer) {
          onWaiting();
        } else if (hls) {
          const ranges = video.seekable;
          if (ranges.length) {
            const liveEdge = ranges.end(ranges.length - 1);
            if (liveEdge - video.currentTime > 30) {
              const safeTarget = hls.liveSyncPosition ?? liveEdge - 12;
              video.currentTime = Math.max(ranges.start(0), Math.min(liveEdge - 2, safeTarget));
              lastAdvanceTime = Date.now();
            }
          }
          onWaiting();
        }
      }
    }, 2000);

    const PROXY_PLAYLIST_PATH = "/api/public/iptv/playlist";
    const PROXY_STREAM_PATH = "/api/public/iptv/stream";

    const origin = typeof window !== "undefined" ? window.location.origin : "";

    // Determine target URL and player type.
    const isDirectTs = /\.ts($|\?)/i.test(url) || url.includes(PROXY_STREAM_PATH);
    const isHls = isIptvHlsUrl(url);

    let rawPlaybackUrl = url;
    if (url.startsWith("http://") || url.startsWith("https://")) {
      if (isDirectTs && !url.includes(PROXY_STREAM_PATH)) {
        rawPlaybackUrl = `${PROXY_STREAM_PATH}?url=${encodeURIComponent(url)}`;
      } else if (isHls && !url.includes(PROXY_PLAYLIST_PATH)) {
        rawPlaybackUrl = `${PROXY_PLAYLIST_PATH}?url=${encodeURIComponent(url)}`;
      }
    }

    // Crucial: Web Workers (WorkerGlobalScope) in mpegts.js cannot resolve relative
    // root URLs like "/api/public/...". We must pass a fully-qualified absolute URL.
    const targetPlaybackUrl = rawPlaybackUrl.startsWith("/")
      ? `${origin}${rawPlaybackUrl}`
      : rawPlaybackUrl;

    const useMpegts = isDirectTs && mpegts.isSupported();
    const useHls = isHls || (isDirectTs && !mpegts.isSupported());

    if (useMpegts) {
      setLoadingStage("Connecting live stream…");
      setLoadProgress(30);

      try {
        mpegtsPlayer = mpegts.createPlayer(
          {
            type: "mpegts", // MPEG-TS demuxer for live streams
            isLive: true,
            url: targetPlaybackUrl,
          },
          {
            enableWorker: true, // Offload TS demuxing to Web Worker thread so UI never freezes
            enableStashBuffer: true, // Absorb network jitter & align AAC-HE / H.264 PTS timestamps
            stashInitialSize: 1024 * 1024, // 1MB initial stash buffer ensures complete GOP/I-frame before decode starts
            liveBufferLatencyChasing: false, // DISABLE hard seeking freezes!
            liveSync: true, // Enable smooth playback rate adjustments (1.05x - 1.08x)
            liveSyncMaxLatency: 2.5, // Start smooth rate speedup at 2.5s drift
            liveSyncTargetLatency: 1.0, // Target live buffer reserve = 1.0s
            liveSyncPlaybackRate: 1.08, // Imperceptible 8% speedup catchup (no video decode freezes)
            autoCleanupSourceBuffer: true, // Clean up old MSE memory buffer when switching channels
            autoCleanupMaxBackwardDuration: 30,
            autoCleanupMinBackwardDuration: 15,
            lazyLoad: false,
          },
        );

        mpegtsPlayer.on(mpegts.Events.MEDIA_INFO, () => {
          clearLoading();
        });

        mpegtsPlayer.on(mpegts.Events.STATISTICS_INFO, () => {
          // Continuous video frames arriving — clear loading overlay if active
          clearLoading();
        });

        mpegtsPlayer.on(mpegts.Events.ERROR, (_errType: string, _errDetail: string) => {
          const now = Date.now();
          recoveryAttempts = recoveryAttempts.filter((time) => now - time < 60_000);
          if (recoveryAttempts.length < 2) {
            recoveryAttempts.push(now);
            stableSince = now;
            setLoadingStage("Reconnecting stream…");
            mpegtsPlayer?.unload();
            mpegtsPlayer?.load();
          } else {
            setError("Stream error. The channel may be offline or connection limit reached.");
            setLoading(false);
          }
        });

        mpegtsPlayer.attachMediaElement(video);
        mpegtsPlayer.load();
        try {
          const res = mpegtsPlayer.play();
          if (res && typeof res.catch === "function") {
            res.catch(() => {});
          }
        } catch {
          /* autoplay blocked */
        }
      } catch {
        setError("Your browser does not support live MPEG-TS MSE streaming.");
        setLoading(false);
      }
    } else if (useHls && Hls.isSupported()) {
      waitForStartupBuffer = true;
      const hlsTargetUrl = isDirectTs
        ? `${origin}${PROXY_PLAYLIST_PATH}?url=${encodeURIComponent(url.replace(/\.ts($|\?)/i, ".m3u8"))}`
        : targetPlaybackUrl;
      hls = new Hls({
        enableWorker: true,
        progressive: true,
        // Production-safe live settings. The relay fully buffers each segment
        // server-side before responding (TTFB ≈ full download time), so we keep a
        // generous forward buffer and disable LL-HLS edge-chasing — lowLatencyMode
        // with standard 10s segments causes constant rebuffering in production.
        // Values are locked by IPTVPlayer.playback.test.tsx.
        lowLatencyMode: false,
        backBufferLength: 30,
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
        liveSyncDurationCount: 6,
        liveMaxLatencyDurationCount: 12,
        manifestLoadPolicy: stableLoadPolicy(15_000, 30_000),
        playlistLoadPolicy: stableLoadPolicy(15_000, 30_000),
        fragLoadPolicy: stableLoadPolicy(15_000, 60_000),
      });

      hls.on(Hls.Events.MANIFEST_LOADING, () => {
        setLoadingStage("Loading playlist…");
        setLoadProgress(10);
      });
      hls.on(Hls.Events.MANIFEST_LOADED, () => {
        setLoadingStage("Preparing stream…");
        setLoadProgress(35);
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoadingStage("Preparing stream…");
        setLoadProgress(55);
      });
      hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
        const totalDuration = data.details.totalduration;
        const targetDuration = data.details.targetduration;
        startupBufferTarget = Math.max(
          IPTV_MIN_STARTUP_BUFFER_SECONDS,
          Math.min(IPTV_STARTUP_BUFFER_SECONDS, totalDuration - targetDuration),
        );
        setLoadProgress((p) => (p !== null && p < 70 ? 70 : p));
      });
      hls.on(Hls.Events.FRAG_LOADING, () => {
        if (!playbackStarted) {
          setLoadingStage("Building stable buffer…");
          setLoadProgress((p) => (p !== null && p < 80 ? 80 : p));
        }
      });
      hls.on(Hls.Events.FRAG_LOADED, () => {
        setLoadProgress((p) => (p !== null && p < 95 ? 95 : p));
      });
      hls.on(Hls.Events.BUFFER_APPENDED, () => {
        startPlayback();
      });
      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        lastAdvanceTime = Date.now();
        clearLoading();
        startPlayback();
      });

      hls.loadSource(hlsTargetUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.ERROR, (_e, data: ErrorData) => {
        // ── Non-fatal errors ──────────────────────────────────────────────
        // hls.js handles non-fatal errors internally (retries, level switching).
        if (!data.fatal) return;

        // ── Fatal errors ──────────────────────────────────────────────────
        if (!hls) return;

        const isConnLimit = data.response?.code === 458 || data.response?.code === 429;
        const now = Date.now();
        recoveryAttempts = recoveryAttempts.filter((time) => now - time < 60_000);
        if (!isConnLimit && data.type === Hls.ErrorTypes.NETWORK_ERROR && recoveryTimer !== null) {
          return;
        }
        if (
          !isConnLimit &&
          data.type === Hls.ErrorTypes.NETWORK_ERROR &&
          recoveryAttempts.length < 3
        ) {
          recoveryAttempts.push(now);
          stableSince = now;
          setLoadingStage("Reconnecting…");
          recoveryTimer = window.setTimeout(() => {
            recoveryTimer = null;
            hls?.startLoad();
          }, 800);
          return;
        }
        if (
          !isConnLimit &&
          data.type === Hls.ErrorTypes.MEDIA_ERROR &&
          recoveryAttempts.length < 3
        ) {
          recoveryAttempts.push(now);
          stableSince = now;
          setLoadingStage("Recovering…");
          hls.recoverMediaError();
          return;
        }

        setError(getIptvPlaybackErrorMessage(data));
        setLoading(false);
      });
    } else {
      video.src = targetPlaybackUrl;
    }
    startPlayback();

    return () => {
      cancelled = true;
      if (waitingTimer) window.clearTimeout(waitingTimer);
      if (stallCheckTimer) window.clearInterval(stallCheckTimer);
      if (recoveryTimer) window.clearTimeout(recoveryTimer);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("stalled", onWaiting);
      video.removeEventListener("error", onSrcError);
      if (mpegtsPlayer) {
        mpegtsPlayer.detachMediaElement();
        mpegtsPlayer.destroy();
        mpegtsPlayer = null;
      }
      if (hls) {
        hls.destroy();
        hls = null;
      } else if (!mpegtsPlayer) {
        video.removeAttribute("src");
        video.load();
      }
    };
  }, [url, attempt, fallbackToHls]);

  // Sync UI state with the underlying video element (covers native controls
  // in Picture-in-Picture, keyboard shortcuts, or programmatic changes).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const syncPlay = () => setPlaying(!video.paused);
    const syncVolume = () => {
      setMuted(video.muted);
      setVolume(video.volume);
    };
    const syncDuration = () => {
      // Live streams typically report Infinity or NaN.
      setIsLive(!Number.isFinite(video.duration));
    };

    video.addEventListener("play", syncPlay);
    video.addEventListener("pause", syncPlay);
    video.addEventListener("volumechange", syncVolume);
    video.addEventListener("durationchange", syncDuration);
    video.addEventListener("loadedmetadata", syncDuration);

    syncPlay();
    syncVolume();
    syncDuration();

    return () => {
      video.removeEventListener("play", syncPlay);
      video.removeEventListener("pause", syncPlay);
      video.removeEventListener("volumechange", syncVolume);
      video.removeEventListener("durationchange", syncDuration);
      video.removeEventListener("loadedmetadata", syncDuration);
    };
  }, [url]);

  // Persist volume and mute state so the next stream restores them.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(VOLUME_STORAGE_KEY, String(volume));
    window.localStorage.setItem(MUTED_STORAGE_KEY, String(muted));
  }, [volume, muted]);

  // Fullscreen state — reflect both user-triggered and OS-triggered exits,
  // including WebKit's video-element fullscreen used on iOS Safari.
  useEffect(() => {
    const video = videoRef.current as
      | (HTMLVideoElement & {
          webkitDisplayingFullscreen?: boolean;
        })
      | null;

    const onFsChange = () => {
      const doc = document as Document & {
        webkitFullscreenElement?: Element | null;
      };
      const fsEl = document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
      const inContainerFs = fsEl === containerRef.current || fsEl === videoRef.current;
      const inVideoFs = !!video?.webkitDisplayingFullscreen;
      setIsFullscreen(inContainerFs || inVideoFs);
    };

    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange as EventListener);
    video?.addEventListener("webkitbeginfullscreen", onFsChange);
    video?.addEventListener("webkitendfullscreen", onFsChange);

    onFsChange();

    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange as EventListener);
      video?.removeEventListener("webkitbeginfullscreen", onFsChange);
      video?.removeEventListener("webkitendfullscreen", onFsChange);
    };
  }, [url]);

  // On stream switch, forcibly exit any lingering fullscreen so the new
  // stream doesn't inherit a stuck fullscreen UI.
  useEffect(() => {
    const video = videoRef.current as
      | (HTMLVideoElement & {
          webkitDisplayingFullscreen?: boolean;
          webkitExitFullscreen?: () => void;
        })
      | null;
    return () => {
      const doc = document as Document & {
        webkitFullscreenElement?: Element | null;
        webkitExitFullscreen?: () => void;
      };
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
      }
      if (video?.webkitDisplayingFullscreen && video.webkitExitFullscreen) {
        video.webkitExitFullscreen();
      }
      setIsFullscreen(false);
    };
  }, [url]);

  // Auto-hide controls after inactivity while playing.
  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setControlsVisible(false);
      }
    }, CONTROLS_HIDE_MS);
  }, []);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    if (!playing) {
      setControlsVisible(true);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    } else {
      scheduleHide();
    }
    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, [playing, scheduleHide]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => setError("Playback was blocked"));
    } else {
      video.pause();
    }
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    if (!video.muted && video.volume === 0) {
      video.volume = 0.5;
    }
  }, []);

  const onVolumeChange = useCallback((values: number[]) => {
    const video = videoRef.current;
    if (!video) return;
    const v = Math.max(0, Math.min(1, values[0] ?? 0));
    video.volume = v;
    video.muted = v === 0;
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    const video = videoRef.current as
      | (HTMLVideoElement & {
          webkitEnterFullscreen?: () => void;
          webkitExitFullscreen?: () => void;
          webkitDisplayingFullscreen?: boolean;
        })
      | null;
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => void;
    };

    const anyFsActive =
      !!document.fullscreenElement ||
      !!doc.webkitFullscreenElement ||
      !!video?.webkitDisplayingFullscreen;

    if (anyFsActive) {
      try {
        if (document.fullscreenElement && document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) {
          doc.webkitExitFullscreen();
        } else if (video?.webkitDisplayingFullscreen && video.webkitExitFullscreen) {
          video.webkitExitFullscreen();
        }
      } catch {
        /* ignore */
      }
      return;
    }

    if (!el) return;
    try {
      await el.requestFullscreen();
    } catch {
      // iOS Safari only supports fullscreen on the <video> element itself.
      video?.webkitEnterFullscreen?.();
    }
  }, []);

  // Keyboard shortcuts when the player has focus.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.target instanceof HTMLInputElement) return;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "m":
          e.preventDefault();
          toggleMute();
          break;
        case "f":
          e.preventDefault();
          void toggleFullscreen();
          break;
      }
    },
    [togglePlay, toggleMute, toggleFullscreen],
  );

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  const safePoster =
    poster && typeof window !== "undefined" && window.location.protocol === "https:"
      ? poster.replace(/^http:\/\//i, "https://")
      : (poster ?? undefined);

  const isOfflineFeed = url.includes("black.ts");

  return (
    <div
      ref={containerRef}
      className={cn(
        "group relative w-full overflow-hidden rounded-lg bg-black outline-none",
        isFullscreen ? "aspect-auto h-full" : "aspect-video",
      )}
      onMouseMove={showControls}
      onMouseLeave={() => {
        if (playing) setControlsVisible(false);
      }}
      onKeyDown={onKeyDown}
      tabIndex={0}
    >
      {isOfflineFeed && (
        <div className="pointer-events-none absolute top-4 right-4 z-10 flex items-center gap-2 rounded-full bg-amber-500/20 backdrop-blur-md border border-amber-500/30 px-3 py-1.5 text-xs text-amber-300 font-medium shadow-md">
          <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
          Channel Offline (Provider Black Feed)
        </div>
      )}

      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        playsInline
        autoPlay
        preload="auto"
        poster={safePoster}
        onClick={togglePlay}
        // Native controls are intentionally omitted; the custom bar below
        // provides play/pause, volume and fullscreen with keyboard support.
      />

      {autoplayBlocked && !error && (
        <button
          type="button"
          className="absolute inset-0 z-[6] flex flex-col items-center justify-center gap-3 bg-black/70 text-white transition hover:bg-black/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          aria-label="Click to start playback"
          onClick={() => {
            const video = videoRef.current;
            if (!video) return;
            video.muted = true;
            setMuted(true);
            void video
              .play()
              .then(() => setAutoplayBlocked(false))
              .catch(() => {});
          }}
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/40">
            <Play className="h-7 w-7" />
          </span>
          <span className="text-sm font-medium">Click to play</span>
        </button>
      )}
      {loading && !error && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute inset-0 z-[5] flex flex-col items-center justify-center gap-3 bg-black/55 text-white backdrop-blur-[2px]"
        >
          <Loader2 className="h-9 w-9 animate-spin" aria-hidden />
          <p className="text-xs font-medium tracking-wide text-white/90">{loadingStage}</p>
          {loadProgress !== null && (
            <div className="h-1 w-40 overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full bg-white/80 transition-[width] duration-300 ease-out"
                style={{ width: `${Math.min(100, Math.max(0, loadProgress))}%` }}
              />
            </div>
          )}
        </div>
      )}

      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/85 p-6 text-center text-white backdrop-blur-sm"
        >
          <AlertTriangle className="h-10 w-10 text-amber-400" />
          <div className="max-w-sm space-y-1">
            <p className="text-sm font-semibold">Stream unavailable</p>
            <p className="text-xs text-white/70">{error}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setError(null);
              setLoading(true);
              setAttempt((n) => n + 1);
            }}
          >
            Retry
          </Button>
        </div>
      )}

      {/* Custom control bar */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 pb-2 pt-6 text-white transition-opacity duration-200",
          controlsVisible || !playing ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
        onMouseMove={(e) => e.stopPropagation()}
      >
        <div className="pointer-events-auto flex items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-9 w-9 text-white hover:bg-white/10 hover:text-white"
            onClick={togglePlay}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9 text-white hover:bg-white/10 hover:text-white"
              onClick={toggleMute}
              aria-label={muted ? "Unmute" : "Mute"}
            >
              <VolumeIcon className="h-5 w-5" />
            </Button>
            <div className="w-24">
              <Slider
                value={[muted ? 0 : volume]}
                min={0}
                max={1}
                step={0.05}
                onValueChange={onVolumeChange}
                aria-label="Volume"
              />
            </div>
          </div>

          {isLive && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-sm bg-red-600/90 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">
              <Radio className="h-3 w-3" />
              Live
            </span>
          )}

          <div className="ml-auto">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9 text-white hover:bg-white/10 hover:text-white"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
