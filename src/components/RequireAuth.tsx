import { useEffect, useRef, type FunctionComponent, type ReactNode } from "react";
import { useNavigate, useRouterState, ClientOnly } from "@tanstack/react-router";
import { Loader2, ShieldCheck } from "lucide-react";
import { useAuth, type AppRole } from "@/hooks/useAuth";

interface RequireAuthProps {
  children: ReactNode;
  /** Optional role gate. If set, non-matching users are sent to /forbidden. */
  role?: AppRole;
}

/**
 * Client-side route guard.
 * - While auth state is loading, renders a full-page loader (prevents
 *   protected content from flashing before the redirect fires).
 * - If no user, redirects to /auth with the current URL as `redirect`.
 * - If `role` is set and the user lacks it, redirects to /forbidden.
 */
// Cap the round-tripped redirect to keep URLs sane and stop hostile / runaway
// input from ballooning the `/auth?redirect=…` query string.
const MAX_REDIRECT_LENGTH = 512;

/**
 * Build the value we hand to `/auth?redirect=…`.
 * - Same-origin only (never leak an absolute URL to another host).
 * - Preserves pathname + search + hash so the user lands exactly where they
 *   were after signing in.
 * - Refuses to nest: if we're already on `/auth` or the current URL already
 *   carries a `redirect` param, fall back to `/` so we don't stack params.
 * - Enforces a hard length cap.
 */
function buildRedirectTarget(pathname: string, search: string, hash: string): string {
  if (pathname === "/auth" || pathname.startsWith("/auth/")) return "/";

  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (params.has("redirect")) return "/";

  // TanStack's `location.hash` and `location.searchStr` do not include their
  // leading separators, so re-add them before concatenating.
  const searchPart = search ? (search.startsWith("?") ? search : `?${search}`) : "";
  const hashPart = hash ? (hash.startsWith("#") ? hash : `#${hash}`) : "";
  const target = `${pathname}${searchPart}${hashPart}`;
  if (!target.startsWith("/") || target.startsWith("//")) return "/";
  if (target.length > MAX_REDIRECT_LENGTH) return pathname.slice(0, MAX_REDIRECT_LENGTH);
  return target;
}

function RequireAuthInner({ children, role }: RequireAuthProps) {
  const { user, loading, roles, isAdmin } = useAuth();
  const navigate = useNavigate();
  // Read pathname (not href) so a redirect that only changes search params
  // doesn't retrigger this effect. Also guard with a ref so we only fire
  // the redirect once per mount — otherwise, if this component stays
  // mounted during a route exit animation (AnimatePresence), the effect
  // could re-fire and stack `?redirect=` params into an infinite loop.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // We deliberately capture search/hash into a ref rather than as effect deps:
  // navigating away naturally changes them, and we don't want that to retrigger
  // the guard. The values snapshotted at mount are what the user actually
  // requested.
  const search = useRouterState({ select: (s) => s.location.searchStr ?? "" });
  const hash = useRouterState({ select: (s) => s.location.hash ?? "" });
  const capturedTargetRef = useRef<string | null>(null);
  if (capturedTargetRef.current === null) {
    capturedTargetRef.current = buildRedirectTarget(pathname, search, hash);
  }
  const redirectedRef = useRef(false);

  const hasRole = role ? (role === "admin" ? isAdmin : roles.includes(role)) : true;

  useEffect(() => {
    if (loading) return;
    if (redirectedRef.current) return;
    if (!user) {
      redirectedRef.current = true;
      const target = capturedTargetRef.current ?? "/";
      void navigate({
        to: "/auth",
        search: target === "/" ? {} : { redirect: target },
        replace: true,
      });
      return;
    }
    if (!hasRole) {
      redirectedRef.current = true;
      void navigate({ to: "/forbidden", replace: true });
    }
  }, [loading, user, hasRole, navigate]);

  const showGate = !user ? loading : (role ? !hasRole || loading : false);
  const gateState: "checking" | "redirecting" = loading ? "checking" : "redirecting";

  if (showGate) {
    // Pure CSS animations only. Framer-motion nested inside a component that
    // re-renders while auth state settles was tripping a setRef loop
    // ("Maximum update depth exceeded"), so we keep the gate light-weight.
    return (
      <div
        className="relative flex min-h-screen items-center justify-center overflow-hidden bg-arena-bg text-white"
        role="status"
        aria-live="polite"
        aria-busy={loading}
      >
        {/* Ambient radial glow — pulses via CSS keyframes. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 auth-gate-glow motion-safe:animate-[authGateGlow_2.4s_ease-in-out_infinite]"
          style={{
            background:
              "radial-gradient(60% 60% at 50% 40%, hsl(var(--primary) / 0.18) 0%, transparent 70%)",
          }}
        />

        {/* Skeleton scaffold — hints the page layout that's about to appear. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-4 px-6 pt-6 opacity-40">
          <div className="h-10 w-full max-w-xl animate-pulse rounded-md bg-white/5" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="h-24 animate-pulse rounded-lg bg-white/5" />
            <div className="h-24 animate-pulse rounded-lg bg-white/5" />
            <div className="h-24 animate-pulse rounded-lg bg-white/5" />
          </div>
        </div>

        <div
          key={gateState}
          className="relative z-10 flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-8 py-6 shadow-[0_20px_60px_-20px_hsl(var(--primary)/0.55)] backdrop-blur-md motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300"
        >
          <div className="relative flex h-12 w-12 items-center justify-center motion-safe:animate-[authGatePulse_1.8s_ease-in-out_infinite]">
            <span
              aria-hidden
              className="absolute inset-0 rounded-full"
              style={{ boxShadow: "0 0 24px 4px hsl(var(--primary) / 0.35)" }}
            />
            {gateState === "checking" ? (
              <Loader2 className="h-6 w-6 animate-spin text-arena-violet" />
            ) : (
              <ShieldCheck className="h-6 w-6 text-arena-violet" />
            )}
          </div>
          <div className="flex flex-col items-center gap-1">
            <p className="text-xs uppercase tracking-[0.28em] text-white/70">
              {gateState === "checking" ? "Checking session" : "Redirecting"}
            </p>
            <p className="text-[11px] text-white/40">
              {gateState === "checking"
                ? "Verifying your access…"
                : "Taking you to the right place…"}
            </p>
          </div>
          <span className="sr-only">
            {gateState === "checking"
              ? "Verifying your session, please wait."
              : "Redirecting you to sign in."}
          </span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export function RequireAuth(props: RequireAuthProps) {
  return (
    <ClientOnly fallback={null}>
      <RequireAuthInner {...props} />
    </ClientOnly>
  );
}


/** HOC form for wrapping a route component in a single line. */
export function withAuth<P extends object>(
  Component: FunctionComponent<P>,
  role?: AppRole,
): FunctionComponent<P> {
  const Wrapped: FunctionComponent<P> = (props) => (
    <RequireAuth role={role}>
      <Component {...props} />
    </RequireAuth>
  );
  return Wrapped;
}
