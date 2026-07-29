import { redirect } from "@tanstack/react-router";
import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAdminAccess } from "@/lib/admin-audit.functions";
import { retryTransient } from "@/lib/transient-retry";

const ADMIN_GUARD_ATTEMPTS = 3;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }
  return String(error ?? "");
}

/**
 * Only transport failures are retried. Permission and credential failures
 * remain final so retrying can never weaken the admin authorization check.
 */
export function isTransientAdminGuardError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "").toUpperCase()
      : "";

  return (
    error instanceof TypeError ||
    /failed to fetch|network|timeout|timed out|abort|temporar|connection|lock/.test(message) ||
    /^(PGRST000|PGRST001|PGRST002|502|503|504)$/.test(code)
  );
}

async function readSessionForAdminGuard() {
  return retryTransient(
    async () => {
      const result = await supabase.auth.getSession();
      if (result.error) {
        if (isTransientAdminGuardError(result.error)) throw result.error;
        return null;
      }
      return result.data.session ?? null;
    },
    { attempts: ADMIN_GUARD_ATTEMPTS, shouldRetry: isTransientAdminGuardError },
  );
}

async function checkAdminRole(userId: string) {
  return retryTransient(
    async () => {
      const result = await supabase.rpc("has_role", {
        _user_id: userId,
        _role: "admin",
      });
      if (result.error && isTransientAdminGuardError(result.error)) throw result.error;
      return result;
    },
    { attempts: ADMIN_GUARD_ATTEMPTS, shouldRetry: isTransientAdminGuardError },
  );
}

/**
 * Client-side route guard for admin-only routes.
 * Call from `beforeLoad` in any protected route (or pathless layout).
 * Redirects to /auth when signed out, /forbidden when not an admin.
 * Fires a server-side audit log entry for both allowed access and denials.
 */
export async function requireAdminRoute({
  location,
}: {
  location: { href: string; pathname: string };
}) {
  const session = await readSessionForAdminGuard();
  const user = session?.user ?? null;
  if (!user) {
    throw redirect({ to: "/auth", search: { redirect: location.href } });
  }
  const { data, error } = await checkAdminRole(user.id);
  if (error || !data) {
    void logAdminAccess({
      data: {
        action: "admin_denied",
        path: location.pathname,
        reason: error?.message ?? "not_admin",
      },
    }).catch((err) => console.warn("audit log (denied) failed", err));
    throw redirect({ to: "/forbidden", search: { from: location.pathname } });
  }
  void logAdminAccess({
    data: { action: "admin_access", path: location.pathname },
  }).catch((err) => console.warn("audit log (access) failed", err));
  return { userId: user.id };
}

/**
 * Server-function middleware enforcing admin role.
 * Extends `requireSupabaseAuth` — handlers receive `context.supabase`,
 * `context.userId`, `context.claims` as usual.
 */
export const requireAdminServer = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { data, error } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Forbidden: admin role required");
    return next();
  });
