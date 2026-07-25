import { Link, useLocation } from "@tanstack/react-router";
import {
  Home,
  Play,
  Trophy,
  
  Users,
  Wallet,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

type Tab = {
  key: string;
  label: string;
  icon: LucideIcon;
  to?: string;
  match?: (path: string) => boolean;
  comingSoon?: boolean;
};

const TABS: Tab[] = [
  { key: "home", label: "Home", icon: Home, to: "/", match: (p) => p === "/" },
  {
    key: "streams",
    label: "Streams",
    icon: Play,
    to: "/dashboard",
    match: (p) => p.startsWith("/dashboard"),
  },
  {
    key: "arena",
    label: "Arena",
    icon: Trophy,
    to: "/arena",
    match: (p) => p.startsWith("/arena") || p.startsWith("/lounge"),
  },
  
  {
    key: "community",
    label: "Community",
    icon: Users,
    to: "/friends",
    match: (p) => p.startsWith("/friends") || p.startsWith("/messages"),
  },
  {
    key: "wallet",
    label: "Wallet",
    icon: Wallet,
    to: "/wallet",
    match: (p) => p.startsWith("/wallet"),
  },
  
  {
    key: "settings",
    label: "Settings",
    icon: Settings,
    to: "/profile",
    match: (p) => p.startsWith("/profile"),
  },
];

export function ArenaBottomTabs() {
  const { pathname } = useLocation();

  return (
    <nav className="mt-6 border-t border-arena-border bg-arena-panel/70 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] gap-1 overflow-x-auto px-3 py-3 sm:px-6 md:grid md:grid-cols-8">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = t.match?.(pathname) ?? false;
          const className = `flex min-w-[68px] shrink-0 flex-col items-center gap-1.5 rounded-lg py-2 text-[11px] font-bold uppercase tracking-wider transition md:min-w-0 ${
            active ? "text-arena-violet" : "text-muted-foreground hover:text-white"
          }`;
          const iconEl = (
            <Icon
              className={`h-5 w-5 ${
                active ? "drop-shadow-[0_0_10px_var(--arena-violet)]" : ""
              }`}
            />
          );

          if (t.comingSoon || !t.to) {
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => toast(`${t.label} is coming soon`)}
                className={className}
              >
                {iconEl}
                {t.label}
              </button>
            );
          }

          return (
            <Link key={t.key} to={t.to} className={className}>
              {iconEl}
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
