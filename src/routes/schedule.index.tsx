import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Calendar as CalendarIcon,
  Clock,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  RotateCcw,
  Users,
  Tv,
  Play,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { publicMatchesQuery } from "@/lib/matches.public.functions";

import sportNba from "@/assets/pgx/sport-nba.jpg";
import sportSoccer from "@/assets/pgx/sport-soccer.jpg";
import sportNhl from "@/assets/pgx/sport-nhl.jpg";

export const Route = createFileRoute("/schedule/")({
  head: () => ({
    meta: [
      { title: "Schedule — PGX Sports Lounge" },
      {
        name: "description",
        content: "See what's playing now and what's coming up in all lobbies.",
      },
    ],
  }),
  component: SchedulePage,
});

export default function SchedulePage() {
  const { data: dbMatches } = useQuery(publicMatchesQuery());

  const [activeLobby, setActiveLobby] = useState<"lobby1" | "lobby2" | "lobby3">("lobby1");
  const [dayFilter, setDayFilter] = useState<"today" | "tomorrow" | "7days">("today");
  const [timezone, setTimezone] = useState("UTC -05:00");
  const [selectedDate, setSelectedDate] = useState(25);
  const [isSynced, setIsSynced] = useState(true);

  // Sync to now handler
  const handleSyncNow = () => {
    setDayFilter("today");
    setSelectedDate(25);
    setIsSynced(true);
  };

  const primaryMatchId = dbMatches?.[0]?.id || "2674059e-a58f-4e27-a86d-0cc14bf4b711";

  // Schedule Table Rows Data
  const scheduleRows = [
    {
      time: "LIVE NOW",
      isLiveNow: true,
      tv1: { match: "Lakers vs Celtics", time: "6:32 - 9:00 PM", isLive: true, league: "NBA" },
      tv2: {
        match: "Real Madrid vs Barcelona",
        time: "7:24 - 9:15 PM",
        isLive: true,
        league: "La Liga",
      },
      tv3: { match: "UFC 302: Makhachev vs Poirier", time: "Round 2", isLive: true, league: "UFC" },
      tv4: {
        match: "Avalanche vs Golden Knights",
        time: "2nd Period - 11:47",
        isLive: true,
        league: "NHL",
      },
    },
    {
      time: "7:00 PM",
      tv1: { match: "Heat vs Warriors", time: "7:00 - 9:30 PM", league: "NBA" },
      tv2: {
        match: "Manchester City vs Arsenal",
        time: "7:00 - 9:00 PM",
        league: "Premier League",
      },
      tv3: { match: "Boxing: Davis vs Garcia", time: "7:00 - 9:30 PM", league: "Boxing" },
      tv4: { match: "Maple Leafs vs Bruins", time: "7:00 - 9:30 PM", league: "NHL" },
    },
    {
      time: "8:00 PM",
      tv1: { match: "Bucks vs Suns", time: "8:00 - 10:30 PM", league: "NBA" },
      tv2: { match: "AC Milan vs Inter", time: "8:00 - 10:00 PM", league: "Serie A" },
      tv3: { match: "UFC Fight Night", time: "8:00 - 11:00 PM", league: "UFC" },
      tv4: { match: "NFL Preseason", time: "8:00 - 11:00 PM", league: "NFL" },
    },
    {
      time: "9:00 PM",
      tv1: { match: "Nuggets vs Clippers", time: "9:00 - 11:30 PM", league: "NBA" },
      tv2: { match: "Liverpool vs Chelsea", time: "9:00 - 11:00 PM", league: "Premier League" },
      tv3: { match: "Boxing: Fury vs Usyk", time: "9:00 - 11:30 PM", league: "Boxing" },
      tv4: { match: "Yankees vs Red Sox", time: "9:00 - 11:30 PM", league: "MLB" },
    },
    {
      time: "10:00 PM",
      tv1: { match: "Kings vs Mavericks", time: "10:00 PM - 12:30 AM", league: "NBA" },
      tv2: { match: "PSG vs Marseille", time: "10:00 PM - 12:00 AM", league: "Ligue 1" },
      tv3: { match: "UFC 303", time: "10:00 PM - 1:00 AM", league: "UFC" },
      tv4: { match: "Rangers vs Lightning", time: "10:00 PM - 12:30 AM", league: "NHL" },
    },
    {
      time: "11:00 PM",
      tv1: { match: "Jazz vs Trail Blazers", time: "11:00 PM - 1:30 AM", league: "NBA" },
      tv2: { match: "Juventus vs Napoli", time: "11:00 PM - 1:00 AM", league: "Serie A" },
      tv3: { match: "Boxing Highlights", time: "11:00 PM - 12:00 AM", league: "Boxing" },
      tv4: { match: "MLB: Dodgers vs Giants", time: "11:00 PM - 1:30 AM", league: "MLB" },
    },
    {
      time: "12:00 AM",
      tv1: { match: "Late Night Hoops", time: "12:00 - 2:00 AM", league: "NBA" },
      tv2: { match: "La Liga Highlights", time: "12:00 - 1:00 AM", league: "La Liga" },
      tv3: { match: "UFC Classics", time: "12:00 - 2:00 AM", league: "UFC" },
      tv4: { match: "NHL Overtime", time: "12:00 - 2:00 AM", league: "NHL" },
    },
    {
      time: "1:00 AM",
      tv1: { match: "G League Showcase", time: "1:00 - 3:00 AM", league: "NBA" },
      tv2: { match: "Eredivisie: Ajax vs PSV", time: "1:00 - 3:00 AM", league: "Eredivisie" },
      tv3: { match: "Boxing Replay", time: "1:00 - 2:30 AM", league: "Boxing" },
      tv4: { match: "MLB Nightcap", time: "1:00 - 3:00 AM", league: "MLB" },
    },
  ];

  const upcomingHighlights = [
    { match: "Warriors vs Nuggets", time: "Tomorrow, 7:00 PM", category: "nba" },
    { match: "El Clásico: RMA vs BAR", time: "Tomorrow, 3:00 PM", category: "soccer" },
    { match: "UFC 304", time: "Tomorrow, 8:00 PM", category: "ufc" },
    { match: "Stanley Cup Playoffs", time: "Tomorrow, 7:30 PM", category: "nhl" },
  ];

  const liveNowInLobby = [
    { match: "Lakers vs Celtics", badge: "LIVE", matchId: primaryMatchId },
    { match: "Real Madrid vs Barcelona", badge: "LIVE", matchId: primaryMatchId },
    { match: "UFC 302", badge: "LIVE", matchId: primaryMatchId },
    { match: "Avalanche vs VGK", badge: "LIVE", matchId: primaryMatchId },
  ];

  return (
    <AppShell>
      <div className="bg-slate-950 min-h-screen text-slate-100 selection:bg-pink-500 selection:text-white">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">
          {/* Page Headline */}
          <div>
            <h1 className="text-3xl font-black uppercase tracking-tight text-white sm:text-4xl">
              SCHEDULE
            </h1>
            <p className="text-sm text-slate-400 pt-1">
              See what's playing now and what's coming up in all lobbies.
            </p>
          </div>

          {/* Controls Bar (Lobby Switcher + Day Filters + Timezone + Sync Button) */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 backdrop-blur-md shadow-xl">
            {/* Left Controls (Select Lobby + Today/Tomorrow/7 Days) */}
            <div className="flex flex-wrap items-center gap-4">
              {/* Select Lobby buttons */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
                  SELECT LOBBY
                </span>
                <div className="flex items-center gap-1.5">
                  {[
                    { id: "lobby1", label: "LOBBY 1" },
                    { id: "lobby2", label: "LOBBY 2" },
                    { id: "lobby3", label: "LOBBY 3" },
                  ].map((l) => (
                    <button
                      key={l.id}
                      onClick={() => setActiveLobby(l.id as any)}
                      className={`rounded-xl border px-3 py-1.5 text-xs font-black transition-all ${
                        activeLobby === l.id
                          ? "border-pink-500 bg-pink-500/10 text-white shadow-lg shadow-pink-500/20 ring-1 ring-pink-500/40"
                          : "border-slate-800 bg-slate-950/80 text-slate-400 hover:border-slate-700 hover:text-white"
                      }`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Day Filter Tabs */}
              <div className="flex items-center gap-1 bg-slate-950/90 rounded-xl p-1 border border-slate-800">
                {[
                  { id: "today", label: "TODAY" },
                  { id: "tomorrow", label: "TOMORROW" },
                  { id: "7days", label: "7 DAYS" },
                ].map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setDayFilter(d.id as any)}
                    className={`rounded-lg px-3 py-1 text-xs font-black transition-all ${
                      dayFilter === d.id
                        ? "bg-pink-600 text-white shadow-md"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Right Controls (Timezone Dropdown + Sync Button) */}
            <div className="flex items-center gap-3">
              <div className="relative">
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="h-9 rounded-xl border border-slate-800 bg-slate-950 px-3 pr-8 text-xs font-bold text-slate-300 focus:border-pink-500 focus:outline-none appearance-none cursor-pointer"
                >
                  <option value="UTC -05:00">TIMEZONE UTC -05:00</option>
                  <option value="UTC +00:00">TIMEZONE UTC +00:00</option>
                  <option value="UTC +06:00">TIMEZONE UTC +06:00</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              </div>

              <button
                type="button"
                onClick={handleSyncNow}
                className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-extrabold text-slate-200 hover:border-pink-500/50 hover:text-white transition-all"
              >
                <RotateCcw className="h-3.5 w-3.5 text-pink-400" />
                SYNC TO NOW
              </button>
            </div>
          </div>

          {/* Main Grid Section (Table + Right Sidebar) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Main Schedule Table (9 Columns) */}
            <div className="lg:col-span-9 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl backdrop-blur-md space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-white">
                  {activeLobby.toUpperCase()} SCHEDULE
                </h2>
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400">
                  <Users className="h-3.5 w-3.5 text-pink-400" />
                  <span>1,248 VIEWERS</span>
                </div>
              </div>

              {/* 4 TV Columns Schedule Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/80">
                      <th className="p-3 text-[10px] font-black uppercase text-slate-400 w-24">
                        + TIME
                      </th>
                      <th className="p-3 text-xs font-black text-white text-center border-l border-slate-800/80">
                        🏀 TV 1 - NBA
                      </th>
                      <th className="p-3 text-xs font-black text-white text-center border-l border-slate-800/80">
                        ⚽ TV 2 - SOCCER
                      </th>
                      <th className="p-3 text-xs font-black text-white text-center border-l border-slate-800/80">
                        🥊 TV 3 - UFC / BOXING
                      </th>
                      <th className="p-3 text-xs font-black text-white text-center border-l border-slate-800/80">
                        🏒 TV 4 - NHL / NFL / MLB
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {scheduleRows.map((row, idx) => (
                      <tr
                        key={idx}
                        className={`transition-colors hover:bg-slate-800/30 ${
                          row.isLiveNow ? "bg-pink-950/10" : ""
                        }`}
                      >
                        {/* Time Cell */}
                        <td className="p-3 font-bold text-slate-300 whitespace-nowrap">
                          {row.isLiveNow ? (
                            <span className="flex items-center gap-1.5 text-rose-500 font-black">
                              <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
                              LIVE NOW
                            </span>
                          ) : (
                            row.time
                          )}
                        </td>

                        {/* TV 1 Cell */}
                        <td className="p-3 border-l border-slate-800/80 text-center">
                          <Link
                            to="/arena/$matchId"
                            params={{ matchId: primaryMatchId }}
                            className="group block rounded-xl p-2 bg-slate-950/60 border border-slate-800/60 hover:border-pink-500/50 transition-all"
                          >
                            <div className="font-extrabold text-white group-hover:text-pink-400 transition-colors flex items-center justify-center gap-1">
                              {row.tv1.match}
                              {row.tv1.isLive && (
                                <span className="rounded bg-rose-600 px-1 py-0.5 text-[8px] font-black text-white uppercase">
                                  LIVE
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400 pt-0.5">{row.tv1.time}</div>
                          </Link>
                        </td>

                        {/* TV 2 Cell */}
                        <td className="p-3 border-l border-slate-800/80 text-center">
                          <Link
                            to="/arena/$matchId"
                            params={{ matchId: primaryMatchId }}
                            className="group block rounded-xl p-2 bg-slate-950/60 border border-slate-800/60 hover:border-pink-500/50 transition-all"
                          >
                            <div className="font-extrabold text-white group-hover:text-pink-400 transition-colors flex items-center justify-center gap-1">
                              {row.tv2.match}
                              {row.tv2.isLive && (
                                <span className="rounded bg-rose-600 px-1 py-0.5 text-[8px] font-black text-white uppercase">
                                  LIVE
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400 pt-0.5">{row.tv2.time}</div>
                          </Link>
                        </td>

                        {/* TV 3 Cell */}
                        <td className="p-3 border-l border-slate-800/80 text-center">
                          <Link
                            to="/arena/$matchId"
                            params={{ matchId: primaryMatchId }}
                            className="group block rounded-xl p-2 bg-slate-950/60 border border-slate-800/60 hover:border-pink-500/50 transition-all"
                          >
                            <div className="font-extrabold text-white group-hover:text-pink-400 transition-colors flex items-center justify-center gap-1">
                              {row.tv3.match}
                              {row.tv3.isLive && (
                                <span className="rounded bg-rose-600 px-1 py-0.5 text-[8px] font-black text-white uppercase">
                                  LIVE
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400 pt-0.5">{row.tv3.time}</div>
                          </Link>
                        </td>

                        {/* TV 4 Cell */}
                        <td className="p-3 border-l border-slate-800/80 text-center">
                          <Link
                            to="/arena/$matchId"
                            params={{ matchId: primaryMatchId }}
                            className="group block rounded-xl p-2 bg-slate-950/60 border border-slate-800/60 hover:border-pink-500/50 transition-all"
                          >
                            <div className="font-extrabold text-white group-hover:text-pink-400 transition-colors flex items-center justify-center gap-1">
                              {row.tv4.match}
                              {row.tv4.isLive && (
                                <span className="rounded bg-rose-600 px-1 py-0.5 text-[8px] font-black text-white uppercase">
                                  LIVE
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400 pt-0.5">{row.tv4.time}</div>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right Sidebar (3 Columns Layout: Calendar + Highlights + Live Now) */}
            <div className="lg:col-span-3 space-y-4">
              {/* Calendar Widget */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl backdrop-blur-md space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-white">
                  <ChevronLeft className="h-4 w-4 cursor-pointer text-slate-400 hover:text-white" />
                  <span className="uppercase tracking-wider">MAY 25, 2026</span>
                  <ChevronRight className="h-4 w-4 cursor-pointer text-slate-400 hover:text-white" />
                </div>

                <div className="grid grid-cols-7 text-center text-[10px] font-extrabold text-slate-400">
                  <span>SU</span>
                  <span>MO</span>
                  <span>TU</span>
                  <span>WE</span>
                  <span>TH</span>
                  <span>FR</span>
                  <span>SA</span>
                </div>

                <div className="grid grid-cols-7 text-center text-xs font-bold gap-1">
                  {[18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31].map((d) => (
                    <button
                      key={d}
                      onClick={() => setSelectedDate(d)}
                      className={`h-7 w-7 rounded-lg flex items-center justify-center transition-all ${
                        selectedDate === d
                          ? "border-2 border-pink-500 bg-pink-500/20 text-white font-black"
                          : "text-slate-300 hover:bg-slate-800"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              {/* Upcoming Highlights Widget */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl backdrop-blur-md space-y-3">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-white border-b border-slate-800 pb-2">
                  UPCOMING HIGHLIGHTS
                </h3>

                <div className="space-y-2.5">
                  {upcomingHighlights.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-xs rounded-xl border border-slate-800 bg-slate-950 p-2.5"
                    >
                      <div>
                        <div className="font-bold text-white">{item.match}</div>
                        <div className="text-[10px] text-slate-400 pt-0.5">{item.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Live Now in Lobby Widget */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl backdrop-blur-md space-y-3">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-white border-b border-slate-800 pb-2">
                  LIVE NOW IN {activeLobby.toUpperCase()}
                </h3>

                <div className="space-y-2">
                  {liveNowInLobby.map((item, idx) => (
                    <Link
                      key={idx}
                      to="/arena/$matchId"
                      params={{ matchId: item.matchId }}
                      className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950 p-2 text-xs font-bold text-white hover:border-pink-500/40"
                    >
                      <span>{item.match}</span>
                      <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[9px] font-extrabold text-white">
                        {item.badge}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
