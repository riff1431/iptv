import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { Maximize2, Volume2, VolumeX, RotateCcw, WifiOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SportImage } from "@/components/SportImage";

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
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;

    async function boot() {
      setLoading(true);
      setError(null);

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setError("Sign in to watch");
        setLoading(false);
        return;
      }
      if (cancelled || !video) return;

      const src = `/api/sports-arena/tv/${tvId}/playlist`;

      // Native HLS (Safari)
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
        // Safari can't set auth header on <video src>; fall through to hls.js
        // if it fails. But if the browser supports MSE we prefer hls.js anyway.
      }

      if (Hls.isSupported()) {
        const hls = new Hls({
          xhrSetup: (xhr) => {
            xhr.setRequestHeader("Authorization", `Bearer ${token}`);
          },
          liveDurationInfinity: true,
          lowLatencyMode: false,
          maxBufferLength: 20,
        });
        hlsRef.current = hls;
        hls.loadSource(src);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setLoading(false);
          void video.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_evt, data) => {
          if (!data.fatal) return;
          const httpCode = data.response?.code;
          if (httpCode === 409) {
            setError("Stream is offline");
            setLoading(false);
            hls.destroy();
            // Auto-retry every 10s so viewers reconnect once admin restarts.
            window.setTimeout(() => setAttempt((n) => n + 1), 10_000);
            return;
          }
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
          } else {
            setError("Stream error");
            setLoading(false);
          }
        });
      } else if (!video.canPlayType("application/vnd.apple.mpegurl")) {
        setError("HLS not supported in this browser");
        setLoading(false);
      } else {
        // Native path: rely on the <video>
        setLoading(false);
      }
    }

    void boot();

    return () => {
      cancelled = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
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
  const topLabel =
    sport || channelName || label.replace(/^tv\s*\d+\s*-\s*/i, "");


  const sportLabel = sport || channelName || null;
  const statusLabel = offline
    ? "offline"
    : error
      ? `error: ${error}`
      : loading
        ? "loading"
        : "live";
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
            loading || error || offline
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

      {(loading || error || offline) && (
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
                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                  Loading…
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Top-left label — sport + matchup when the admin has set them */}
      <div className="pointer-events-none absolute left-3 top-3 max-w-[70%]">
        <span className="block truncate rounded-md bg-black/70 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white/95 backdrop-blur">
          TV {slot} · {topLabel}
        </span>
        {matchup && (
          <span className="mt-1 block truncate rounded-md bg-black/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/80 backdrop-blur">
            {matchup}
          </span>
        )}
      </div>


      {/* Top-right LIVE badge */}
      <div className="pointer-events-none absolute right-3 top-3">
        <span
          className={`inline-flex h-6 items-center rounded-[6px] px-2.5 text-[11px] font-bold uppercase leading-none tracking-[0.08em] ${
            offline ? "bg-muted text-muted-foreground" : "bg-live text-live-foreground"
          }`}
        >
          {offline ? "OFF" : "LIVE"}
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
