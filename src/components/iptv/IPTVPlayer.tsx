import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
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
import { cn } from "@/lib/utils";

type Props = {
  url: string;
  poster?: string | null;
};

const CONTROLS_HIDE_MS = 2500;
const VOLUME_STORAGE_KEY = "iptv-player-volume";
const MUTED_STORAGE_KEY = "iptv-player-muted";

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
  }, [url]);

  // HLS / source setup
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;

    setLoading(true);
    setLoadingStage("Connecting…");
    setLoadProgress(null);
    setError(null);
    let hls: Hls | null = null;
    let recoverAttempts = 0;

    const clearLoading = () => {
      setLoading(false);
      setLoadProgress(null);
      recoverAttempts = 0;
    };
    const onPlaying = () => clearLoading();
    const onCanPlay = () => clearLoading();
    const onWaiting = () => {
      // Mid-playback stall — surface buffering without wiping error state.
      if (!error) {
        setLoading(true);
        setLoadingStage("Buffering…");
        setLoadProgress(null);
      }
    };
    const onSrcError = () => {
      // Native <video> element error (non-HLS path or Safari native HLS).
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
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("error", onSrcError);

    const isHls = /\.m3u8($|\?)/i.test(url);
    if (isHls && Hls.isSupported()) {
      hls = new Hls({ enableWorker: true });
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
      hls.on(Hls.Events.LEVEL_LOADED, () => {
        setLoadProgress((p) => (p !== null && p < 70 ? 70 : p));
      });
      hls.on(Hls.Events.FRAG_LOADING, () => {
        setLoadingStage("Buffering…");
        setLoadProgress((p) => (p !== null && p < 80 ? 80 : p));
      });
      hls.on(Hls.Events.FRAG_LOADED, () => {
        setLoadProgress((p) => (p !== null && p < 95 ? 95 : p));
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal || !hls) return;
        // Try to recover once from network / media faults before surfacing.
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && recoverAttempts < 2) {
          recoverAttempts++;
          setLoadingStage("Reconnecting…");
          hls.startLoad();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && recoverAttempts < 2) {
          recoverAttempts++;
          setLoadingStage("Recovering…");
          hls.recoverMediaError();
          return;
        }
        const msg =
          data.type === Hls.ErrorTypes.NETWORK_ERROR
            ? "Network error — check your connection or the playlist URL."
            : data.type === Hls.ErrorTypes.MEDIA_ERROR
              ? "Playback error — the stream is unreadable."
              : "This stream could not be played.";
        setError(msg);
        setLoading(false);
      });
    } else {
      video.src = url;
    }
    video.play().catch(() => {
      /* autoplay may be blocked; the custom controls let the user start */
    });

    return () => {
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("error", onSrcError);
      if (hls) {
        hls.destroy();
      } else {
        video.removeAttribute("src");
        video.load();
      }
    };
  }, [url, attempt]);

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
      const video = videoRef.current as
        | (HTMLVideoElement & {
            webkitDisplayingFullscreen?: boolean;
            webkitExitFullscreen?: () => void;
          })
        | null;
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
      <video
        ref={videoRef}
        className="h-full w-full"
        playsInline
        poster={poster ?? undefined}
        onClick={togglePlay}
        // Native controls are intentionally omitted; the custom bar below
        // provides play/pause, volume and fullscreen with keyboard support.
      />

      {loading && !error && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute inset-0 z-[5] flex flex-col items-center justify-center gap-3 bg-black/55 text-white backdrop-blur-[2px]"
        >
          <Loader2 className="h-9 w-9 animate-spin" aria-hidden />
          <p className="text-xs font-medium tracking-wide text-white/90">
            {loadingStage}
          </p>
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
          controlsVisible || !playing
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100",
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
              {isFullscreen ? (
                <Minimize className="h-5 w-5" />
              ) : (
                <Maximize className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
