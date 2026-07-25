import type { CSSProperties } from "react";

/**
 * Live scoreboard strip rendered at the bottom of a TV tile. Data comes
 * from the `tvs` row (admin-editable via /admin/tvs) and updates in real
 * time through the `tvs` realtime subscription.
 */
export type TvScoreTeam = {
  code: string;
  score: number | string;
  /** Tailwind background class (e.g. `bg-arena-panel-2/80`). Ignored when `bgStyle` is set. */
  color?: string;
  /** Inline style for arbitrary hex/oklch team colors from admin input. */
  bgStyle?: CSSProperties;
};

export type TvScore = {
  home?: TvScoreTeam;
  away?: TvScoreTeam;
  period?: string;
  clock?: string;
  extra?: string;
};

/**
 * Legacy helper — kept so any older caller that still infers a demo
 * scoreboard from a sport label keeps compiling. Real overlays are now
 * built from the `tvs` row inside `LoungeGrid`.
 */
export function scoreForSport(_label: string | null | undefined): TvScore | null {
  return null;
}

export function TvScoreOverlay({ score }: { score: TvScore }) {
  const { home, away, period, clock, extra } = score;
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-3 flex max-w-[calc(100%-1.5rem)] flex-wrap items-stretch overflow-hidden rounded-md bg-black/85 text-[11px] font-bold text-white shadow-lg ring-1 ring-white/10 sm:text-xs">
      {home && (
        <div
          className={`flex items-center gap-1.5 px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2 ${home.color ?? "bg-white/10"}`}
          style={home.bgStyle}
        >
          <span className="tracking-wider">{home.code}</span>
          <span className="text-sm sm:text-base">{home.score}</span>
        </div>
      )}
      {away && (
        <div
          className={`flex items-center gap-1.5 px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2 ${away.color ?? "bg-white/10"}`}
          style={away.bgStyle}
        >
          <span className="tracking-wider">{away.code}</span>
          <span className="text-sm sm:text-base">{away.score}</span>
        </div>
      )}
      {period && (
        <div className="flex items-center px-2 py-1.5 tracking-wider text-white/85 sm:px-3 sm:py-2">
          {period}
        </div>
      )}
      {clock && (
        <div className="flex items-center px-2 py-1.5 tabular-nums text-white sm:px-3 sm:py-2">
          {clock}
        </div>
      )}
      {extra && (
        <div className="flex items-center bg-live px-2 py-1.5 tabular-nums text-live-foreground sm:px-3 sm:py-2">
          {extra}
        </div>
      )}
    </div>
  );
}
