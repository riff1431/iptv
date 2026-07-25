// Pure helpers for resetting a saved arena slot selection.
// Extracted so behavior can be unit-tested without rendering the route.

const STORAGE_KEY = "arena.activeSlot";

export function clearMatchSlotLocal(matchId: string): void {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) || "{}";
    const parsed = JSON.parse(raw);
    delete parsed[matchId];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    /* ignore */
  }
}

export function firstEnabledSlot(
  enabledSlots: ReadonlyArray<{ slot: number }>,
): number | null {
  return enabledSlots[0]?.slot ?? null;
}

export interface ResetMatchSlotOptions {
  matchId: string;
  enabledSlots: ReadonlyArray<{ slot: number }>;
  isAuthenticated: boolean;
  clearServerPref: (matchId: string) => Promise<void>;
}

export interface ResetMatchSlotResult {
  nextSlot: number | null;
  serverCleared: boolean;
}

/**
 * Reset a match's saved slot preference:
 *  - always clears the localStorage entry for the match
 *  - clears the server preference when authenticated (best-effort)
 *  - returns the first enabled slot as the new active slot
 */
export async function resetMatchSlot(
  options: ResetMatchSlotOptions,
): Promise<ResetMatchSlotResult> {
  const { matchId, enabledSlots, isAuthenticated, clearServerPref } = options;
  clearMatchSlotLocal(matchId);
  let serverCleared = false;
  if (isAuthenticated) {
    try {
      await clearServerPref(matchId);
      serverCleared = true;
    } catch {
      /* best-effort; localStorage still holds the cleared value */
    }
  }
  return { nextSlot: firstEnabledSlot(enabledSlots), serverCleared };
}
