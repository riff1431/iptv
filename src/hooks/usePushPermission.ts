import { useCallback, useEffect, useMemo, useState } from "react";

export type PushPermission = "unsupported" | "default" | "granted" | "denied";

function read(): PushPermission {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission as PushPermission;
}

/**
 * Tracks the browser's Notification permission state and exposes a request
 * helper. Values: "unsupported" (no browser API), "default" (not yet asked),
 * "granted", or "denied".
 */
export function usePushPermission() {
  const [permission, setPermission] = useState<PushPermission>(() => read());

  useEffect(() => {
    setPermission(read());
    if (typeof navigator === "undefined" || !("permissions" in navigator)) {
      return;
    }
    let status: PermissionStatus | null = null;
    let cancelled = false;
    const handler = () => setPermission(read());
    navigator.permissions
      .query({ name: "notifications" as PermissionName })
      .then((s: PermissionStatus) => {
        if (cancelled) return;
        status = s;
        status.addEventListener("change", handler);
      })
      .catch(() => {
        /* older browsers: ignore */
      });
    return () => {
      cancelled = true;
      if (status) status.removeEventListener("change", handler);
    };
  }, []);

  const request = useCallback(async (): Promise<PushPermission> => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return "unsupported";
    }
    try {
      const result = await Notification.requestPermission();
      const next = result as PushPermission;
      setPermission(next);
      return next;
    } catch {
      const cur = read();
      setPermission(cur);
      return cur;
    }
  }, []);

  const showTest = useCallback((title: string, body?: string) => {
    if (typeof window === "undefined" || !("Notification" in window)) return false;
    if (Notification.permission !== "granted") return false;
    try {
      new Notification(title, { body });
      return true;
    } catch {
      return false;
    }
  }, []);

  return useMemo(
    () => ({
      permission,
      supported: permission !== "unsupported",
      granted: permission === "granted",
      denied: permission === "denied",
      request,
      showTest,
    }),
    [permission, request, showTest],
  );
}
