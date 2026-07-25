import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import type { Notification } from "@/hooks/useNotifications";
import {
  getMyNotifPrefs,
  saveMyNotifPrefs,
} from "@/lib/notif-prefs.functions";

export type NotifPrefKey =
  | "hostedMatches"
  | "liveLobbies"
  | "walletChanges"
  | "tips"
  | "friendRequests"
  | "system";

export type QuietHours = {
  enabled: boolean;
  /** 24h wall-clock, "HH:MM" in the given timezone. */
  start: string;
  end: string;
  /** IANA timezone id (e.g. "America/New_York"). */
  timezone: string;
};

export type NotifPrefs = {
  channels: { inApp: boolean; email: boolean; push: boolean };
  categories: Record<NotifPrefKey, boolean>;
  quietHours: QuietHours;
};

/** Best-effort local IANA zone; falls back to UTC on very old runtimes. */
export function detectTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && typeof tz === "string") return tz;
  } catch {
    /* ignore */
  }
  return "UTC";
}

const DEFAULT_QUIET: QuietHours = {
  enabled: false,
  start: "22:00",
  end: "08:00",
  timezone: detectTimezone(),
};

export const DEFAULT_PREFS: NotifPrefs = {
  channels: { inApp: true, email: true, push: false },
  categories: {
    hostedMatches: true,
    liveLobbies: true,
    walletChanges: true,
    tips: true,
    friendRequests: true,
    system: false,
  },
  quietHours: DEFAULT_QUIET,
};

const storageKey = (userId: string | undefined | null) =>
  `pgx.notif.prefs.${userId ?? "anon"}`;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
function normalizeHHMM(v: unknown, fallback: string): string {
  return typeof v === "string" && HHMM.test(v) ? v : fallback;
}

function normalizeQuiet(v: unknown): QuietHours {
  // Back-compat: old prefs stored quietHours as a plain boolean.
  if (typeof v === "boolean") {
    return { ...DEFAULT_QUIET, enabled: v };
  }
  if (v && typeof v === "object") {
    const q = v as Partial<QuietHours>;
    return {
      enabled: !!q.enabled,
      start: normalizeHHMM(q.start, DEFAULT_QUIET.start),
      end: normalizeHHMM(q.end, DEFAULT_QUIET.end),
      timezone:
        typeof q.timezone === "string" && q.timezone.length
          ? q.timezone
          : DEFAULT_QUIET.timezone,
    };
  }
  return DEFAULT_QUIET;
}

function normalize(parsed: Partial<NotifPrefs> | null | undefined): NotifPrefs {
  return {
    channels: { ...DEFAULT_PREFS.channels, ...(parsed?.channels ?? {}) },
    categories: {
      ...DEFAULT_PREFS.categories,
      ...(parsed?.categories ?? {}),
    },
    quietHours: normalizeQuiet(parsed?.quietHours),
  };
}

/** Read the current prefs synchronously (used off of React state). */
export function readNotifPrefs(userId: string | undefined | null): NotifPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return DEFAULT_PREFS;
    return normalize(JSON.parse(raw) as Partial<NotifPrefs>);
  } catch {
    return DEFAULT_PREFS;
  }
}

const CHANGE_EVENT = "pgx:notif-prefs-changed";

type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Persistent notification preferences for the current user. Prefs live in the
 * backend (`user_notification_prefs`) so they follow the user across devices.
 * localStorage is used only as an offline hydration cache for instant render
 * and to survive brief network loss. Emits a window event on change so peer
 * hooks (like useNotifications) can re-read without prop drilling.
 */
export function useNotifPrefs(userId: string | undefined | null) {
  const key = storageKey(userId);
  const [prefs, setPrefsState] = useState<NotifPrefs>(DEFAULT_PREFS);
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const load = useServerFn(getMyNotifPrefs);
  const save = useServerFn(saveMyNotifPrefs);
  // useServerFn returns a fresh function reference every render. Pin the
  // latest versions in refs so effects below can call them without listing
  // them as deps (which would re-run the effects on every render and
  // trigger "Maximum update depth exceeded").
  const loadRef = useRef(load);
  const saveRef = useRef(save);
  useEffect(() => {
    loadRef.current = load;
    saveRef.current = save;
  }, [load, save]);

  // Track the last-saved snapshot so we only PUT on real changes (avoid
  // echoing the value we just hydrated from the server).
  const lastPersistedRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);


  // Hydrate: cache-first for instant render, then reconcile with the server.
  useEffect(() => {
    let cancelled = false;
    setHydrated(false);
    const cached = readNotifPrefs(userId);
    setPrefsState(cached);

    if (!userId) {
      // Anonymous — no backend row; localStorage is the source of truth.
      lastPersistedRef.current = JSON.stringify(cached);
      setHydrated(true);
      return;
    }

    (async () => {
      try {
        const res = await loadRef.current();
        if (cancelled) return;
        const remote = res?.prefs ? normalize(res.prefs as Partial<NotifPrefs>) : null;
        const next = remote ?? cached;
        setPrefsState(next);
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        lastPersistedRef.current = JSON.stringify(next);
        if (res?.updatedAt) setLastSyncedAt(res.updatedAt);
      } catch {
        // Network / auth blip: keep the cached copy; we'll retry on next change.
        lastPersistedRef.current = JSON.stringify(cached);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [key, userId]);


  // Persist changes: mirror to localStorage immediately, debounce backend save.
  useEffect(() => {
    if (!hydrated) return;
    const serialized = JSON.stringify(prefs);
    try {
      localStorage.setItem(key, serialized);
      window.dispatchEvent(
        new CustomEvent(CHANGE_EVENT, { detail: { userId } }),
      );
    } catch {
      /* ignore */
    }

    if (!userId) return; // anonymous — nothing to sync
    if (lastPersistedRef.current === serialized) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus("saving");
    setSaveError(null);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await saveRef.current({ data: { prefs: prefs as never } });
        lastPersistedRef.current = serialized;
        setLastSyncedAt(new Date().toISOString());
        setSaveStatus("saved");
      } catch (err) {
        setSaveStatus("error");
        setSaveError(err instanceof Error ? err.message : "Failed to save");
      }
    }, 450);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [key, prefs, hydrated, userId]);


  // Cross-tab / cross-hook sync
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) setPrefsState(readNotifPrefs(userId));
    };
    const onLocal = (e: Event) => {
      const detail = (e as CustomEvent<{ userId?: string | null }>).detail;
      if (!detail || detail.userId === userId)
        setPrefsState(readNotifPrefs(userId));
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(CHANGE_EVENT, onLocal as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CHANGE_EVENT, onLocal as EventListener);
    };
  }, [key, userId]);

  const retrySave = useCallback(async () => {
    if (!userId) return;
    setSaveStatus("saving");
    setSaveError(null);
    try {
      await saveRef.current({ data: { prefs: prefs as never } });
      lastPersistedRef.current = JSON.stringify(prefs);
      setLastSyncedAt(new Date().toISOString());
      setSaveStatus("saved");
    } catch (err) {
      setSaveStatus("error");
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    }

  }, [prefs, userId]);

  return {
    prefs,
    setPrefs: setPrefsState,
    hydrated,
    saveStatus,
    saveError,
    lastSyncedAt,
    retrySave,
  };
}

/** True if the notification should be delivered under current prefs. */
export function notificationAllowed(
  n: Pick<Notification, "kind" | "title" | "body" | "link">,
  prefs: NotifPrefs,
): boolean {
  const cat = categoryFor(n);
  if (!cat) return true; // unknown kinds always allowed
  return prefs.categories[cat] ?? true;
}

/** Map a notification to a pref category, or null if it isn't gated. */
export function categoryFor(
  n: Pick<Notification, "kind" | "title" | "body" | "link">,
): NotifPrefKey | null {
  const text = `${n.title ?? ""} ${n.body ?? ""} ${n.link ?? ""}`.toLowerCase();
  switch (n.kind) {
    case "wallet":
      if (/\btip(s|ped|ping)?\b/.test(text) || text.includes("tip:")) {
        return "tips";
      }
      return "walletChanges";
    case "lounge":
      // Hosted-match updates live in the same "lounge" kind; if either
      // toggle is on we allow it. Return the one currently enabled so the
      // caller's simple lookup does the right thing.
      // (Falls back to hostedMatches so a fresh install still shows them.)
      return "hostedMatches";
    case "message":
      return "friendRequests";
    case "system":
    case "admin":
      return "system";
    default:
      return null;
  }
}

/** Minutes since midnight for a "HH:MM" string. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((s) => parseInt(s, 10));
  return (h || 0) * 60 + (m || 0);
}

/**
 * Wall-clock hour+minute in the given timezone, right now. Uses
 * Intl.DateTimeFormat so DST transitions are respected automatically —
 * we always ask what the clock reads in that zone at this instant.
 */
function wallClockMinutes(now: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    const m = parseInt(
      parts.find((p) => p.type === "minute")?.value ?? "0",
      10,
    );
    return h * 60 + m;
  } catch {
    // Invalid timezone → fall back to local wall clock.
    return now.getHours() * 60 + now.getMinutes();
  }
}

/**
 * True when the current instant falls inside the quiet-hours window,
 * evaluated in the user's chosen timezone. Handles overnight ranges
 * (start > end wraps midnight) and edge cases:
 *   - start === end and enabled → treated as "off" (empty window)
 *   - equal start-of-window is inclusive; end is exclusive
 *   - DST spring-forward / fall-back: covered by asking Intl what the
 *     wall clock reads at this real instant in the target zone.
 */
export function isQuietHourNow(
  quiet: QuietHours,
  now: Date = new Date(),
): boolean {
  if (!quiet.enabled) return false;
  const startMin = toMinutes(quiet.start);
  const endMin = toMinutes(quiet.end);
  if (startMin === endMin) return false;
  const nowMin = wallClockMinutes(now, quiet.timezone);
  return startMin < endMin
    ? nowMin >= startMin && nowMin < endMin // same-day window
    : nowMin >= startMin || nowMin < endMin; // overnight wrap
}

/**
 * Delivery decision for a freshly-arrived notification: filter by category
 * (with the lounge OR-rule), quiet hours, and in-app channel. Returns
 * true when a toast/badge should surface it.
 */
export function shouldDeliverInApp(
  n: Pick<Notification, "kind" | "title" | "body" | "link">,
  prefs: NotifPrefs,
): boolean {
  if (!prefs.channels.inApp) return false;

  // Lounge notifications are gated by BOTH hostedMatches and liveLobbies.
  if (n.kind === "lounge") {
    if (!prefs.categories.hostedMatches && !prefs.categories.liveLobbies) {
      return false;
    }
  } else if (!notificationAllowed(n, prefs)) {
    return false;
  }

  // Quiet hours mute non-urgent categories. Wallet/tips are urgent.
  if (isQuietHourNow(prefs.quietHours)) {
    const cat = categoryFor(n);
    const urgent = cat === "walletChanges" || cat === "tips";
    if (!urgent) return false;
  }

  return true;
}
