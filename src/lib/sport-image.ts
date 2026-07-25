import basketball from "@/assets/sport-basketball.jpg";
import soccer from "@/assets/sport-soccer.jpg";
import combat from "@/assets/sport-combat.jpg";
import hockey from "@/assets/sport-hockey.jpg";
import defaultImg from "@/assets/sport-default.jpg";

/**
 * Map an arbitrary sport label (NBA, EPL, La Liga, UFC, Boxing, …) to a
 * cinematic default background image. Falls back to a generic stadium.
 */
export function sportImage(sport: string): string {
  const s = sport.toLowerCase();
  if (/(nba|basket)/.test(s)) return basketball;
  if (/(soccer|football|epl|la liga|serie a|mls|bundesliga|ligue|pitch)/.test(s)) return soccer;
  if (/(ufc|mma|boxing|kickbox|fight)/.test(s)) return combat;
  if (/(nhl|hockey|ice)/.test(s)) return hockey;
  return defaultImg;
}
