import { useEffect, useRef } from "react";
import { SkipForward } from "lucide-react";
import type { ScheduledAd } from "@/hooks/useAdScheduler";

export type AdBreakOverlayProps = {
  ad: ScheduledAd;
  index: number;
  total: number;
  onEnded: () => void;
  onSkip?: () => void;
};

/**
 * Full-cover MP4 overlay played during scheduled ad breaks. The parent
 * pauses the underlying HLS grid while this is mounted.
 */
export function AdBreakOverlay({ ad, index, total, onEnded, onSkip }: AdBreakOverlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Force a fresh load whenever the ad in the queue changes.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.load();
    void v.play().catch(() => {});
  }, [ad.id]);

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black">
      <video
        ref={videoRef}
        src={ad.url}
        autoPlay
        playsInline
        controls={false}
        onEnded={onEnded}
        onError={onEnded}
        className="h-full w-full object-contain"
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-4">
        <span className="rounded-md bg-primary/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-primary-foreground">
          Ad Break · {index + 1}/{total}
        </span>
        <span className="truncate rounded-md bg-background/70 px-2 py-1 text-xs font-medium text-foreground backdrop-blur">
          {ad.title}
        </span>
      </div>
      {onSkip && (
        <button
          onClick={onSkip}
          className="absolute bottom-4 right-4 inline-flex items-center gap-1.5 rounded-md bg-background/80 px-3 py-1.5 text-xs font-semibold text-foreground backdrop-blur hover:bg-background"
        >
          <SkipForward className="h-3.5 w-3.5" /> Skip
        </button>
      )}
    </div>
  );
}
