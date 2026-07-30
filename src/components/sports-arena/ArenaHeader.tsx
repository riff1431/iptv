import { type ReactNode, useRef, useState } from "react";
import { Play, Users } from "lucide-react";
import { HowToPlayDialog } from "./HowToPlayDialog";

export type ArenaHeaderProps = {
  liveGames?: number;
  viewers?: number;
  onHowToPlay?: () => void;
  /**
   * When provided, the header renders in a compact toolbar layout instead of
   * the big centered "Sports Arena" hero. Used on the match-watch page, where
   * the page name + a back button + live stats are all that's wanted.
   * Omit to keep the default hero (lounge / arena browse / friends).
   */
  title?: ReactNode;
  /** Optional node rendered at the start of the compact header (e.g. back button). */
  leading?: ReactNode;
};

export function ArenaHeader({
  liveGames = 4,
  viewers = 1248,
  onHowToPlay,
  title,
  leading,
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

  const howToPlayButton = (
    <button
      ref={triggerRef}
      type="button"
      onClick={() => {
        onHowToPlay?.();
        setOpen(true);
      }}
      aria-haspopup="dialog"
      className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-arena-border bg-arena-panel/70 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-white transition hover:border-arena-violet hover:bg-arena-panel sm:px-4 sm:py-2.5 sm:text-xs"
    >
      <Play className="h-3.5 w-3.5" />
      How to Play
    </button>
  );

  const statsRow = (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-center text-[11px] font-semibold uppercase tracking-wider text-white/85 sm:gap-x-5 sm:gap-y-2 sm:text-[13px]">
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
  );

  // Compact toolbar header: back + page name on top, live stats below, How to Play pinned right.
  if (title !== undefined || leading !== undefined) {
    return (
      <div className="relative mb-3 flex flex-col gap-2 pt-1 sm:mb-4 sm:gap-3 sm:pt-2">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[image:var(--gradient-arena-glow)]" />
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
          <div className="justify-self-start">{leading}</div>
          {title != null && (
            <h1 className="truncate text-center font-display text-sm font-bold uppercase tracking-[0.14em] text-white/90 sm:text-base">
              {title}
            </h1>
          )}
          <div className="justify-self-end">{howToPlayButton}</div>
        </div>
        <div className="flex justify-center">{statsRow}</div>
        <HowToPlayDialog open={open} onOpenChange={handleOpenChange} />
      </div>
    );
  }

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

      {howToPlayButton}

      <HowToPlayDialog open={open} onOpenChange={handleOpenChange} />
    </div>
  );
}
