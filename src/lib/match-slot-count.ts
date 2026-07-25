/**
 * Clamps an incoming slot_count (nullable/undefined/out-of-range) to the
 * valid admin range of 1..8 and returns the resolved integer.
 */
export function resolveSlotCount(slotCount: number | null | undefined): number {
  if (slotCount === null || slotCount === undefined) return 4;
  const n = Number(slotCount);
  if (!Number.isFinite(n)) return 4;
  return Math.max(1, Math.min(8, Math.floor(n)));
}

/**
 * Returns the 1-based slot number array for a given slot_count, e.g.
 * slotNumbers(3) === [1, 2, 3]. Used by the admin editor and list views to
 * render exactly the configured number of channel slots.
 */
export function slotNumbers(slotCount: number | null | undefined): number[] {
  const count = resolveSlotCount(slotCount);
  return Array.from({ length: count }, (_, i) => i + 1);
}

/**
 * The fixed number of tiles the arena TV view renders. Admins can configure a
 * match with any `slot_count` in 1..8, but the viewer-facing 2x2 grid always
 * shows exactly 4 tiles — extras are hidden, missing ones are placeholders.
 */
export const TV_TILE_LAYOUT_SIZE = 4 as const;

export type TvTileSlotShape = {
  slot: number;
  channelId: string | null;
  channelName: string | null;
  channelLogo: string | null;
  enabled: boolean;
};

export type TvTileLayout<T extends TvTileSlotShape> = {
  /** Exactly TV_TILE_LAYOUT_SIZE tiles, always slot 1..4 in order. */
  tiles: T[];
  /** Admin-configured slots with slot > TV_TILE_LAYOUT_SIZE, sorted by slot. */
  overflow: T[];
  /** How many placeholder tiles were synthesized to reach 4. */
  paddedCount: number;
  /** How many overflow tiles were hidden from the 4-tile view. */
  overflowCount: number;
};

/**
 * Normalize an admin-configured slot list into the fixed 4-tile TV layout.
 *
 * - Missing slots (1..4) are filled with a disabled placeholder produced by
 *   `makePlaceholder` so the grid always has exactly 4 cells.
 * - Slots numbered > 4 (from an older/larger admin config) are returned in
 *   `overflow` so callers can surface a "hidden extras" hint without breaking
 *   the 2x2 layout.
 * - Duplicate slot numbers keep the first occurrence; later ones are dropped.
 */
export function resolveTvTileLayout<T extends TvTileSlotShape>(
  slots: readonly T[],
  makePlaceholder: (slot: number) => T,
): TvTileLayout<T> {
  const bySlot = new Map<number, T>();
  for (const s of slots) {
    if (!Number.isInteger(s.slot) || s.slot < 1) continue;
    if (!bySlot.has(s.slot)) bySlot.set(s.slot, s);
  }
  const tiles: T[] = [];
  let paddedCount = 0;
  for (let n = 1; n <= TV_TILE_LAYOUT_SIZE; n++) {
    const existing = bySlot.get(n);
    if (existing) {
      tiles.push(existing);
    } else {
      tiles.push(makePlaceholder(n));
      paddedCount++;
    }
  }
  const overflow = [...bySlot.values()]
    .filter((s) => s.slot > TV_TILE_LAYOUT_SIZE)
    .sort((a, b) => a.slot - b.slot);
  return { tiles, overflow, paddedCount, overflowCount: overflow.length };
}

