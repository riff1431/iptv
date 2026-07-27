import { useCallback, useEffect, useRef, useState } from "react";
import Hls, { type ErrorData, type Level } from "hls.js";
import {
  Loader2,
  Play,
  Pause,
  RotateCw,
  AlertTriangle,
  VolumeX,
  Volume2,
  Maximize,
  Settings,
  Radio,
} from "lucide-react";

type PlayerStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "buffering" }
  | { kind: "ready" }
  | { kind: "blocked" }
  | { kind: "error"; message: string };

/**
 * IPTV-optimized HLS player. Uses hls.js with low-latency + tight live sync
 * config, exposes a quality picker (auto + variants), live badge, hover
 * controls (play/pause, mute, fullscreen, quality), keyboard shortcuts, and
 * an in-player error panel with retry.
 */
export function HlsPlayer({
  src,
  className = "",
  onReady,
}: {
  src: string | null | undefined;
  className?: string;
  onReady?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  // Persisted playback preferences (survive reloads).
  const LS_MUTED = "hls-player:muted";
  const LS_PAUSED = "hls-player:paused";
  const readLS = (key: string, fallback: boolean) => {
    if (typeof window === "undefined") return fallback;
    try {
      const v = window.localStorage.getItem(key);
      return v === null ? fallback : v === "1";
    } catch {
      return fallback;
    }
  };
  const writeLS = (key: string, value: boolean) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, value ? "1" : "0");
    } catch {
      // ignore
    }
  };

  const [status, setStatus] = useState<PlayerStatus>({ kind: "idle" });
  const [muted, setMuted] = useState(() => readLS(LS_MUTED, true));
  const [paused, setPaused] = useState(() => readLS(LS_PAUSED, false));
  const [playing, setPlaying] = useState(false);
  const [levels, setLevels] = useState<Level[]>([]);
  const [currentLevel, setCurrentLevel] = useState<number>(-1); // -1 = auto
  const [showQuality, setShowQuality] = useState(false);
  const [nonce, setNonce] = useState(0);
  const pausedPrefRef = useRef(paused);
  useEffect(() => {
    pausedPrefRef.current = paused;
    writeLS(LS_PAUSED, paused);
  }, [paused]);
  useEffect(() => {
    writeLS(LS_MUTED, muted);
  }, [muted]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  // Attach source + wire event listeners whenever src / retry changes.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) {
      setStatus({ kind: "idle" });
      return;
    }

    setStatus({ kind: "loading" });
    setLevels([]);
    setCurrentLevel(-1);

    hlsRef.current?.destroy();
    hlsRef.current = null;
    video.removeAttribute("src");
    video.load();

    let cancelled = false;
    const isHls = /\.m3u8($|\?)/i.test(src);

    const markReady = () => {
      if (cancelled) return;
      setStatus({ kind: "ready" });
      onReady?.();
    };
    const tryPlay = () => {
      if (pausedPrefRef.current) return; // user previously paused — keep paused across reloads
      const p = video.play();
      if (!p || typeof p.then !== "function") return;
      p.catch((err: unknown) => {
        if (cancelled) return;
        const name = (err as { name?: string } | null)?.name;
        if (name === "NotAllowedError" || name === "AbortError") {
          setStatus({ kind: "blocked" });
        }
      });
    };

    const onCanPlay = () => {
      markReady();
      tryPlay();
    };
    const onPlaying = () => {
      markReady();
      setPlaying(true);
    };
    const onWaiting = () => {
      if (!cancelled) setStatus({ kind: "buffering" });
    };
    const onPause = () => setPlaying(false);
    const onMediaError = () => {
      if (cancelled) return;
      setStatus({
        kind: "error",
        message:
          "Playback failed — the stream may be offline or temporarily unavailable. Try Retry, or pick a different channel.",
      });
    };

    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("pause", onPause);
    video.addEventListener("error", onMediaError);

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        // IPTV-friendly: prefer low latency, tight back-buffer.
        lowLatencyMode: true,
        backBufferLength: 30,
        maxBufferLength: 30,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 6,
      });
      hlsRef.current = hls;

      hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
        setLevels(data.levels);
        tryPlay();
      });
      hls.on(Hls.Events.LEVEL_SWITCHING, () => {
        if (cancelled) return;
        setStatus({ kind: "buffering" });
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
        setCurrentLevel(data.level);
      });

      hls.on(Hls.Events.ERROR, (_e, data: ErrorData) => {
        if (cancelled) return;
        if (!data.fatal) {
          // Non-fatal: try to recover network / media.
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          return;
        }
        const isManifest =
          data.details === "manifestLoadError" ||
          data.details === "manifestLoadTimeOut" ||
          data.details === "manifestParsingError";
        setStatus({
          kind: "error",
          message: isManifest
            ? "This stream can't be played in the browser. The source server doesn't send the CORS headers browsers require for cross-origin video, so playback is blocked before the manifest can load.\n\nWhat you can do:\n• Click Retry — the source may be temporarily offline.\n• Pick a different channel — many iptv-org streams have the same restriction.\n• Play it in a native player (VLC, mpv) where CORS doesn't apply."
            : `Playback error: ${data.details ?? data.type}. Try Retry, or pick a different channel.`,
        });
      });

      hls.loadSource(src);
      hls.attachMedia(video);
    } else {
      // Native HLS (Safari) or plain progressive URL.
      video.src = src;
    }

    video.muted = true;
    video.playsInline = true;
    tryPlay();

    return () => {
      cancelled = true;
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("error", onMediaError);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.removeAttribute("src");
      video.load();
    };
  }, [src, nonce, onReady]);

  // Sync mute toggle → media element.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      setPaused(false);
      v.play()
        .then(() => setStatus({ kind: "ready" }))
        .catch(() => setStatus({ kind: "blocked" }));
    } else {
      setPaused(true);
      v.pause();
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  }, []);

  const jumpToLive = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.seekable.length > 0) v.currentTime = v.seekable.end(v.seekable.length - 1);
  }, []);

  // Keyboard shortcuts: space=play/pause, m=mute, f=fullscreen.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "k") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "m") setMuted((m) => !m);
      else if (e.key === "f") toggleFullscreen();
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [togglePlay, toggleFullscreen]);

  const pickLevel = (level: number) => {
    setCurrentLevel(level);
    if (hlsRef.current) hlsRef.current.currentLevel = level;
    setShowQuality(false);
  };

  const currentHeight = currentLevel === -1 ? "Auto" : `${levels[currentLevel]?.height ?? "?"}p`;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className={`group relative aspect-video w-full overflow-hidden rounded-md bg-black ring-1 ring-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${className}`}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        onClick={togglePlay}
        className="h-full w-full cursor-pointer"
      />

      {/* Live badge (top-left) */}
      {src && status.kind !== "error" && status.kind !== "idle" && (
        <button
          type="button"
          onClick={jumpToLive}
          className="absolute left-2 top-2 flex items-center gap-1.5 rounded-md bg-red-600/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-lg ring-1 ring-white/20 transition hover:bg-red-500"
          aria-label="Jump to live edge"
        >
          <Radio className="h-3 w-3" />
          Live
        </button>
      )}

      {/* Loading / buffering overlay */}
      {(status.kind === "loading" || status.kind === "buffering") && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 text-xs text-white/90">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          {status.kind === "loading" ? "Loading stream…" : "Buffering…"}
        </div>
      )}

      {/* Click-to-play (autoplay blocked) */}
      {status.kind === "blocked" && (
        <button
          type="button"
          onClick={() => {
            const v = videoRef.current;
            if (!v) return;
            v.muted = true;
            setMuted(true);
            v.play()
              .then(() => setStatus({ kind: "ready" }))
              .catch(() => {});
          }}
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-sm text-white transition hover:bg-black/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          aria-label="Click to start playback"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/40">
            <Play className="h-7 w-7" />
          </span>
          Click to play
        </button>
      )}

      {/* Error overlay */}
      {status.kind === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-auto bg-black/85 p-4 text-center text-xs text-white">
          <AlertTriangle className="h-6 w-6 shrink-0 text-amber-400" />
          <p className="max-w-sm whitespace-pre-line text-left leading-relaxed text-white/90">
            {status.message}
          </p>
          <button
            type="button"
            onClick={retry}
            className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium ring-1 ring-white/20 transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <RotateCw className="h-3.5 w-3.5" /> Retry this stream
          </button>
        </div>
      )}

      {/* Controls bar — visible on hover / focus */}
      {src && status.kind !== "error" && (
        <div className="pointer-events-auto absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/85 via-black/50 to-transparent p-2 opacity-100 transition">
          <button
            type="button"
            onClick={togglePlay}
            className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/20 transition hover:bg-white/20 focus:outline-none focus-visible:bg-white/25 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/20 transition hover:bg-white/20 focus:outline-none focus-visible:bg-white/25 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>

          <div className="ml-auto flex items-center gap-2">
            {levels.length > 1 && (
              <div className="pointer-events-auto relative">
                <button
                  type="button"
                  onClick={() => setShowQuality((s) => !s)}
                  className="flex h-8 items-center gap-1.5 rounded-full bg-white/10 px-2.5 text-[11px] font-medium text-white ring-1 ring-white/20 transition hover:bg-white/20 focus:outline-none focus-visible:bg-white/25 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                  aria-label="Video quality"
                  aria-haspopup="menu"
                  aria-expanded={showQuality}
                >
                  <Settings className="h-3.5 w-3.5" />
                  {currentHeight}
                </button>
                {showQuality && (
                  <div
                    role="menu"
                    className="absolute bottom-full right-0 mb-2 min-w-[120px] overflow-hidden rounded-md border border-white/10 bg-black/95 py-1 text-[11px] shadow-xl"
                  >
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={currentLevel === -1}
                      onClick={() => pickLevel(-1)}
                      className={`block w-full px-3 py-1.5 text-left text-white transition hover:bg-white/10 focus:outline-none focus-visible:bg-primary/30 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary ${
                        currentLevel === -1 ? "font-semibold text-primary" : ""
                      }`}
                    >
                      Auto
                    </button>
                    {levels.map((lv, i) => (
                      <button
                        key={`${lv.height}-${i}`}
                        type="button"
                        role="menuitemradio"
                        aria-checked={currentLevel === i}
                        onClick={() => pickLevel(i)}
                        className={`block w-full px-3 py-1.5 text-left text-white transition hover:bg-white/10 focus:outline-none focus-visible:bg-primary/30 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary ${
                          currentLevel === i ? "font-semibold text-primary" : ""
                        }`}
                      >
                        {lv.height ? `${lv.height}p` : `${Math.round(lv.bitrate / 1000)} kbps`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={toggleFullscreen}
              className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/20 transition hover:bg-white/20 focus:outline-none focus-visible:bg-white/25 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              aria-label="Fullscreen"
            >
              <Maximize className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
