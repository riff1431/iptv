import { createFileRoute, Link, Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import {
  Tv,
  Building2,
  Film,
  Settings,
  BarChart3,
  Users,
  Activity,
  ScrollText,
  CreditCard,
  AlertTriangle,
  ShieldAlert,
  ShieldOff,
  Trophy,
  Radio,
  Wallet,
  History,
  Coins,
  Flame,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { requireAdminRoute } from "@/lib/admin-guard";

const adminNav: Array<{
  to:
    | "/admin"
    | "/admin/arena"
    | "/admin/lounges"
    | "/admin/tvs"
    | "/admin/iptv-provider"
    | "/admin/ads"
    | "/admin/health"
    | "/admin/seg-metrics"
    | "/admin/users"
    | "/admin/audit"
    | "/admin/iptv-rejections"
    | "/admin/iptv-blocks"
    | "/admin/payments"
    | "/admin/topups"
    | "/admin/topup-history"
    | "/admin/tips"
    | "/admin/quick-dares"
    | "/admin/wallet-ledger"
    | "/admin/settings"
    | "/admin/site-settings";
  label: string;
  icon: typeof Tv;
  exact?: boolean;
}> = [
  { to: "/admin", label: "Overview", icon: BarChart3, exact: true },
  { to: "/admin/arena", label: "Arena", icon: Trophy },
  { to: "/admin/lounges", label: "Lounges", icon: Building2 },
  { to: "/admin/tvs", label: "TVs & IPTV", icon: Tv },
  { to: "/admin/iptv-provider", label: "IPTV Provider", icon: Radio },
  { to: "/admin/ads", label: "Ad Breaks", icon: Film },
  { to: "/admin/health", label: "Stream Health", icon: Activity },
  { to: "/admin/seg-metrics", label: "Seg Failures", icon: AlertTriangle },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/audit", label: "Audit Log", icon: ScrollText },
  { to: "/admin/iptv-rejections", label: "IPTV Rejections", icon: ShieldAlert },
  { to: "/admin/iptv-blocks", label: "IPTV Throttled IPs", icon: ShieldOff },
  { to: "/admin/payments", label: "Payments", icon: CreditCard },
  { to: "/admin/topups", label: "Payment Requests", icon: Wallet },
  { to: "/admin/topup-history", label: "Top-up History", icon: History },
  { to: "/admin/tips", label: "Match Tips", icon: Coins },
  { to: "/admin/quick-dares", label: "Quick Dares", icon: Flame },
  { to: "/admin/wallet-ledger", label: "Wallet Ledger", icon: ScrollText },
  { to: "/admin/site-settings", label: "Site Settings", icon: Settings },
  { to: "/admin/settings", label: "Admin Access", icon: Settings },
];

export const Route = createFileRoute("/admin")({
  // Guards /admin AND every /admin/* child route.
  beforeLoad: ({ location }) => requireAdminRoute({ location }),
  head: () => ({
    meta: [
      { title: "Admin — Sports Lounge" },
      { name: "description", content: "Administer lounges, TVs, IPTV channels, and ad breaks." },
    ],
  }),
  component: AdminLayout,
  errorComponent: AdminRouteError,
});

function AdminRouteError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();

  return (
    <AppShell>
      <main className="flex min-h-[calc(100vh-64px)] items-center justify-center bg-arena-bg px-4">
        <section
          className="arena-card w-full max-w-lg rounded-2xl border border-destructive/30 p-7 text-center"
          role="alert"
          data-testid="admin-route-error"
        >
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-destructive/15 text-destructive">
            <AlertTriangle className="h-6 w-6" aria-hidden="true" />
          </span>
          <h1 className="mt-4 font-display text-xl font-bold text-white">
            Admin console is temporarily unavailable
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your session is still stored. A temporary request failed while checking admin access.
          </p>
          {import.meta.env.DEV && error.message ? (
            <p className="mt-3 break-words rounded-md bg-black/20 px-3 py-2 font-mono text-xs text-destructive/90">
              {error.message}
            </p>
          ) : null}
          <div className="mt-5 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                void router.invalidate();
                reset();
              }}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-110"
            >
              Retry admin check
            </button>
            <Link
              to="/"
              className="rounded-md border border-arena-border px-4 py-2 text-sm font-semibold text-white transition hover:bg-arena-panel-2"
            >
              Back to lobby
            </Link>
          </div>
        </section>
      </main>
    </AppShell>
  );
}

function AdminLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isOverview = pathname === "/admin";

  return (
    <AppShell>
      <div className="relative min-h-[calc(100vh-64px)] bg-arena-bg">
        <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 sm:py-8">
          <div className="relative mb-6 overflow-hidden rounded-2xl arena-card px-5 py-5 sm:px-7 sm:py-6">
            <div className="pointer-events-none absolute inset-0 -z-10 bg-[image:var(--gradient-arena-glow)]" />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-arena-violet">
                  PGX Control Room
                </div>
                <h1 className="mt-1 font-display text-2xl font-extrabold uppercase tracking-tight text-arena-gradient sm:text-4xl">
                  Admin Console
                </h1>
                <p className="mt-2 max-w-xl text-xs uppercase tracking-wider text-muted-foreground sm:text-[13px]">
                  Configure every lounge, TV, IPTV feed, and ad break.
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[220px_1fr] lg:gap-6">
            <nav className="arena-card flex flex-col gap-1 rounded-2xl p-2">
              {adminNav.map((item) => {
                const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[12px] font-bold uppercase tracking-[0.12em] transition",
                      active
                        ? "bg-arena-violet/15 text-white ring-1 ring-inset ring-arena-violet/40 shadow-[0_0_18px_-8px_var(--arena-violet)]"
                        : "text-muted-foreground hover:bg-arena-panel-2/60 hover:text-white",
                    )}
                  >
                    {active && (
                      <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-r-full bg-arena-violet" />
                    )}
                    <Icon
                      className={cn(
                        "h-4 w-4",
                        active
                          ? "text-arena-violet"
                          : "text-muted-foreground group-hover:text-white",
                      )}
                    />
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div>{isOverview ? <AdminDashboard /> : <Outlet />}</div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
