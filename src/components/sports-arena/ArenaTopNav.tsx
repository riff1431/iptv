import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell, Mail, Settings, ChevronDown } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

type NavItem = {
  label: string;
  to: "/" | "/lobby" | "/schedule" | "/arena" | "/iptv" | "/messages" | "/wallet";
  exact?: boolean;
};
const NAV: NavItem[] = [
  { label: "HOME", to: "/", exact: true },
  { label: "LOBBY", to: "/lobby" },
  { label: "SCHEDULE", to: "/schedule" },
  { label: "ARENA", to: "/arena" },
  { label: "MESSAGES", to: "/messages" },
  { label: "WALLET", to: "/wallet" },
];

export function ArenaTopNav() {
  const { user } = useAuth();
  const metaName = user?.user_metadata?.display_name as string | undefined;
  const metaAvatar = user?.user_metadata?.avatar_url as string | undefined;

  // Fall back to profiles.avatar_url / display_name so the nav shows the
  // uploaded avatar even when it isn't mirrored into auth user_metadata.
  const [profileName, setProfileName] = useState<string | null>(null);
  const [profileAvatar, setProfileAvatar] = useState<string | null>(null);
  const [avatarErrored, setAvatarErrored] = useState(false);
  const [avatarLoaded, setAvatarLoaded] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  // Respect prefers-reduced-motion so the skeleton doesn't pulse for users
  // who have asked for reduced motion.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      setProfileName(null);
      setProfileAvatar(null);
      return;
    }
    setAvatarErrored(false);
    supabase
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        setProfileName(data.display_name ?? null);
        setProfileAvatar(data.avatar_url ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const name = metaName ?? profileName ?? (user?.email ? user.email.split("@")[0] : "AlexJ");
  const avatarUrl = metaAvatar ?? profileAvatar ?? null;
  const showAvatar = !!avatarUrl && !avatarErrored;
  const showSkeleton = showAvatar && !avatarLoaded;
  const initial = name.slice(0, 1).toUpperCase();

  // Reset the loaded flag whenever the source URL changes.
  useEffect(() => {
    setAvatarLoaded(false);
  }, [avatarUrl]);

  return (
    <header className="sticky top-0 z-40 border-b border-arena-border bg-arena-bg/85 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-2 px-3 sm:h-16 sm:gap-4 sm:px-4 lg:gap-6 lg:px-6">
        {/* Logo */}
        <Link to="/" className="flex min-w-0 shrink-0 items-center gap-2 leading-none">
          <span className="font-display text-2xl font-extrabold italic tracking-tight text-arena-gradient sm:text-3xl">
            PGX
          </span>
          <span className="hidden text-[9px] font-semibold uppercase tracking-[0.35em] text-muted-foreground xl:block">
            Playground X
          </span>
        </Link>

        {/* Nav */}
        <nav className="hidden min-w-0 flex-1 items-center justify-center gap-4 md:flex lg:gap-7">
          {NAV.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              activeOptions={{ exact: item.exact ?? false }}
              inactiveProps={{ className: "text-muted-foreground hover:text-white" }}
              activeProps={{
                "aria-current": "page",
                className: "text-white",
              }}
              className="group/nav relative py-1 text-[12px] font-semibold tracking-wider transition lg:text-[13px]"
            >
              {item.label}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-0.5 left-0 h-[3px] w-full origin-left scale-x-0 rounded-full bg-[image:var(--gradient-arena)] transition-transform duration-300 ease-out group-hover/nav:scale-x-100 group-focus-visible/nav:scale-x-100 group-data-[status=active]/nav:scale-x-100 motion-reduce:transition-none"
              />
            </Link>
          ))}
        </nav>

        {/* Right cluster */}
        <div className="flex min-w-0 shrink items-center gap-2 sm:gap-3 lg:gap-5">
          <Link
            to="/wallet"
            className="hidden text-right leading-tight transition hover:opacity-80 lg:block"
            aria-label="Open wallet"
          >
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              PGX Wallet
            </div>
            <div className="flex items-center justify-end gap-1.5 text-sm font-semibold text-white">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-arena-gold text-[9px] font-black text-black">
                $
              </span>
              12,450.50
            </div>
          </Link>

          <Link
            to="/profile"
            aria-label="Open profile"
            className="flex min-w-0 shrink items-center gap-2 rounded-full border border-arena-border bg-arena-panel/60 py-1 pl-1 pr-2 text-sm text-white transition hover:-translate-y-[1px] hover:border-primary/40 hover:bg-arena-panel focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 sm:pr-3 motion-reduce:hover:translate-y-0"
          >
            <span
              className="relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-arena-violet to-arena-cyan text-xs font-bold"
              aria-busy={showSkeleton || undefined}
            >
              {showAvatar ? (
                <>
                  {showSkeleton && (
                    <span
                      data-testid="avatar-skeleton"
                      data-reduced-motion={reducedMotion ? "true" : "false"}
                      role="status"
                      aria-live="polite"
                      aria-label="Loading avatar"
                      className={`absolute inset-0 bg-arena-panel ${
                        reducedMotion ? "" : "animate-pulse"
                      }`}
                    />
                  )}
                  <img
                    src={avatarUrl!}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onLoad={() => setAvatarLoaded(true)}
                    onError={() => setAvatarErrored(true)}
                    className={`h-full w-full object-cover transition-opacity ${
                      avatarLoaded ? "opacity-100" : "opacity-0"
                    }`}
                  />
                </>
              ) : (
                initial
              )}
            </span>

            <span className="hidden max-w-[10ch] truncate font-medium sm:inline">{name}</span>
            <ChevronDown className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground sm:inline" />
          </Link>

          <div className="hidden items-center gap-3 text-muted-foreground lg:flex">
            <Link
              to="/messages"
              className="transition hover:text-white focus:outline-none focus-visible:text-white"
              aria-label="Messages"
            >
              <Mail className="h-5 w-5" />
            </Link>
            <Link
              to="/profile"
              className="relative transition hover:text-white focus:outline-none focus-visible:text-white"
              aria-label="Notifications"
            >
              <Bell className="h-5 w-5" />
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-live ring-2 ring-arena-bg" />
            </Link>
            <Link
              to="/profile"
              className="transition hover:text-white focus:outline-none focus-visible:text-white"
              aria-label="Settings"
            >
              <Settings className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
