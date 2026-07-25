import { redirect } from "@tanstack/react-router";
import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAdminAccess } from "@/lib/admin-audit.functions";

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
  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData.session?.user ?? null;
  if (!user) {
    // Not signed in — no session to audit against; just redirect.
    throw redirect({ to: "/auth", search: { redirect: location.href } });
  }
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: user.id,
    _role: "admin",
  });
  if (error || !data) {
    // Fire-and-forget so navigation isn't blocked by the audit write.
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
