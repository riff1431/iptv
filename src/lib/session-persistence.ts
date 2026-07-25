/**
 * "Remember me" session persistence.
 *
 * Supabase's client always writes to localStorage. To make the session
 * expire when the browser fully closes (all tabs), we mirror the auth
 * token into sessionStorage on `pagehide` and remove it from
 * localStorage; on next load we restore it before the client boots.
 *
 * A sessionStorage entry survives page reloads within the same tab but
 * dies when the tab/browser is closed — exactly the semantics we want
 * for "don't remember me".
 */

const REMEMBER_KEY = "pgx_remember_me";
const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined;
const AUTH_KEY = PROJECT_ID ? `sb-${PROJECT_ID}-auth-token` : null;
const STASH_KEY = "pgx_ephemeral_auth_token";

export function getRememberMe(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(REMEMBER_KEY) !== "false";
}

export function setRememberMe(remember: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(REMEMBER_KEY, remember ? "true" : "false");
}

let installed = false;

/** Call once before the Supabase client is first accessed. */
export function installSessionPersistence() {
  if (installed || typeof window === "undefined" || !AUTH_KEY) return;
  installed = true;

  // Restore any ephemeral token stashed on the previous pagehide so the
  // Supabase client picks it up when it reads localStorage.
  try {
    const stashed = window.sessionStorage.getItem(STASH_KEY);
    if (stashed && !window.localStorage.getItem(AUTH_KEY)) {
      window.localStorage.setItem(AUTH_KEY, stashed);
    }
  } catch {
    /* storage may be unavailable in some contexts */
  }

  const onHide = () => {
    try {
      if (getRememberMe()) return;
      const token = window.localStorage.getItem(AUTH_KEY);
      if (!token) {
        window.sessionStorage.removeItem(STASH_KEY);
        return;
      }
      window.sessionStorage.setItem(STASH_KEY, token);
      window.localStorage.removeItem(AUTH_KEY);
    } catch {
      /* ignore */
    }
  };

  window.addEventListener("pagehide", onHide);
}

/** Clear ephemeral state on sign-out. */
export function clearEphemeralSession() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STASH_KEY);
  } catch {
    /* ignore */
  }
}
