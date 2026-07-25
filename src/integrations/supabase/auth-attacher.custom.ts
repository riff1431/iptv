// Project-specific replacement for the generated `attachSupabaseAuth`.
//
// Hardened behavior vs. the generated version:
//   1. Proactively refreshes the Supabase session when the access token has
//      expired or is within 30 s of expiring, so long-idle tabs don't fire
//      RPCs with a dead token that the server would reject.
//   2. Falls back to `refreshSession()` when `getSession()` returns null but
//      a refresh token is persisted (e.g. right after a hard nav/hydration).
//   3. Never throws from the client middleware — if we still can't produce a
//      token, we call `next()` with no `Authorization` header and let the
//      server return a clean 401 that the caller can handle.
//
// Registered as a `functionMiddleware` in `src/start.ts` in place of the
// generated attacher.

import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "./client";

const REFRESH_SKEW_SECONDS = 30;

async function getFreshAccessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const session = data.session;

    if (session?.access_token) {
      const expiresAt = session.expires_at ?? 0;
      const nowSec = Math.floor(Date.now() / 1000);
      if (expiresAt - nowSec > REFRESH_SKEW_SECONDS) {
        return session.access_token;
      }
      // Expired or expiring soon — try to refresh once before giving up.
      const { data: refreshed } = await supabase.auth.refreshSession();
      return refreshed.session?.access_token ?? session.access_token;
    }

    // No session in memory — a persisted refresh token may still recover one.
    const { data: refreshed } = await supabase.auth.refreshSession();
    return refreshed.session?.access_token ?? null;
  } catch {
    // Any failure here means "signed out"; do not throw from client middleware.
    return null;
  }
}

export const attachSupabaseAuthHardened = createMiddleware({
  type: "function",
}).client(async ({ next }) => {
  const token = await getFreshAccessToken();
  return next({
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
});
