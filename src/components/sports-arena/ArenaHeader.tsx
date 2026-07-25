import { useRef, useState } from "react";
import { Play, Users } from "lucide-react";
import { HowToPlayDialog } from "./HowToPlayDialog";

export type ArenaHeaderProps = {
  liveGames?: number;
  viewers?: number;
  onHowToPlay?: () => void;
};

export function ArenaHeader({
  liveGames = 4,
  viewers = 1248,
  onHowToPlay,
}: ArenaHeaderProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (!v) {
      // Restore focus to the trigger after close for accessibility.
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  };

  return (
    <div className="relative mb-4 flex flex-col items-center gap-3 pt-2 sm:mb-6 sm:gap-4 sm:pt-4 lg:flex-row lg:justify-between">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[image:var(--gradient-arena-glow)]" />

      <div className="hidden lg:block lg:w-[180px]" />

      <div className="text-center">
        <h1 className="font-display text-[28px] font-extrabold uppercase leading-tight tracking-tight text-arena-gradient sm:text-5xl lg:text-6xl">
          Sports Arena
        </h1>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/85 sm:mt-3 sm:gap-x-5 sm:gap-y-2 sm:text-[13px]">
          <span className="inline-flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-70" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-live" />
            </span>
            <span className="text-live">Live Now</span>
          </span>
          <span className="text-white/25">|</span>
          <span>{liveGames} Games Live</span>
          <span className="text-white/25">|</span>
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-4 w-4 text-white/70" />
            {viewers.toLocaleString()}
          </span>
        </div>
      </div>

      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          onHowToPlay?.();
          setOpen(true);
        }}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-2 rounded-lg border border-arena-border bg-arena-panel/70 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-white transition hover:border-arena-violet hover:bg-arena-panel sm:px-4 sm:py-2.5 sm:text-xs"
      >
        <Play className="h-3.5 w-3.5" />
        How to Play
      </button>

      <HowToPlayDialog open={open} onOpenChange={handleOpenChange} />

    </div>
  );
}
