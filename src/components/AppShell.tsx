import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  
  Home,
  LogOut,
  MessageCircle,
  Menu,
  Tv,
  Trophy,
  User as UserIcon,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useAdScheduleRealtime } from "@/hooks/useAdScheduleRealtime";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useScrollDirection } from "@/hooks/useScrollDirection";
import { supabase } from "@/integrations/supabase/client";
import { UserNav } from "@/components/UserNav";
import { NavCommandPalette } from "@/components/NavCommandPalette";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// `adminOnly` links are filtered out of the header for non-admin users.
// IPTV is an admin surface (provider config, channel picker) so it stays
// hidden from regular viewers. Each link renders with a matching lucide
// icon for quicker visual scanning in the header.
type NavLink = {
  label: string;
  to: "/" | "/arena" | "/iptv" | "/messages" | "/wallet";
  icon: LucideIcon;
  adminOnly?: boolean;
};
const NAV_LINKS: NavLink[] = [
  { label: "Home", to: "/", icon: Home },
  { label: "Arena", to: "/arena", icon: Trophy },
  { label: "IPTV", to: "/iptv", icon: Tv, adminOnly: true },
  { label: "Messages", to: "/messages", icon: MessageCircle },
  { label: "Wallet", to: "/wallet", icon: Wallet },
];

export function AppShell({ children }: { children: ReactNode }) {
  // Global realtime subscriptions (chat/lounge-scoped subs live inside the lounge viewer).
  useAdScheduleRealtime();

  const { isAdmin, user, signOut } = useAuth();
  const { displayName, avatarUrl, initial } = useProfile();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const navLinks = useMemo(
    () => NAV_LINKS.filter((l) => !l.adminOnly || isAdmin),
    [isAdmin],
  );

  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { hidden, scrolled } = useScrollDirection();

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await queryClient.cancelQueries();
      await supabase.auth.signOut();
      await signOut();
      queryClient.clear();
      setMobileOpen(false);
      await navigate({ to: "/auth", replace: true });
    } catch (err) {
      console.error("Sign out failed", err);
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="min-h-screen bg-stadium text-foreground">
      <header
        className={`sticky top-0 z-40 border-b bg-arena-bg/85 backdrop-blur-xl transition-[transform,height,border-color,box-shadow] duration-300 ease-out will-change-transform ${
          hidden ? "-translate-y-full" : "translate-y-0"
        } ${
          scrolled
            ? "border-arena-border/80 shadow-[0_8px_24px_-16px_hsl(var(--primary)/0.4)]"
            : "border-arena-border"
        }`}
      >
        <div
          className={`mx-auto flex max-w-[1600px] items-center justify-between gap-3 px-3 transition-[height] duration-300 ease-out sm:gap-6 sm:px-6 ${
            scrolled ? "h-12" : "h-16"
          }`}
        >
          <div className="flex min-w-0 items-center gap-2 sm:gap-6">
            {/* Mobile menu trigger (hidden when logged out) */}
            {user ? (
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  aria-label="Open navigation menu"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-arena-border bg-arena-panel/60 text-white transition hover:border-white/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 md:hidden"
                >
                  <Menu className="h-5 w-5" aria-hidden="true" />
                </button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="flex w-72 flex-col border-arena-border bg-arena-bg/95 p-0 backdrop-blur-xl"
              >
                <SheetHeader className="border-b border-arena-border px-4 py-4 text-left">
                  <SheetTitle className="flex items-center gap-2 font-display text-xl font-extrabold italic tracking-tight text-arena-gradient">
                    <span
                      aria-hidden="true"
                      className="inline-grid h-8 w-8 shrink-0 place-items-center rounded-md bg-arena-panel ring-1 ring-primary/40"
                    >
                      <Trophy className="h-4 w-4 text-primary" />
                    </span>
                    PGX
                  </SheetTitle>
                </SheetHeader>
                {user && (
                  <div className="flex items-center gap-3 border-b border-arena-border px-4 py-3">
                    <span
                      role="img"
                      aria-label={`${displayName} avatar`}
                      className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-arena-violet to-arena-cyan text-sm font-bold text-white ring-1 ring-arena-border"
                    >
                      {avatarUrl ? (
                        <img
                          src={avatarUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span aria-hidden="true">{initial}</span>
                      )}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-white">
                          {displayName}
                        </span>
                        {isAdmin && (
                          <span className="rounded-sm bg-primary/20 px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-wider text-primary">
                            Admin
                          </span>
                        )}
                      </span>
                      {user.email && (
                        <span className="truncate text-[11px] text-muted-foreground">
                          {user.email}
                        </span>
                      )}
                    </span>
                  </div>
                )}
                <MobileNavList
                  links={navLinks}
                  onNavigate={() => setMobileOpen(false)}
                />


                {user && (
                  <div className="mt-auto border-t border-arena-border p-2">
                    <p className="px-3 pb-1 pt-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                      Account
                    </p>
                    <Link
                      to="/profile"
                      onClick={() => setMobileOpen(false)}
                      className="flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-arena-panel/70 hover:text-white focus:outline-none focus-visible:bg-arena-panel focus-visible:text-white focus-visible:ring-2 focus-visible:ring-primary/60"
                    >
                      <UserIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="flex-1">View profile</span>
                      <ChevronRight className="h-4 w-4 opacity-60" aria-hidden="true" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => void handleSignOut()}
                      disabled={signingOut}
                      className="flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-left text-sm font-medium text-live transition hover:bg-live/15 focus:outline-none focus-visible:bg-live/15 focus-visible:ring-2 focus-visible:ring-live/60 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{signingOut ? "Signing out…" : "Sign out"}</span>
                    </button>
                  </div>
                )}
              </SheetContent>
            </Sheet>
            ) : null}


            <Link to="/" className="flex min-w-0 items-center gap-2 leading-none">
              <span className="font-display text-2xl font-extrabold italic tracking-tight text-arena-gradient sm:text-3xl">
                PGX
              </span>
              <span className="hidden text-[9px] font-semibold uppercase tracking-[0.35em] text-muted-foreground sm:block">
                <span className="text-white/80">Sports</span>{" "}
                <span className="text-arena-violet">Lounge</span>
              </span>
            </Link>

            {/* Desktop inline nav: icon-only on md, icon + label on lg+ */}
            {user ? (
            <TooltipProvider delayDuration={150} skipDelayDuration={200}>
              <nav
                aria-label="Primary"
                className="hidden items-center gap-1 md:flex"
              >
                {navLinks.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Tooltip key={item.to + item.label}>
                      <TooltipTrigger asChild>
                        <Link
                          to={item.to}
                          preload="viewport"
                          aria-label={item.label}
                          activeOptions={{ exact: item.to === "/" }}
                          activeProps={{
                            "aria-current": "page",
                            className:
                              "text-white bg-arena-panel ring-1 ring-primary/40 [&_svg]:text-primary",
                          }}
                          inactiveProps={{
                            className: "text-muted-foreground hover:text-white",
                          }}
                          className="group/nav relative inline-flex items-center justify-center gap-1.5 overflow-hidden rounded-md px-2 py-1.5 text-xs font-semibold uppercase tracking-wider transition hover:bg-arena-panel/60 hover:-translate-y-[1px] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 lg:px-3 data-[status=active]:after:absolute data-[status=active]:after:inset-x-2 data-[status=active]:after:-bottom-[9px] data-[status=active]:after:h-0.5 data-[status=active]:after:rounded-full data-[status=active]:after:bg-primary motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                        >
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-x-2 -bottom-[9px] h-0.5 origin-left scale-x-0 rounded-full bg-primary/70 transition-transform duration-300 ease-out group-hover/nav:scale-x-100 group-focus-visible/nav:scale-x-100 data-[status=active]:hidden motion-reduce:transition-none"
                          />
                          <Icon className="h-4 w-4 shrink-0 transition-all duration-200 group-hover/nav:scale-110 group-hover/nav:text-primary lg:h-3.5 lg:w-3.5" aria-hidden="true" />
                          <span className="sr-only lg:not-sr-only">{item.label}</span>
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="lg:hidden">
                        {item.label}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </nav>
            </TooltipProvider>
            ) : null}

          </div>

          {/* Right cluster: command palette + dynamic user navigation */}
          <div className="flex items-center gap-2 sm:gap-3">
            {user ? <NavCommandPalette isAdmin={isAdmin} onSignOut={handleSignOut} /> : null}
            <UserNav />
          </div>
        </div>
      </header>

      <main>{children}</main>
    </div>
  );
}

function MobileNavList({
  links,
  onNavigate,
}: {
  links: NavLink[];
  onNavigate: () => void;
}) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const [hovered, setHovered] = useState<string | null>(null);
  const reduce = useReducedMotion();

  const isActive = (to: NavLink["to"]) =>
    to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);

  return (
    <nav
      aria-label="Primary"
      className="flex flex-col p-2"
      onMouseLeave={() => setHovered(null)}
    >
      {links.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.to);
        const isHovered = hovered === item.to;
        return (
          <Link
            key={item.to + item.label}
            to={item.to}
            onClick={onNavigate}
            onMouseEnter={() => setHovered(item.to)}
            onFocus={() => setHovered(item.to)}
            onBlur={() => setHovered((h) => (h === item.to ? null : h))}
            aria-current={active ? "page" : undefined}
            className={`relative flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-semibold uppercase tracking-wider focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
              active ? "text-white" : "text-muted-foreground hover:text-white"
            }`}
            style={{
              transition: "color 220ms ease, text-shadow 220ms ease",
              textShadow:
                active || isHovered
                  ? "0 0 12px hsl(var(--primary) / 0.55)"
                  : "none",
            }}
          >
            {isHovered && !active && (
              <motion.span
                layoutId="mobile-nav-hover-pill"
                aria-hidden="true"
                transition={
                  reduce
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 380, damping: 32 }
                }
                className="absolute inset-0 -z-10 rounded-md"
                style={{
                  background:
                    "linear-gradient(135deg, hsl(var(--primary) / 0.14), oklch(0.55 0.2 285 / 0.14))",
                  boxShadow: "0 0 24px -6px hsl(var(--primary) / 0.35)",
                }}
              />
            )}
            {active && (
              <motion.span
                layoutId="mobile-nav-active-bar"
                aria-hidden="true"
                transition={
                  reduce
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 420, damping: 34 }
                }
                className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full"
                style={{
                  background: "hsl(var(--primary))",
                  boxShadow: "0 0 10px hsl(var(--primary) / 0.75)",
                }}
              />
            )}
            {active && (
              <motion.span
                layoutId="mobile-nav-active-bg"
                aria-hidden="true"
                transition={
                  reduce
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 380, damping: 32 }
                }
                className="absolute inset-0 -z-10 rounded-md bg-arena-panel"
              />
            )}
            <Icon
              className={`relative h-4 w-4 shrink-0 transition-colors ${active ? "text-primary" : ""}`}
              aria-hidden="true"
            />
            <span className="relative">{item.label}</span>
            {active && (
              <motion.span
                layoutId="mobile-nav-active-underline"
                aria-hidden="true"
                transition={
                  reduce
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 420, damping: 34 }
                }
                className="absolute bottom-1 left-3 right-3 h-[2px] rounded-full"
                style={{
                  backgroundImage: "var(--gradient-arena)",
                  boxShadow: "0 0 8px hsl(var(--primary) / 0.6)",
                }}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}


