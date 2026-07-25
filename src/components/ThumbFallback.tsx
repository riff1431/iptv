import type { LucideIcon } from "lucide-react";
import { ImageIcon } from "lucide-react";

type ThumbFallbackProps = {
  /** Icon to render at the center. Defaults to a generic image glyph. */
  icon?: LucideIcon;
  /** Accessible label. If omitted, the fallback is treated as decorative. */
  label?: string;
  /** Extra classes applied to the root element. */
  className?: string;
  /** Icon size preset. */
  size?: "sm" | "md" | "lg";
};

const ICON_SIZE: Record<NonNullable<ThumbFallbackProps["size"]>, string> = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-14 w-14",
};

/**
 * Site-wide default thumbnail. Rendered when a card has no image or an
 * image fails to load. Matches the homepage feature-card fallback style:
 * violet radial glow + subtle grid + centered glowing icon.
 *
 * Fills its positioned parent (`absolute inset-0`), so wrap it in a
 * relatively-positioned box with a fixed aspect ratio.
 */
export function ThumbFallback({
  icon: Icon = ImageIcon,
  label,
  className = "",
  size = "lg",
}: ThumbFallbackProps) {
  const role = label ? "img" : undefined;
  return (
    <div
      role={role}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_30%_20%,hsl(var(--arena-violet)/0.25),transparent_60%),radial-gradient(circle_at_80%_80%,hsl(var(--arena-violet)/0.15),transparent_55%)] ${className}`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(hsl(var(--arena-border)/0.6)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--arena-border)/0.6)_1px,transparent_1px)] [background-size:24px_24px]"
      />
      <Icon
        className={`relative ${ICON_SIZE[size]} text-arena-violet/70 drop-shadow-[0_0_18px_hsl(var(--arena-violet)/0.55)]`}
        strokeWidth={1.5}
      />
    </div>
  );
}

/**
 * Decorative banner header that renders a ThumbFallback inside a fixed-ratio
 * strip. Designed to sit at the top of a padded card (uses negative margins
 * to bleed to the card edges).
 *
 * `cornerIcon` opts a tile in to an additional accent circle pinned to the
 * top-right of the banner — for cards that want both the banner glyph and
 * a compact status/action icon (e.g. a state indicator distinct from the
 * banner theme). Leave undefined for the default single-icon look.
 */
export function ThumbHeader({
  icon,
  label,
  className = "",
  cornerIcon: CornerIcon,
  cornerClassName = "bg-primary/15 text-primary",
  cornerLabel,
}: {
  icon?: LucideIcon;
  label: string;
  className?: string;
  cornerIcon?: LucideIcon;
  cornerClassName?: string;
  cornerLabel?: string;
}) {
  return (
    <div
      className={`relative -mx-4 -mt-4 mb-4 aspect-[16/3] overflow-hidden border-b border-arena-border sm:-mx-5 sm:-mt-5 ${className}`}
    >
      <ThumbFallback icon={icon} label={label} size="md" />
      {CornerIcon && (
        <div
          role={cornerLabel ? "img" : undefined}
          aria-label={cornerLabel}
          aria-hidden={cornerLabel ? undefined : true}
          className={`absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg shadow-sm ${cornerClassName}`}
        >
          <CornerIcon className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}
