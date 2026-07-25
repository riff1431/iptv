import { useAdScheduler } from "@/hooks/useAdScheduler";
import { AdBreakOverlay } from "./AdBreakOverlay";
import { LoungeGrid } from "./LoungeGrid";

export type LoungeGridWithAdsProps = {
  loungeId: string;
  activeSlot: number | null;
  onActiveSlotChange: (slot: number) => void;
  /** Only schedule ad breaks after the user has paid entry or is in preview. */
  adsEnabled: boolean;
};

/**
 * Composes the 4-TV grid with the scheduled ad break overlay. When a break
 * fires, every underlying tile pauses and the MP4s in the queue play back-to-back
 * before the streams resume automatically.
 */
export function LoungeGridWithAds({
  loungeId,
  activeSlot,
  onActiveSlotChange,
  adsEnabled,
}: LoungeGridWithAdsProps) {
  const scheduler = useAdScheduler(loungeId, adsEnabled);

  return (
    <div className="relative">
      <LoungeGrid
        loungeId={loungeId}
        activeSlot={activeSlot}
        onActiveSlotChange={onActiveSlotChange}
        paused={scheduler.playing}
      />
      {scheduler.playing && scheduler.current && (
        <AdBreakOverlay
          ad={scheduler.current}
          index={scheduler.index}
          total={scheduler.total}
          onEnded={scheduler.advance}
          onSkip={scheduler.skip}
        />
      )}
    </div>
  );
}
