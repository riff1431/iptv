import { useState, useEffect, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn as useSF } from "@tanstack/react-start";
import { Users, Tv as TvIcon, Play, Compass, Ticket, Crown, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { publicMatchesQuery } from "@/lib/matches.public.functions";
import { publicLoungesQuery } from "@/lib/lounges.public.functions";
import { upgradeUserVip } from "@/lib/wallet.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

import sportNba from "@/assets/pgx/sport-nba.jpg";
import sportSoccer from "@/assets/pgx/sport-soccer.jpg";
import sportNhl from "@/assets/pgx/sport-nhl.jpg";
import sportNfl from "@/assets/pgx/sport-nfl.jpg";
import creator1 from "@/assets/pgx/creator-1.jpg";
import creator2 from "@/assets/pgx/creator-2.jpg";
import creator3 from "@/assets/pgx/creator-3.jpg";
import creator4 from "@/assets/pgx/creator-4.jpg";
import creatorLive from "@/assets/pgx/creator-live.jpg";

export default function UserDashboardHome() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: dbMatches = [] } = useQuery(publicMatchesQuery());
  const { data: dbLounges = [] } = useQuery(publicLoungesQuery());

  const [trendingTab, setTrendingTab] = useState<"popular" | "new" | "rated" | "friends">(
    "popular",
  );
  const [notifiedEvents, setNotifiedEvents] = useState<Record<string, boolean>>({});
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Tick for countdowns
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch real profiles for leaderboard
  const { data: dbProfiles = [] } = useQuery({
    queryKey: ["publicProfiles"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .limit(10);
      return data || [];
    },
  });

  // Fetch wallet overview
  const { data: walletOverview } = useQuery({
    queryKey: ["walletOverview"],
    queryFn: async () => {
      const { getWalletOverview } = await import("@/lib/wallet.functions");
      return getWalletOverview();
    },
  });

  const upgradeVipFn = useSF(upgradeUserVip);

  // VIP Upgrade Mutation
  const upgradeVipMutation = useMutation({
    mutationFn: () => upgradeVipFn(),
    onSuccess: () => {
      toast.success("Successfully upgraded to VIP! Welcome to the PGX club!");
      qc.invalidateQueries({ queryKey: ["walletOverview"] });
      // Reload window to refresh global auth state
      setTimeout(() => window.location.reload(), 1500);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const toggleNotify = (id: string) => {
    setNotifiedEvents((prev) => ({ ...prev, [id]: !prev[id] }));
    toast.success(
      notifiedEvents[id] ? "Notification disabled" : "We will notify you when this match starts!",
    );
  };

  const displayName =
    user?.user_metadata?.display_name || user?.email?.split("@")[0] || "Demo Viewer";
  const isVip = user?.user_metadata?.is_vip === true;

  // 1. Extract live and upcoming matches
  const liveMatches = useMemo(() => dbMatches.filter((m) => m.status === "live"), [dbMatches]);
  const upcomingMatches = useMemo(
    () => dbMatches.filter((m) => m.status === "scheduled"),
    [dbMatches],
  );

  // 2. Featured Banner Match
  const featuredMatch = useMemo(() => {
    return liveMatches[0] || upcomingMatches[0] || dbMatches[0] || null;
  }, [liveMatches, upcomingMatches, dbMatches]);

  const primaryMatchId = featuredMatch?.id || "2674059e-a58f-4e27-a86d-0cc14bf4b711";

  // 3. Upcoming Schedule list
  const scheduleItems = useMemo(() => {
    const items = upcomingMatches.slice(0, 5);
    // fallback if no upcoming matches exist in database
    if (items.length === 0) {
      return [
        {
          id: "1",
          time: "8:00 PM Today",
          match: "Man United vs Chelsea",
          league: "Premier League",
          fee: "€5",
        },
        { id: "2", time: "9:30 PM Today", match: "Warriors vs Nuggets", league: "NBA", fee: "€5" },
        { id: "3", time: "11:00 PM Today", match: "Fury vs Usyk", league: "Boxing", fee: "€5" },
      ];
    }
    return items.map((m) => {
      const timeStr = m.startsAt
        ? new Date(m.startsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) +
          " " +
          new Date(m.startsAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : "Upcoming";
      return {
        id: m.id,
        time: timeStr,
        match: m.title,
        league: m.sport || "Sports",
        fee: "€5",
      };
    });
  }, [upcomingMatches]);

  // 4. Top Fans Leaderboard (from real DB profiles)
  const topFans = useMemo(() => {
    const list = dbProfiles.slice(0, 5);
    const avatars = [creatorLive, creator1, creator2, creator3, creator4];
    // fallbacks if DB has too few profiles
    const fallbackNames = ["John Smith", "Mike Tyson", "Sarah Johnson", "Alex Brown", "David Lee"];
    const pointsList = ["4,250 pts", "3,820 pts", "3,150 pts", "2,780 pts", "2,450 pts"];

    return Array.from({ length: 5 }).map((_, idx) => {
      const prof = list[idx];
      return {
        rank: idx + 1,
        name: prof?.display_name || fallbackNames[idx],
        points: pointsList[idx],
        avatar: prof?.avatar_url || avatars[idx],
        isGold: idx === 0,
        isSilver: idx === 1,
        isBronze: idx === 2,
      };
    });
  }, [dbProfiles]);

  // 5. Live Lobbies list
  const liveNowCards = useMemo(() => {
    const list = liveMatches.slice(0, 3);
    const sportsPics = [sportNba, sportSoccer, sportNhl];
    if (list.length === 0) {
      // Fallback matching Image 5
      return [
        {
          id: "2674059e-a58f-4e27-a86d-0cc14bf4b711",
          tv: "TV 1",
          title: "Lakers vs Celtics",
          league: "NBA",
          viewers: 428,
          fee: "€5",
          img: sportNba,
        },
        {
          id: "83acf813-e0db-46ba-aa15-3b9fb8ccd2a8",
          tv: "TV 3",
          title: "UFC 302: Makhachev vs Poirier",
          league: "UFC",
          viewers: 612,
          fee: "€5",
          img: sportSoccer,
        },
        {
          id: "058dd5fe-312f-44b5-87dc-c5e954dc6355",
          tv: "TV 4",
          title: "Maple Leafs vs Bruins",
          league: "NHL",
          viewers: 289,
          fee: "€5",
          img: sportNhl,
        },
      ];
    }
    return list.map((m, i) => ({
      id: m.id,
      tv: `TV ${i + 1}`,
      title: m.title,
      league: m.sport || "Lounge",
      viewers: m.viewerCount || 100 + i * 150,
      fee: "€5",
      img: m.thumbnailUrl || sportsPics[i % sportsPics.length],
    }));
  }, [liveMatches]);

  // 6. Real countdowns to upcoming matches
  const countdownEvents = useMemo(() => {
    const items = upcomingMatches.slice(0, 4);
    if (items.length === 0) {
      return [
        {
          id: "u1",
          title: "CHAMPIONS LEAGUE FINAL",
          date: "June 1, 2026",
          days: "06",
          hrs: "12",
          min: "45",
        },
        { id: "u2", title: "UFC 305", date: "June 8, 2026", days: "12", hrs: "09", min: "15" },
        { id: "u3", title: "NBA FINALS", date: "June 6, 2026", days: "09", hrs: "14", min: "30" },
      ];
    }
    return items.map((m, idx) => {
      const diffMs = m.startsAt ? new Date(m.startsAt).getTime() - currentTime : 0;
      const totalSec = Math.max(0, Math.floor(diffMs / 1000));
      const days = Math.floor(totalSec / 86400);
      const hrs = Math.floor((totalSec % 86400) / 3600);
      const min = Math.floor((totalSec % 3600) / 60);

      const dStr = String(days).padStart(2, "0");
      const hStr = String(hrs).padStart(2, "0");
      const mStr = String(min).padStart(2, "0");

      return {
        id: m.id,
        title: m.title.toUpperCase(),
        date: m.startsAt
          ? new Date(m.startsAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : "Upcoming",
        days: dStr,
        hrs: hStr,
        min: mStr,
      };
    });
  }, [upcomingMatches, currentTime]);

  // 7. Regular and Creator Lobbies (from DB Lounges)
  const regularLobbies = useMemo(() => {
    const list = dbLounges.filter((l) => l.entryFeeCents <= 500).slice(0, 4);
    if (list.length === 0) {
      return liveNowCards;
    }
    return list.map((l, idx) => ({
      id: l.id,
      title: l.name,
      league: l.tagline || "Lobby",
      viewers: l.viewerCount || 350 + idx * 120,
      fee: `€${(l.entryFeeCents / 100).toFixed(0)}`,
      img: liveNowCards[idx % liveNowCards.length].img,
    }));
  }, [dbLounges, liveNowCards]);

  const creatorLobbies = useMemo(() => {
    const list = dbLounges.filter((l) => l.entryFeeCents > 500).slice(0, 3);
    const avatars = [creator1, creator2, creator3];
    if (list.length === 0) {
      return [
        { name: "SophiaL_Xo", title: "NBA Lounge", viewers: "1.2K", avatar: creator1, fee: "€10" },
        {
          name: "NinaRose",
          title: "UFC Watch Party",
          viewers: "980",
          avatar: creator2,
          fee: "€10",
        },
        {
          name: "JessySports",
          title: "Soccer Fan Zone",
          viewers: "650",
          avatar: creator3,
          fee: "€10",
        },
      ];
    }
    return list.map((l, idx) => ({
      name: l.name.replace("'s Lounge", "").replace("'s Arena", ""),
      title: l.tagline || "Creator watch party",
      viewers: `${(l.viewerCount / 1000).toFixed(1)}K`,
      avatar: avatars[idx % avatars.length],
      fee: `€${(l.entryFeeCents / 100).toFixed(0)}`,
    }));
  }, [dbLounges]);

  // Favorite teams extracted from DB matches
  const favoriteTeams = useMemo(() => {
    const teams = [];
    for (const m of dbMatches) {
      if (m.homeLabel)
        teams.push({
          name: m.homeLabel,
          league: m.sport || "Sports",
          img: m.thumbnailUrl || sportSoccer,
        });
      if (m.awayLabel)
        teams.push({
          name: m.awayLabel,
          league: m.sport || "Sports",
          img: m.thumbnailUrl || sportSoccer,
        });
    }
    // Fallback if too few teams
    if (teams.length < 4) {
      return [
        { name: "Lakers", league: "NBA", img: sportNba, live: true, viewers: 428 },
        { name: "Real Madrid", league: "La Liga", img: sportSoccer, live: true, viewers: 356 },
        { name: "Maple Leafs", league: "NHL", img: sportNhl, time: "Today 9:00 PM" },
        { name: "Man United", league: "Premier League", img: sportNfl, time: "Today 8:00 PM" },
      ];
    }
    return teams.slice(0, 4).map((t, idx) => ({
      name: t.name,
      league: t.league,
      img: t.img,
      live: idx % 2 === 0,
      viewers: 250 + idx * 80,
      time: "Today 8:00 PM",
    }));
  }, [dbMatches]);

  return (
    <div className="space-y-6">
      {/* Top Hero Dashboard Grid (3 Columns Layout matching Image 2) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Welcome Card (Left - 3 Cols) */}
        <div className="lg:col-span-3 flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl backdrop-blur-md">
          <div className="space-y-3">
            <div className="text-xs font-semibold text-slate-400">Welcome back,</div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-black text-white truncate">{displayName}</span>
              {isVip && (
                <span className="rounded bg-gradient-to-r from-purple-600 to-pink-600 px-2 py-0.5 text-[9px] font-extrabold uppercase text-white shadow-sm">
                  VIP
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Enjoy the best sports action, live and in real time!
            </p>

            <div className="pt-2 flex flex-wrap items-center gap-4 text-xs font-bold text-slate-300">
              <span className="flex items-center gap-1.5 text-pink-400">
                <span className="h-2 w-2 rounded-full bg-pink-500 animate-pulse" />
                {dbLounges.length || 12} Live Lobbies
              </span>
              <span className="flex items-center gap-1.5 text-slate-400">
                <Users className="h-3.5 w-3.5 text-cyan-400" />
                1,248 Online
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-6">
            <Link to="/lobby">
              <Button
                size="sm"
                className="w-full h-9 text-xs font-bold bg-pink-600 hover:bg-pink-500 text-white rounded-xl shadow-lg shadow-pink-600/20"
              >
                <Compass className="mr-1.5 h-3.5 w-3.5" />
                Explore Lobby
              </Button>
            </Link>
            <Link to="/schedule">
              <Button
                size="sm"
                variant="outline"
                className="w-full h-9 text-xs font-bold border-slate-800 bg-slate-950/80 text-slate-300 hover:text-white rounded-xl"
              >
                <Ticket className="mr-1.5 h-3.5 w-3.5" />
                My Tickets
              </Button>
            </Link>
          </div>
        </div>

        {/* Featured Live Match Banner (Center - 6 Cols) */}
        {featuredMatch ? (
          <div className="lg:col-span-6 relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl group min-h-[220px] flex flex-col justify-end p-6">
            <img
              src={featuredMatch.thumbnailUrl || sportSoccer}
              alt="Featured Match"
              className="absolute inset-0 h-full w-full object-cover opacity-40 transition-transform duration-700 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/60 to-transparent" />

            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-600/90 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-white shadow-lg backdrop-blur-md">
                <span className="h-2 w-2 rounded-full bg-white animate-ping" />
                {featuredMatch.status === "live" ? "LIVE NOW" : "UPCOMING"}
              </span>
            </div>

            <div className="relative z-10 text-center space-y-2">
              <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                {featuredMatch.title}
              </h2>
              <div className="text-xs font-bold text-slate-300 uppercase">
                {featuredMatch.sport || "Match"}
              </div>
              <div className="flex items-center justify-center gap-1 text-xs text-pink-400 font-semibold">
                <Users className="h-3.5 w-3.5" />
                <span>{featuredMatch.viewerCount || 356} watching</span>
              </div>

              <Link
                to="/arena/$matchId"
                params={{ matchId: primaryMatchId }}
                className="inline-block pt-2"
              >
                <Button className="h-11 px-8 rounded-xl font-extrabold text-xs uppercase tracking-wider bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 hover:from-pink-500 hover:to-indigo-500 text-white shadow-lg shadow-pink-500/25 transition-all">
                  <Play className="mr-2 h-4 w-4 fill-white" />
                  Watch Now
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="lg:col-span-6 relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl min-h-[220px] flex items-center justify-center p-6 text-slate-500">
            No matches loaded in database.
          </div>
        )}

        {/* Upcoming Schedule (Right - 3 Cols) */}
        <div className="lg:col-span-3 flex flex-col rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl backdrop-blur-md">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
            <h2 className="text-xs font-extrabold uppercase tracking-wider text-white">
              Upcoming Schedule
            </h2>
            <Link
              to="/schedule"
              className="text-[10px] font-semibold text-pink-400 hover:underline"
            >
              View All
            </Link>
          </div>

          <div className="divide-y divide-slate-800/60 pt-1 flex-1 overflow-y-auto custom-scrollbar">
            {scheduleItems.map((item) => (
              <div key={item.id} className="py-2.5 flex items-center justify-between text-xs gap-2">
                <div className="min-w-0">
                  <div className="font-extrabold text-white truncate">{item.match}</div>
                  <div className="text-[10px] text-slate-400 truncate">
                    {item.time} • {item.league}
                  </div>
                </div>
                <span className="rounded bg-pink-500/10 border border-pink-500/30 px-2 py-0.5 text-[10px] font-extrabold text-pink-400 shrink-0">
                  {item.fee} Entry
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Middle Section Row 1 (Continue Watching + Live Now + Leaderboard) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Continue Watching (3 Cols) */}
        <div className="lg:col-span-3 flex flex-col rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl backdrop-blur-md">
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-white pb-3 border-b border-slate-800/80">
            Continue Watching
          </h2>
          {featuredMatch ? (
            <div className="pt-3 space-y-3 flex-1 flex flex-col justify-between">
              <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-slate-950 border border-slate-800">
                <img
                  src={featuredMatch.thumbnailUrl || sportSoccer}
                  alt=""
                  className="h-full w-full object-cover opacity-70"
                />
                <div className="absolute top-2 left-2 rounded bg-rose-600 px-1.5 py-0.5 text-[9px] font-extrabold text-white">
                  TV 1
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-white truncate">{featuredMatch.title}</div>
                  <div className="text-[10px] text-slate-400 truncate">
                    {featuredMatch.sport || "Lounge"}
                  </div>
                </div>
                <Link to="/arena/$matchId" params={{ matchId: primaryMatchId }}>
                  <Button
                    size="sm"
                    className="h-7 px-2.5 text-[10px] font-bold bg-pink-600 hover:bg-pink-500 text-white rounded-lg shrink-0"
                  >
                    <Play className="mr-1 h-3 w-3 fill-white" /> Resume
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="pt-8 text-center text-xs text-slate-500">No watch history found.</div>
          )}
        </div>

        {/* Live Now (6 Cols) */}
        <div className="lg:col-span-6 flex flex-col rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl backdrop-blur-md">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
            <h2 className="text-xs font-extrabold uppercase tracking-wider text-white">Live Now</h2>
            <Link to="/lobby" className="text-[10px] font-semibold text-pink-400 hover:underline">
              View All
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3">
            {liveNowCards.map((card) => (
              <Link
                key={card.id}
                to="/arena/$matchId"
                params={{ matchId: card.id }}
                className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950 transition-all hover:border-pink-500/50"
              >
                <div className="relative h-28 w-full overflow-hidden">
                  <img
                    src={card.img}
                    alt={card.title}
                    className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                  />
                  <div className="absolute top-2 left-2 rounded bg-rose-600 px-1.5 py-0.5 text-[9px] font-extrabold text-white">
                    {card.tv}
                  </div>
                </div>
                <div className="p-2.5 flex-1 flex flex-col justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white truncate">{card.title}</div>
                    <div className="text-[10px] text-slate-400 truncate">{card.league}</div>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-pink-400 font-bold pt-1">
                    <span>{card.viewers} watching</span>
                    <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-purple-300">
                      {card.fee} Entry
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Top Fans Leaderboard (3 Cols) */}
        <div className="lg:col-span-3 flex flex-col rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl backdrop-blur-md">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
            <h2 className="text-xs font-extrabold uppercase tracking-wider text-white">
              Top Fans This Week
            </h2>
            <span className="text-[10px] font-semibold text-pink-400 hover:underline cursor-pointer">
              View All
            </span>
          </div>

          <div className="divide-y divide-slate-800/60 pt-1">
            {topFans.map((fan) => (
              <div key={fan.rank} className="py-2 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                      fan.isGold
                        ? "bg-amber-400 text-slate-950"
                        : fan.isSilver
                          ? "bg-slate-300 text-slate-950"
                          : fan.isBronze
                            ? "bg-amber-700 text-white"
                            : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {fan.rank}
                  </span>
                  <div className="h-6 w-6 shrink-0 rounded-full overflow-hidden bg-slate-800 border border-slate-700">
                    <img src={fan.avatar} alt={fan.name} className="h-full w-full object-cover" />
                  </div>
                  <span className="font-bold text-white truncate">{fan.name}</span>
                </div>
                <span className="text-[10px] font-bold text-pink-400 shrink-0">{fan.points}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Middle Section Row 2 (Trending Lobbies + Creator Lobbies + Major Events) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Trending Lobbies (5 Cols) */}
        <div className="lg:col-span-5 flex flex-col rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl backdrop-blur-md">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
            <h2 className="text-xs font-extrabold uppercase tracking-wider text-white">
              Trending Lobbies
            </h2>
            <div className="flex items-center gap-1">
              {[
                { id: "popular", label: "🔥 Most Popular" },
                { id: "new", label: "🆕 Newly Created" },
                { id: "rated", label: "⭐ Highest Rated" },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setTrendingTab(f.id as any)}
                  className={`rounded-lg px-2 py-1 text-[9px] font-bold transition-colors ${
                    trendingTab === f.id
                      ? "bg-pink-600 text-white"
                      : "bg-slate-800/80 text-slate-400 hover:text-white"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-3">
            {regularLobbies.map((card, idx) => (
              <Link
                key={idx}
                to="/arena/$matchId"
                params={{ matchId: primaryMatchId }}
                className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-950 p-2.5 transition-all hover:border-pink-500/50"
              >
                <div className="text-xs font-bold text-white truncate">{card.title}</div>
                <div className="text-[10px] text-slate-400 truncate">{card.league}</div>
                <div className="flex items-center justify-between text-[10px] text-pink-400 font-bold pt-2">
                  <span>{card.viewers} watching</span>
                  <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-purple-300">
                    {card.fee} Entry
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Creator Lobbies Live (3 Cols) */}
        <div className="lg:col-span-3 flex flex-col rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl backdrop-blur-md">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
            <h2 className="text-xs font-extrabold uppercase tracking-wider text-white">
              Creator Lobbies Live
            </h2>
            <Link to="/lobby" className="text-[10px] font-semibold text-pink-400 hover:underline">
              View All
            </Link>
          </div>

          <div className="space-y-2.5 pt-3">
            {creatorLobbies.map((c, i) => (
              <Link
                key={i}
                to="/lobby"
                className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950 p-2 hover:border-pink-500/40"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="relative h-8 w-8 shrink-0 rounded-full overflow-hidden border border-pink-500/60">
                    <img src={c.avatar} alt={c.name} className="h-full w-full object-cover" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white truncate">{c.name}</div>
                    <div className="text-[10px] text-slate-400 truncate">{c.title}</div>
                  </div>
                </div>
                <span className="rounded bg-pink-500/10 px-2 py-0.5 text-[10px] font-bold text-pink-400 shrink-0">
                  {c.fee}
                </span>
              </Link>
            ))}
          </div>
        </div>

        {/* Major Events Countdowns (4 Cols) */}
        <div className="lg:col-span-4 flex flex-col rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl backdrop-blur-md">
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-white pb-3 border-b border-slate-800/80">
            Major Events Countdown
          </h2>

          <div className="grid grid-cols-2 gap-2.5 pt-3 flex-1">
            {countdownEvents.map((ev) => (
              <div
                key={ev.id}
                className="rounded-xl border border-slate-800 bg-slate-950 p-2.5 flex flex-col justify-between"
              >
                <div>
                  <div className="text-[10px] font-black text-pink-400 uppercase truncate">
                    {ev.title}
                  </div>
                  <div className="text-[9px] text-slate-400 pt-0.5">{ev.date}</div>
                  <div className="flex items-center gap-1 pt-2 font-mono text-xs font-bold text-white">
                    <span>{ev.days}d</span>:<span>{ev.hrs}h</span>:<span>{ev.min}m</span>
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => toggleNotify(ev.id)}
                  className={`mt-2.5 h-6 text-[9px] font-bold rounded-lg ${
                    notifiedEvents[ev.id]
                      ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                      : "bg-purple-600 hover:bg-purple-500 text-white"
                  }`}
                >
                  {notifiedEvents[ev.id] ? "Notified ✓" : "Notify Me"}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Section (Favorite Teams + VIP Banner) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Your Favorite Teams (8 Cols) */}
        <div className="lg:col-span-8 flex flex-col rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl backdrop-blur-md">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
            <h2 className="text-xs font-extrabold uppercase tracking-wider text-white">
              Your Favorite Teams
            </h2>
            <span className="text-[10px] font-semibold text-pink-400 hover:underline cursor-pointer">
              Manage
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3">
            {favoriteTeams.map((team, idx) => (
              <div
                key={idx}
                className="flex flex-col items-center text-center p-3 rounded-xl border border-slate-800 bg-slate-950"
              >
                <div className="h-10 w-10 rounded-full overflow-hidden bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0">
                  <img src={team.img} alt={team.name} className="h-full w-full object-cover" />
                </div>
                <div className="text-xs font-bold text-white pt-2 truncate w-full">{team.name}</div>
                <div className="text-[10px] text-slate-400 truncate w-full">{team.league}</div>
                <div className="text-[9px] text-pink-400 font-bold pt-1 truncate w-full">
                  {team.live ? `${team.viewers} watching` : team.time}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* VIP Membership Banner (4 Cols) */}
        <div className="lg:col-span-4 rounded-2xl border border-purple-500/40 bg-gradient-to-r from-purple-950/60 via-slate-900 to-pink-950/60 p-5 shadow-xl backdrop-blur-md flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-amber-400" />
              <h3 className="text-sm font-extrabold uppercase tracking-wider text-white">
                VIP Membership
              </h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Get exclusive access to VIP lounges, private rooms, and premium features.
            </p>
          </div>

          <div className="pt-4">
            <Button
              onClick={() => upgradeVipMutation.mutate()}
              disabled={isVip || upgradeVipMutation.isPending}
              className={`w-full h-10 rounded-xl font-extrabold text-xs uppercase tracking-wider text-white shadow-lg ${
                isVip
                  ? "bg-emerald-600 cursor-default"
                  : "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 shadow-pink-500/20"
              }`}
            >
              {upgradeVipMutation.isPending
                ? "Upgrading..."
                : isVip
                  ? "Active VIP ✓"
                  : "Upgrade Now ($19.99)"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
