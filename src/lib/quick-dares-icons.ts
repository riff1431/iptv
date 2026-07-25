import {
  Shield,
  Scissors,
  Star,
  Flame,
  Heart,
  Zap,
  Sparkles,
  Crown,
  Camera,
  Music,
  Smile,
  Gift,
  type LucideIcon,
} from "lucide-react";

/**
 * Icon keys admins can pick from when creating a Quick Dare.
 * Add a new entry here + a matching lucide import to expand the palette.
 * Keep keys lowercase and stable — they are stored in the database.
 */
export const QUICK_DARE_ICONS: Record<string, LucideIcon> = {
  shield: Shield,
  scissors: Scissors,
  star: Star,
  flame: Flame,
  heart: Heart,
  zap: Zap,
  sparkles: Sparkles,
  crown: Crown,
  camera: Camera,
  music: Music,
  smile: Smile,
  gift: Gift,
};

export const QUICK_DARE_ICON_KEYS = Object.keys(QUICK_DARE_ICONS) as Array<
  keyof typeof QUICK_DARE_ICONS
>;

export function quickDareIcon(key: string | null | undefined): LucideIcon {
  if (!key) return Shield;
  return QUICK_DARE_ICONS[key] ?? Shield;
}

export function formatDarePrice(cents: number): string {
  const dollars = cents / 100;
  // Whole-dollar amounts render as $5, non-whole as $5.50.
  return Number.isInteger(dollars)
    ? `$${dollars}`
    : `$${dollars.toFixed(2)}`;
}
