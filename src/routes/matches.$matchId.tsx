import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  CalendarClock,
  CircleDollarSign,
  Copy,
  Crown,
  ExternalLink,
  Heart,
  Play,
  Radio,
  Share2,
  Trophy,
  Tv,
  Users as UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { withAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/matches/$matchId")({
  ssr: false,
  head: ({ params }) => ({
    meta: [
      { title: "Match details — PGX Sports Lounge" },
      {
        name: "description",
        content: `Match ${params.matchId} details: status, players, and actions.`,
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: withAuth(MatchDetailsPage),
  errorComponent: ({ error }) => (
    <AppShell>
      <div className="p-8 text-sm text-rose-400">
        Failed to load match: {error.message}
      </div>
    </AppShell>
  ),
  notFoundComponent: () => (
    <AppShell>
      <div className="p-8 text-sm text-muted-foreground">Match not found.</div>
    </AppShell>
  ),
});

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format((cents ?? 0) / 100);

function useMatchDetails(matchId: string, viewerId: string | undefined) {
  return useQuery({
    queryKey: ["match-details", matchId, viewerId],
    queryFn: async () => {
      const { data: match, error } = await supabase
        .from("matches")
        .select(
          "id,title,sport,status,starts_at,created_at,thumbnail_url,is_active,owner_id,entry_fee_cents,home_label,away_label,home_score,away_score,clock_label,period_label,slot_count,accent_home,accent_away",
        )
        .eq("id", matchId)
        .maybeSingle();
      if (error) throw error;
      if (!match) throw notFound();

      const [{ data: slots }, hostProfile, mySession] = await Promise.all([
        supabase
          .from("match_slots")
          .select("id,slot,channel_id,channel_name,channel_logo,enabled")
          .eq("match_id", matchId)
          .order("slot", { ascending: true }),
        match.owner_id
          ? supabase
              .from("profiles")
              .select("id,display_name,avatar_url")
              .eq("id", match.owner_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        viewerId
          ? supabase
              .from("match_sessions")
              .select("id,status,expires_at,entered_at,amount_cents")
              .eq("match_id", matchId)
              .eq("user_id", viewerId)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      return {
        match,
        slots: slots ?? [],
        host: hostProfile.data ?? null,
        mySession: mySession.data ?? null,
      };
    },
    refetchInterval: 30_000,
  });
}

function StatusBadge({ status }: { status: string }) {
  const live = status === "live";
  const scheduled = status === "scheduled";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ring-1",
        live &&
          "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30",
        scheduled &&
          "bg-amber-500/15 text-amber-400 ring-amber-500/30",
        !live &&
          !scheduled &&
          "bg-muted/30 text-muted-foreground ring-muted/40",
      )}
    >
      {live && (
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
      )}
      {status}
    </span>
  );
}

function MatchDetailsPage() {
  const { matchId } = Route.useParams();
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading } = useMatchDetails(matchId, user?.id);

  const isOwner = !!user?.id && data?.match.owner_id === user.id;
  const canManage = isOwner || isAdmin;

  const share = async () => {
    const url = `${window.location.origin}/matches/${matchId}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: data?.match.title ?? "Match", url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied to clipboard");
      }
    } catch {
      // user cancelled or clipboard blocked
    }
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(
      `${window.location.origin}/matches/${matchId}`,
    );
    toast.success("Link copied");
  };

  return (
    <AppShell>
      <div className="min-h-[calc(100vh-64px)] bg-arena-bg">
        <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8">
          <button
            type="button"
            onClick={() => navigate({ to: "/dashboard" })}
            className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground transition hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to dashboard
          </button>

          {isLoading || !data ? (
            <div className="space-y-4">
              <Skeleton className="h-64 w-full rounded-2xl" />
              <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
                <Skeleton className="h-80 rounded-2xl" />
                <Skeleton className="h-80 rounded-2xl" />
              </div>
            </div>
          ) : (
            <>
              {/* Hero */}
              <div className="relative overflow-hidden rounded-2xl border border-arena-border bg-arena-panel">
                {data.match.thumbnail_url ? (
                  <img
                    src={data.match.thumbnail_url}
                    alt={data.match.title}
                    className="absolute inset-0 h-full w-full object-cover opacity-30"
                  />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-arena-violet/30 via-arena-panel to-arena-pink/20" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-arena-panel via-arena-panel/60 to-transparent" />
                <div className="relative flex flex-col gap-6 p-6 sm:p-8">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={data.match.status} />
                    {data.match.sport && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-arena-violet/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-arena-violet ring-1 ring-arena-violet/30">
                        <Trophy className="h-3 w-3" /> {data.match.sport}
                      </span>
                    )}
                    {data.match.entry_fee_cents > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-400 ring-1 ring-emerald-500/30">
                        <CircleDollarSign className="h-3 w-3" />
                        {money(data.match.entry_fee_cents)} entry
                      </span>
                    )}
                  </div>
                  <h1 className="font-display text-3xl font-extrabold uppercase tracking-tight text-white sm:text-4xl">
                    {data.match.title}
                  </h1>

                  {/* Scoreboard */}
                  {(data.match.home_label || data.match.away_label) && (
                    <div className="flex items-center gap-4 rounded-xl border border-arena-border/60 bg-arena-bg/50 p-4">
                      <div className="flex-1 text-center">
                        <div
                          className="text-[10px] font-bold uppercase tracking-widest"
                          style={{ color: data.match.accent_home ?? undefined }}
                        >
                          {data.match.home_label ?? "Home"}
                        </div>
                        <div className="mt-1 font-display text-4xl font-extrabold text-white">
                          {data.match.home_score}
                        </div>
                      </div>
                      <div className="flex flex-col items-center gap-1 text-muted-foreground">
                        <div className="text-[10px] font-bold uppercase tracking-widest">
                          {data.match.period_label ?? "vs"}
                        </div>
                        <div className="font-mono text-sm text-white/70">
                          {data.match.clock_label ?? "—"}
                        </div>
                      </div>
                      <div className="flex-1 text-center">
                        <div
                          className="text-[10px] font-bold uppercase tracking-widest"
                          style={{ color: data.match.accent_away ?? undefined }}
                        >
                          {data.match.away_label ?? "Away"}
                        </div>
                        <div className="mt-1 font-display text-4xl font-extrabold text-white">
                          {data.match.away_score}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Primary actions */}
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="lg" className="min-w-[180px]">
                      <Link to="/arena/$matchId" params={{ matchId }}>
                        <Play className="mr-1.5 h-4 w-4" />
                        {data.match.status === "live"
                          ? "Watch live"
                          : "Enter Arena"}
                      </Link>
                    </Button>
                    <Button size="lg" variant="arenaOutline" onClick={share}>
                      <Share2 className="mr-1.5 h-4 w-4" /> Share
                    </Button>
                    <Button size="lg" variant="arenaOutline" onClick={copyLink}>
                      <Copy className="mr-1.5 h-4 w-4" /> Copy link
                    </Button>
                    {canManage && (
                      <Button asChild size="lg" variant="arenaOutline">
                        <Link to="/admin/arena">
                          <ExternalLink className="mr-1.5 h-4 w-4" /> Manage
                        </Link>
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* Body */}
              <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_360px]">
                {/* Slots / channels */}
                <div className="rounded-2xl border border-arena-border bg-arena-panel p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="flex items-center gap-2 font-display text-lg font-bold text-white">
                      <Tv className="h-4 w-4 text-arena-cyan" /> Channel Slots
                    </h2>
                    <span className="text-[11px] text-muted-foreground">
                      {data.slots.filter((s) => s.enabled).length}/
                      {data.match.slot_count} active
                    </span>
                  </div>
                  {data.slots.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-arena-border p-6 text-center text-xs text-muted-foreground">
                      No channels configured yet.
                    </div>
                  ) : (
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {data.slots.map((s) => (
                        <li
                          key={s.id}
                          className={cn(
                            "flex items-center gap-3 rounded-lg border border-arena-border/60 bg-arena-bg/40 px-3 py-2.5",
                            !s.enabled && "opacity-50",
                          )}
                        >
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-arena-violet/15 text-arena-violet ring-1 ring-arena-violet/30">
                            {s.channel_logo ? (
                              <img
                                src={s.channel_logo}
                                alt=""
                                className="h-6 w-6 object-contain"
                              />
                            ) : (
                              <Radio className="h-4 w-4" />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                              Slot {s.slot}
                            </div>
                            <div className="truncate text-sm font-semibold text-white">
                              {s.channel_name ?? "— empty —"}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Sidebar: host, session, meta */}
                <div className="space-y-4">
                  {/* Host card */}
                  <div className="rounded-2xl border border-arena-border bg-arena-panel p-5">
                    <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                      <Crown className="h-3.5 w-3.5 text-amber-400" /> Host
                    </div>
                    {data.host ? (
                      <div className="flex items-center gap-3">
                        {data.host.avatar_url ? (
                          <img
                            src={data.host.avatar_url}
                            alt={data.host.display_name}
                            className="h-11 w-11 rounded-full object-cover ring-2 ring-arena-violet/40"
                          />
                        ) : (
                          <div className="grid h-11 w-11 place-items-center rounded-full bg-arena-violet/20 font-display text-lg font-bold text-arena-violet ring-2 ring-arena-violet/40">
                            {data.host.display_name.slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-white">
                            {data.host.display_name}
                            {isOwner && (
                              <span className="ml-2 rounded-full bg-arena-violet/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-arena-violet">
                                You
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            Match owner
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        No host assigned.
                      </div>
                    )}
                    {!isOwner && data.host && (
                      <Button
                        variant="arenaOutline"
                        size="sm"
                        className="mt-3 w-full"
                        onClick={() => toast.info("Tipping opens in the Arena")}
                      >
                        <Heart className="mr-1.5 h-3.5 w-3.5" /> Tip the host
                      </Button>
                    )}
                  </div>

                  {/* Your session */}
                  <div className="rounded-2xl border border-arena-border bg-arena-panel p-5">
                    <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                      <UsersIcon className="h-3.5 w-3.5 text-emerald-400" /> Your
                      access
                    </div>
                    {data.mySession ? (
                      <div className="space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Status</span>
                          <span className="font-semibold text-emerald-400">
                            {data.mySession.status}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Paid</span>
                          <span className="font-mono font-semibold text-white">
                            {money(data.mySession.amount_cents ?? 0)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Expires</span>
                          <span className="text-white/80">
                            {new Date(
                              data.mySession.expires_at,
                            ).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        You haven't entered this match yet.
                      </div>
                    )}
                  </div>

                  {/* Meta */}
                  <div className="rounded-2xl border border-arena-border bg-arena-panel p-5 text-xs">
                    <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                      <CalendarClock className="h-3.5 w-3.5 text-arena-pink" />{" "}
                      Schedule
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Starts</span>
                        <span className="text-white/85">
                          {data.match.starts_at
                            ? new Date(data.match.starts_at).toLocaleString()
                            : "TBD"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Created</span>
                        <span className="text-white/85">
                          {new Date(data.match.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Slots</span>
                        <span className="text-white/85">
                          {data.match.slot_count}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
