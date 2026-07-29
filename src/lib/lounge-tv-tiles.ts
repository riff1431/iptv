import type { PublicTv } from "@/lib/lounges.public.functions";

export type LobbyTvTile = {
  slot: number;
  /** False when no enabled TV exists at this slot (render a placeholder). */
  configured: boolean;
  channelLogo: string | null;
  /** Sport label used to derive a backdrop via sportImage() when no logo. */
  sport: string;
  matchup: string;
  displayName: string | null;
  hasScore: boolean;
  homeLabel: string | null;
  awayLabel: string | null;
  homeScore: number;
  awayScore: number;
};

const SLOTS = [1, 2, 3, 4] as const;

/**
 * Build a fixed-length-4 list of TV tile descriptors for a lobby card collage.
 *
 * The public lounges query already filters `tvs` to `enabled = true` and sorts
 * by slot ascending, but we match by slot explicitly (defensive) and ALWAYS
 * emit exactly slots 1→4. Missing slots become `configured:false` "Not
 * configured" cells so the 4-wide collage never breaks, regardless of how many
 * TVs a lounge has. This slot-ordered output is also what makes the fan-side
 * TV1–TV4 order match the admin grid.
 */
export function getLoungeTvTiles(tvs: PublicTv[]): LobbyTvTile[] {
  const bySlot = new Map<number, PublicTv>();
  for (const tv of tvs) bySlot.set(tv.slot, tv);

  return SLOTS.map((slot) => {
    const tv = bySlot.get(slot);
    if (!tv) {
      return {
        slot,
        configured: false,
        channelLogo: null,
        sport: "",
        matchup: "",
        displayName: null,
        hasScore: false,
        homeLabel: null,
        awayLabel: null,
        homeScore: 0,
        awayScore: 0,
      };
    }
    const hasScore = Boolean(tv.home_label || tv.away_label);
    return {
      slot,
      configured: true,
      channelLogo: tv.channel_logo,
      sport: tv.sport,
      matchup: tv.matchup,
      displayName: tv.display_name,
      hasScore,
      homeLabel: tv.home_label,
      awayLabel: tv.away_label,
      homeScore: tv.home_score,
      awayScore: tv.away_score,
    };
  });
}
