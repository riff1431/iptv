import { useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";
import {
  Bell,
  Check,
  CheckCheck,
  Loader2,
  LogIn,
  LogOut,
  MessageCircle,
  Settings,
  Shield,
  User as UserIcon,
  Wallet,
  Megaphone,
  Users as UsersIcon,
  Crown,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useAutoMarkReadOnDeepLink } from "@/lib/wallet-preferences";
import { useAuth } from "@/hooks/useAuth";
import { useDirectMessages } from "@/hooks/useDirectMessages";
import { useProfile } from "@/hooks/useProfile";
import { useVipStatus } from "@/hooks/useVipStatus";
import { useNotifications, type Notification } from "@/hooks/useNotifications";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}

function NotificationsPanel({
  compact = false,
  onNavigate,
}: {
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const { notifications, loading, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const [walletUnreadOnly, setWalletUnreadOnly] = useState(false);
  const [autoMarkRead, setAutoMarkRead] = useAutoMarkReadOnDeepLink();

  const walletUnreadCount = notifications.filter((n) => n.kind === "wallet" && !n.read_at).length;
  const visible = walletUnreadOnly
    ? notifications.filter((n) => n.kind === "wallet" && !n.read_at)
    : notifications;

  const handleClick = (n: Notification) => {
    void markAsRead(n.id);
    if (n.link) {
      void navigate({ to: n.link as string, replace: false } as never);
    }
    onNavigate?.();
  };

  return (
    <div className={cn("flex flex-col", compact ? "max-h-[60vh]" : "max-h-96")}>
      <div className="flex items-center justify-between gap-2 border-b border-arena-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-white">
            Notifications
          </span>
          {unreadCount > 0 && (
            <span className="rounded-full bg-live/20 px-2 py-0.5 text-[10px] font-bold text-live">
              {unreadCount} new
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() => void markAllAsRead()}
            aria-label={`Mark all ${unreadCount} notifications as read`}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition hover:bg-arena-panel hover:text-white focus:outline-none focus-visible:bg-arena-panel focus-visible:text-white focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <CheckCheck className="h-3 w-3" aria-hidden="true" />
            <span>Mark all</span>
          </button>
        )}
      </div>

      <div className="flex items-center gap-1 border-b border-arena-border px-3 py-1.5">
        <button
          type="button"
          onClick={() => setWalletUnreadOnly(false)}
          aria-pressed={!walletUnreadOnly}
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition",
            !walletUnreadOnly
              ? "bg-arena-panel text-white"
              : "text-muted-foreground hover:text-white",
          )}
        >
          All
        </button>
        <button
          type="button"
          onClick={() => setWalletUnreadOnly(true)}
          aria-pressed={walletUnreadOnly}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition",
            walletUnreadOnly
              ? "bg-arena-gold/20 text-arena-gold"
              : "text-muted-foreground hover:text-white",
          )}
        >
          <Wallet className="h-3 w-3" aria-hidden="true" />
          Unread top-ups
          {walletUnreadCount > 0 && (
            <span className="ml-0.5 rounded-full bg-arena-gold/25 px-1.5 text-[9px] font-bold text-arena-gold">
              {walletUnreadCount}
            </span>
          )}
        </button>
      </div>

      <label className="flex cursor-pointer items-center justify-between gap-2 border-b border-arena-border px-3 py-1.5 text-[10px] font-medium text-muted-foreground hover:text-white">
        <span className="inline-flex items-center gap-1.5">
          <Wallet className="h-3 w-3" aria-hidden="true" />
          Auto-mark top-ups read on open
        </span>
        <input
          type="checkbox"
          className="h-3.5 w-3.5 cursor-pointer accent-arena-gold"
          checked={autoMarkRead}
          onChange={(e) => setAutoMarkRead(e.target.checked)}
          aria-label="Automatically mark top-up notifications as read when opening their deep link"
        />
      </label>

      <ScrollArea className="flex-1">
        {loading ? (
          <div className="grid place-items-center py-10 text-xs text-muted-foreground">
            Loading…
          </div>
        ) : visible.length === 0 ? (
          <div className="grid place-items-center gap-2 px-4 py-10 text-center">
            <Bell className="h-6 w-6 text-arena-violet" />
            <div className="text-xs font-semibold text-white">
              {walletUnreadOnly ? "No unread top-up updates" : "You're all caught up"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {walletUnreadOnly
                ? "Approvals and rejections for your top-ups will appear here."
                : "New activity will show up here."}
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-arena-border" role="list">
            {visible.map((n) => {
              const unread = !n.read_at;
              const kindMeta = (() => {
                switch (n.kind) {
                  case "wallet":
                    return { Icon: Wallet, tint: "text-arena-gold", ring: "bg-arena-gold/15" };
                  case "message":
                    return {
                      Icon: MessageCircle,
                      tint: "text-arena-cyan",
                      ring: "bg-arena-cyan/15",
                    };
                  case "lounge":
                    return {
                      Icon: UsersIcon,
                      tint: "text-arena-violet",
                      ring: "bg-arena-violet/15",
                    };
                  case "admin":
                    return { Icon: Shield, tint: "text-primary", ring: "bg-primary/15" };
                  default:
                    return {
                      Icon: Megaphone,
                      tint: "text-muted-foreground",
                      ring: "bg-arena-panel",
                    };
                }
              })();
              const { Icon: KindIcon, tint, ring } = kindMeta;
              return (
                <li key={n.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => handleClick(n)}
                    aria-label={`${n.title}${unread ? " — unread" : ""}`}
                    className={cn(
                      "flex w-full items-start gap-3 px-3 py-2.5 pr-10 text-left transition hover:bg-arena-panel/60",
                      "focus:outline-none focus-visible:bg-arena-panel focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60",
                      unread && "bg-primary/5",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full",
                        ring,
                      )}
                    >
                      <KindIcon className={cn("h-3.5 w-3.5", tint)} />
                      {unread && (
                        <span className="absolute -ml-6 mt-6 h-2 w-2 rounded-full bg-live shadow-[0_0_8px_hsl(var(--live))]" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span
                          className={cn(
                            "truncate text-xs",
                            unread ? "font-semibold text-white" : "text-muted-foreground",
                          )}
                        >
                          {n.title}
                        </span>
                        <span
                          className="shrink-0 text-[10px] text-muted-foreground"
                          aria-hidden="true"
                        >
                          {timeAgo(n.created_at)}
                        </span>
                      </div>
                      {n.body && (
                        <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                          {n.body}
                        </p>
                      )}
                    </div>
                  </button>

                  {unread && (
                    <button
                      type="button"
                      onClick={() => void markAsRead(n.id)}
                      className={cn(
                        "absolute right-2 top-2 hidden h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition sm:inline-flex",
                        "hover:bg-arena-bg hover:text-white",
                        "focus:outline-none focus-visible:bg-arena-bg focus-visible:text-white focus-visible:ring-2 focus-visible:ring-primary/60",
                        "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100",
                      )}
                      aria-label={`Mark "${n.title}" as read`}
                    >
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}

/** Right-hand user navigation: wallet chip, quick actions, avatar dropdown. */
export function UserNav() {
  const { user, isAdmin, loading: authLoading, signOut } = useAuth();
  const { unreadCount: dmUnread } = useDirectMessages();
  const { unreadCount: notifUnread } = useNotifications();
  const [notifOpen, setNotifOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { displayName, avatarUrl, initial } = useProfile();
  const { data: vipStatus } = useVipStatus(user?.id);
  const isVip = vipStatus?.isVip === true;

  const confirmSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await queryClient.cancelQueries();
      // Sign out on the server first so the session token is invalidated.
      await supabase.auth.signOut();
      // Then let the local auth hook clear its state.
      await signOut();

      // Verify the session is actually gone before navigating away.
      const deadline = Date.now() + 3000;
      while (true) {
        const { data } = await supabase.auth.getSession();
        if (!data.session) break;
        if (Date.now() > deadline) break;
        await new Promise((r) => setTimeout(r, 75));
      }

      queryClient.clear();
      setSignOutOpen(false);
      await navigate({ to: "/auth", replace: true });
    } catch (err) {
      console.error("Sign out failed", err);
    } finally {
      setSigningOut(false);
    }
  };

  if (!user) {
    // While the initial getUser() is in flight, render a neutral placeholder
    // instead of the "Log In / Create Account" CTAs. Otherwise every soft
    // navigation flashes the signed-out header for a few hundred ms, which
    // looks exactly like an auto-logout.
    if (authLoading) {
      return (
        <div aria-hidden="true" className="flex items-center gap-2 sm:gap-3">
          <div className="h-9 w-20 rounded-lg border border-arena-border bg-arena-panel/40 sm:w-24" />
          <div className="h-9 w-28 rounded-lg bg-arena-panel/40 sm:w-32" />
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={() => void navigate({ to: "/auth", search: { mode: "signin" } })}
          className="inline-flex items-center justify-center rounded-lg border border-arena-border bg-transparent px-4 py-2 text-xs font-bold uppercase tracking-[0.15em] text-white transition hover:border-white/40 hover:bg-arena-panel/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 sm:px-5 sm:py-2.5"
        >
          <LogIn className="mr-1.5 h-3.5 w-3.5 sm:hidden" aria-hidden="true" />
          <span>Log In</span>
        </button>
        <button
          type="button"
          onClick={() =>
            void navigate({
              to: "/auth",
              search: { mode: "signup", redirect: "/arena" },
            })
          }
          className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-arena-pink via-arena-pink to-arena-violet px-4 py-2 text-xs font-bold uppercase tracking-[0.15em] text-white shadow-[0_10px_30px_-10px_var(--arena-pink)] transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 sm:px-5 sm:py-2.5"
        >
          Create Account
        </button>
      </div>
    );
  }

  const email = user.email ?? "";

  const totalAlertBadge = dmUnread + notifUnread;

  return (
    <TooltipProvider delayDuration={150} skipDelayDuration={200}>
      <div className="flex items-center gap-2 sm:gap-3 lg:gap-4">
        {/* Wallet chip — visible from sm up */}
        <WalletChipLink userId={user.id} />

        {/* Messages — desktop quick action */}
        <Link
          to="/messages"
          className="relative hidden h-9 w-9 items-center justify-center rounded-full border border-arena-border bg-arena-panel/60 text-muted-foreground transition hover:border-white/30 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-arena-bg md:inline-flex"
          aria-label={dmUnread ? `Messages, ${dmUnread} unread` : "Messages"}
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          {dmUnread > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-live px-1 text-[10px] font-bold text-live-foreground ring-2 ring-arena-bg"
            >
              {dmUnread > 9 ? "9+" : dmUnread}
            </span>
          )}
        </Link>

        {/* Notifications — desktop popover */}
        <Popover open={notifOpen} onOpenChange={setNotifOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="relative hidden h-9 w-9 items-center justify-center rounded-full border border-arena-border bg-arena-panel/60 text-muted-foreground transition hover:border-white/30 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-arena-bg md:inline-flex"
              aria-label={notifUnread ? `Notifications, ${notifUnread} unread` : "Notifications"}
            >
              <Bell className="h-4 w-4" aria-hidden="true" />
              {notifUnread > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-live px-1 text-[10px] font-bold text-live-foreground ring-2 ring-arena-bg"
                >
                  {notifUnread > 9 ? "9+" : notifUnread}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={10}
            className="w-80 border-arena-border bg-arena-bg/95 p-0 backdrop-blur-xl"
            aria-label="Notifications"
          >
            <NotificationsPanel onNavigate={() => setNotifOpen(false)} />
          </PopoverContent>
        </Popover>

        {/* Avatar dropdown */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger
                className={cn(
                  "group inline-flex items-center gap-2 rounded-full border border-arena-border bg-arena-panel/60 py-1 pl-1 pr-1 text-sm text-white transition",
                  "hover:border-white/30 hover:bg-arena-panel focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-arena-bg",
                  "sm:pr-3",
                )}
                aria-label={
                  totalAlertBadge > 0
                    ? `Account menu for ${displayName}, ${totalAlertBadge} unread alerts`
                    : `Account menu for ${displayName}`
                }
              >
                <span
                  role="img"
                  aria-label={`${displayName} avatar`}
                  className="relative grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-arena-violet to-arena-cyan text-xs font-bold"
                >
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span aria-hidden="true">{initial}</span>
                  )}
                  {totalAlertBadge > 0 && (
                    <span
                      aria-hidden="true"
                      className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-live ring-2 ring-arena-bg md:hidden"
                    />
                  )}
                </span>
                <span className="hidden max-w-[9rem] truncate font-medium sm:inline">
                  {displayName}
                </span>
                {isAdmin && (
                  <span className="hidden rounded-sm bg-primary/20 px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-wider text-primary sm:inline">
                    Admin
                  </span>
                )}
                {isVip && (
                  <span className="hidden items-center gap-1 rounded-sm bg-amber-400/15 px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-wider text-amber-300 sm:inline-flex">
                    <Crown className="h-2.5 w-2.5" aria-hidden="true" />
                    VIP
                  </span>
                )}
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end" className="sm:hidden">
              {displayName}
              {totalAlertBadge > 0 ? ` · ${totalAlertBadge} unread` : ""}
            </TooltipContent>
          </Tooltip>

          <DropdownMenuContent
            align="end"
            sideOffset={10}
            className="w-72 border-arena-border bg-arena-bg/95 p-1.5 backdrop-blur-xl"
          >
            <DropdownMenuLabel className="px-2 py-2">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-arena-violet to-arena-cyan text-sm font-bold text-white">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    initial
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-white">{displayName}</span>
                    {isAdmin && (
                      <span className="rounded-sm bg-primary/20 px-1 py-[1px] text-[9px] font-bold uppercase tracking-wider text-primary">
                        Admin
                      </span>
                    )}
                    {isVip && (
                      <span className="inline-flex items-center gap-1 rounded-sm bg-amber-400/15 px-1 py-[1px] text-[9px] font-bold uppercase tracking-wider text-amber-300">
                        <Crown className="h-2.5 w-2.5" aria-hidden="true" />
                        VIP
                      </span>
                    )}
                  </div>
                  {email && (
                    <div className="truncate text-[11px] text-muted-foreground">{email}</div>
                  )}
                </div>
              </div>
            </DropdownMenuLabel>

            <DropdownMenuSeparator className="bg-arena-border" />

            {/* Wallet row — always visible in menu (mobile parity) */}
            <MotionMenuLink
              to="/wallet"
              icon={<Wallet className="h-4 w-4 text-arena-gold" aria-hidden="true" />}
            >
              <span className="flex-1">Wallet</span>
              <WalletMenuBalance userId={user.id} />
            </MotionMenuLink>

            <MotionMenuLink
              to="/profile"
              icon={<UserIcon className="h-4 w-4" aria-hidden="true" />}
            >
              <span>Profile</span>
            </MotionMenuLink>

            <MotionMenuLink
              to="/dashboard"
              icon={<Wallet className="h-4 w-4" aria-hidden="true" />}
            >
              <span>My Dashboard</span>
            </MotionMenuLink>

            {isAdmin && (
              <MotionMenuLink to="/iptv" icon={<Wallet className="h-4 w-4" aria-hidden="true" />}>
                <span>IPTV</span>
              </MotionMenuLink>
            )}

            <MotionMenuLink
              to="/messages"
              icon={<MessageCircle className="h-4 w-4" aria-hidden="true" />}
            >
              <span className="flex-1">Messages</span>
              {dmUnread > 0 && (
                <span className="grid h-4 min-w-4 place-items-center rounded-full bg-live px-1 text-[10px] font-bold text-live-foreground">
                  {dmUnread > 9 ? "9+" : dmUnread}
                </span>
              )}
            </MotionMenuLink>

            <DropdownMenuSeparator className="bg-arena-border md:hidden" />

            {/* Mobile: inline notifications panel */}
            <div className="md:hidden">
              <NotificationsPanel compact />
            </div>

            {!authLoading && isAdmin && (
              <>
                <DropdownMenuSeparator className="bg-arena-border" />
                <DropdownMenuLabel className="px-2 pb-1 pt-2 text-[9px] font-bold uppercase tracking-widest text-arena-violet">
                  Admin
                </DropdownMenuLabel>
                <MotionMenuLink
                  to="/admin"
                  activeExact
                  icon={<Shield className="h-4 w-4 text-primary" aria-hidden="true" />}
                >
                  <span>Admin console</span>
                </MotionMenuLink>
                <MotionMenuLink
                  to="/admin/settings"
                  icon={<Settings className="h-4 w-4" aria-hidden="true" />}
                >
                  <span>Admin settings</span>
                </MotionMenuLink>
              </>
            )}

            <DropdownMenuSeparator className="bg-arena-border" />

            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setSignOutOpen(true);
              }}
              className="focus:bg-live/20 focus:text-live-foreground"
            >
              <LogOut className="mr-2 h-4 w-4 text-live" />
              <span>Sign out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <AlertDialog
          open={signOutOpen}
          onOpenChange={(open) => {
            // Prevent closing while sign-out is in flight.
            if (!open && signingOut) return;
            setSignOutOpen(open);
          }}
        >
          <AlertDialogContent
            className="border-arena-border bg-arena-bg"
            onEscapeKeyDown={(e) => {
              if (signingOut) e.preventDefault();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle className="text-white">
                {signingOut ? "Signing you out…" : "Sign out?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {signingOut
                  ? "Clearing your session. You'll be redirected in a moment."
                  : "You'll be returned to the sign-in screen. Any unsaved lounge chat drafts will be lost."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={signingOut}>Stay signed in</AlertDialogCancel>
              <AlertDialogAction
                disabled={signingOut}
                aria-busy={signingOut}
                onClick={(e) => {
                  e.preventDefault();
                  void confirmSignOut();
                }}
                className="bg-live text-live-foreground hover:bg-live/90"
              >
                {signingOut ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
                )}
                {signingOut ? "Signing out…" : "Sign out"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}

function useWalletBalanceCents(userId: string) {
  return useQuery({
    queryKey: ["wallet", "chip-balance", userId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("wallet_balance_cents", { _user_id: userId });
      if (error) throw error;
      return (data as number | null) ?? 0;
    },
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

function fmtBalance(cents: number | undefined): string {
  if (cents == null) return "…";
  return (cents / 100).toFixed(2);
}

function WalletChipLink({ userId }: { userId: string }) {
  const { data } = useWalletBalanceCents(userId);
  const label = fmtBalance(data);
  return (
    <Link
      to="/wallet"
      className="hidden items-center gap-2 rounded-full border border-arena-border bg-arena-panel/60 px-3 py-1 text-right leading-tight transition hover:border-white/30 hover:bg-arena-panel focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-arena-bg sm:flex"
      aria-label={`Wallet balance $${label}. Open wallet.`}
    >
      <span
        aria-hidden="true"
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-arena-gold text-[10px] font-black text-black"
      >
        $
      </span>
      <span className="flex flex-col items-end" aria-hidden="true">
        <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
          Wallet
        </span>
        <span className="text-xs font-semibold text-white tabular-nums">{label}</span>
      </span>
    </Link>
  );
}

function WalletMenuBalance({ userId }: { userId: string }) {
  const { data } = useWalletBalanceCents(userId);
  return <span className="text-xs font-semibold text-white tabular-nums">${fmtBalance(data)}</span>;
}

/**
 * Dropdown menu link with Framer-Motion powered hover pill + active bar.
 * Shared `layoutId`s make the pill/bar spring between items as focus moves,
 * mirroring the top-nav underline. Reduced-motion collapses to instant.
 */
function MotionMenuLink({
  to,
  icon,
  children,
  activeExact,
}: {
  to: "/wallet" | "/profile" | "/dashboard" | "/iptv" | "/messages" | "/admin" | "/admin/settings";
  icon: ReactNode;
  children: ReactNode;
  activeExact?: boolean;
}) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const active = activeExact ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
  const [hovered, setHovered] = useState(false);
  const reduce = useReducedMotion();
  const spring = reduce
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 380, damping: 30 };

  return (
    <DropdownMenuItem asChild className="focus:bg-transparent data-[highlighted]:bg-transparent">
      <Link
        to={to}
        aria-current={active ? "page" : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        className={`relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none ${
          active ? "text-white" : "text-white/85"
        }`}
        style={{
          transition: "color 200ms ease, text-shadow 220ms ease",
          textShadow: active || hovered ? "0 0 10px hsl(var(--primary) / 0.5)" : "none",
        }}
      >
        {hovered && !active && (
          <motion.span
            layoutId="user-menu-hover-pill"
            aria-hidden="true"
            transition={spring}
            className="absolute inset-0 -z-10 rounded-md"
            style={{
              background:
                "linear-gradient(135deg, hsl(var(--primary) / 0.14), oklch(0.55 0.2 285 / 0.14))",
              boxShadow: "0 0 20px -6px hsl(var(--primary) / 0.35)",
            }}
          />
        )}
        {active && (
          <>
            <motion.span
              layoutId="user-menu-active-bg"
              aria-hidden="true"
              transition={spring}
              className="absolute inset-0 -z-10 rounded-md bg-primary/10"
            />
            <motion.span
              layoutId="user-menu-active-bar"
              aria-hidden="true"
              transition={spring}
              className="absolute inset-y-1 left-0 w-[3px] rounded-r-full"
              style={{
                background: "hsl(var(--primary))",
                boxShadow: "0 0 8px hsl(var(--primary) / 0.75)",
              }}
            />
          </>
        )}
        <span className="relative flex flex-1 items-center gap-2">
          {icon}
          {children}
        </span>
      </Link>
    </DropdownMenuItem>
  );
}
