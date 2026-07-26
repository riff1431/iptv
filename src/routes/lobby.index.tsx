import { Link, createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Tv,
  Users,
  Search,
  ChevronDown,
  CheckCircle2,
  Sparkles,
  MessageCircle,
  Crown,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { publicLoungesQuery } from "@/lib/lounges.public.functions";
import { publicMatchesQuery } from "@/lib/matches.public.functions";

import sportNba from "@/assets/pgx/sport-nba.jpg";
import sportSoccer from "@/assets/pgx/sport-soccer.jpg";
import sportNhl from "@/assets/pgx/sport-nhl.jpg";
import sportNfl from "@/assets/pgx/sport-nfl.jpg";
import creator1 from "@/assets/pgx/creator-1.jpg";
import creator2 from "@/assets/pgx/creator-2.jpg";
import creator3 from "@/assets/pgx/creator-3.jpg";
import creatorLive from "@/assets/pgx/creator-live.jpg";

export const Route = createFileRoute("/lobby/")({
  head: () => ({
    meta: [
      { title: "PGX Sports Lounge — Choose Your Lobby" },
      {
        name: "description",
        content:
          "Join regular sports lobbies or creator watch parties to enjoy the action your way.",
      },
    ],
  }),
  component: DedicatedLobbyPage,
});

type LobbyTypeFilter = "all" | "regular" | "creator";
type SportCategory = "all" | "football" | "basketball" | "mma" | "hockey" | "other";

export function DedicatedLobbyPage() {
  const { data: dbLounges } = useQuery(publicLoungesQuery());
  const { data: dbMatches } = useQuery(publicMatchesQuery());

  const [selectedType, setSelectedType] = useState<LobbyTypeFilter>("all");
  const [selectedCategory, setSelectedCategory] = useState<SportCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"popular" | "viewers" | "new">("popular");

  // Default Regular Lobbies Data
  const defaultRegular = [
    {
      id: "2bf6ac80-1b10-4ef1-9ed8-61416942aec4",
      title: "Sports Central",
      subtitle: "All your favorite games live",
      viewers: "2.4K",
      fee: "€5 ENTRY",
      gamesBadge: "4 LIVE GAMES",
      category: "all",
      matchId: dbMatches?.[0]?.id || "2674059e-a58f-4e27-a86d-0cc14bf4b711",
      thumbnails: [sportNba, sportSoccer, sportNhl, sportNfl],
    },
    {
      id: "0818f104-9fcf-4f5d-a25a-0930fec358c9",
      title: "Game On Arena",
      subtitle: "Non-stop sports action",
      viewers: "1.8K",
      fee: "€5 ENTRY",
      gamesBadge: "4 LIVE GAMES",
      category: "football",
      matchId: dbMatches?.[1]?.id || "83acf813-e0db-46ba-aa15-3b9fb8ccd2a8",
      thumbnails: [sportSoccer, sportNba, sportNhl, sportNfl],
    },
    {
      id: "8ff571e7-746f-46c0-96d9-a7c285df46ca",
      title: "Elite Sports Hub",
      subtitle: "Top leagues. All in one place",
      viewers: "1.6K",
      fee: "€5 ENTRY",
      gamesBadge: "4 LIVE GAMES",
      category: "basketball",
      matchId: dbMatches?.[2]?.id || "058dd5fe-312f-44b5-87dc-c5e954dc6355",
      thumbnails: [sportSoccer, sportNba, sportNhl, sportNfl],
    },
    {
      id: "af34701d-8609-45ef-bf3f-51fc55244fbe",
      title: "Fan Zone",
      subtitle: "4 games. 1 epic view.",
      viewers: "1.2K",
      fee: "€5 ENTRY",
      gamesBadge: "4 LIVE GAMES",
      category: "mma",
      matchId: dbMatches?.[3]?.id || "2f318f85-efcf-4cf1-8a83-78f870d3c0dd",
      thumbnails: [sportNfl, sportNba, sportNhl, sportSoccer],
    },
  ];

  // Default Creator Lobbies Data
  const defaultCreator = [
    {
      id: "34fe72a6-4944-47f0-a8f8-38458d3db63c",
      creatorName: "SophiaL_Xo's Lounge",
      subtitle: "Chill vibes & big plays",
      viewers: "2.1K",
      fee: "€10 ENTRY",
      avatar: creator1,
      category: "basketball",
      matchId: dbMatches?.[0]?.id || "2674059e-a58f-4e27-a86d-0cc14bf4b711",
      thumbnails: [sportNba, sportSoccer, sportNhl, sportNfl],
    },
    {
      id: "5ad4138b-92a8-4908-8dd8-6e74e21df8e5",
      creatorName: "LunaLove's Arena",
      subtitle: "Let's talk & watch",
      viewers: "1.7K",
      fee: "€10 ENTRY",
      avatar: creatorLive,
      category: "football",
      matchId: dbMatches?.[1]?.id || "83acf813-e0db-46ba-aa15-3b9fb8ccd2a8",
      thumbnails: [sportSoccer, sportNba, sportNhl, sportNfl],
    },
    {
      id: "2e51f88b-5c81-41dc-aaca-a07449c68bbb",
      creatorName: "NinaRose's Sports Night",
      subtitle: "Good games, great company",
      viewers: "1.5K",
      fee: "€10 ENTRY",
      avatar: creator2,
      category: "mma",
      matchId: dbMatches?.[2]?.id || "058dd5fe-312f-44b5-87dc-c5e954dc6355",
      thumbnails: [sportSoccer, sportNba, sportNfl, sportNhl],
    },
    {
      id: "753ae0da-c091-43cf-94ee-286cffff0859",
      creatorName: "VioletXX Livezone",
      subtitle: "Chat. React. Enjoy.",
      viewers: "1.2K",
      fee: "€10 ENTRY",
      avatar: creator3,
      category: "hockey",
      matchId: dbMatches?.[3]?.id || "2f318f85-efcf-4cf1-8a83-78f870d3c0dd",
      thumbnails: [sportSoccer, sportNfl, sportNhl, sportNba],
    },
  ];

  // Dynamic Supabase Regular Lobbies Mapping
  const regularLobbies = useMemo(() => {
    if (dbLounges && dbLounges.length > 0) {
      const regularDb = dbLounges.filter((l) => l.entryFeeCents <= 500);
      if (regularDb.length > 0) {
        return regularDb.map((l, i) => ({
          id: l.id,
          title: l.name,
          subtitle: l.tagline || "All your favorite games live",
          viewers: `${(l.viewerCount / 1000).toFixed(1)}K`,
          fee: `€${(l.entryFeeCents / 100).toFixed(0)} ENTRY`,
          gamesBadge: "4 LIVE GAMES",
          category: l.vibe || "all",
          matchId:
            dbMatches?.[i % (dbMatches.length || 1)]?.id || "2674059e-a58f-4e27-a86d-0cc14bf4b711",
          thumbnails: defaultRegular[i % defaultRegular.length].thumbnails,
        }));
      }
    }
    return defaultRegular;
  }, [dbLounges, dbMatches]);

  // Dynamic Supabase Creator Lobbies Mapping
  const creatorLobbies = useMemo(() => {
    if (dbLounges && dbLounges.length > 0) {
      const creatorDb = dbLounges.filter((l) => l.entryFeeCents > 500);
      if (creatorDb.length > 0) {
        return creatorDb.map((l, i) => ({
          id: l.id,
          creatorName: l.name,
          subtitle: l.tagline || "Chill vibes & big plays",
          viewers: `${(l.viewerCount / 1000).toFixed(1)}K`,
          fee: `€${(l.entryFeeCents / 100).toFixed(0)} ENTRY`,
          avatar: defaultCreator[i % defaultCreator.length].avatar,
          category: l.vibe || "all",
          matchId:
            dbMatches?.[i % (dbMatches.length || 1)]?.id || "2674059e-a58f-4e27-a86d-0cc14bf4b711",
          thumbnails: defaultCreator[i % defaultCreator.length].thumbnails,
        }));
      }
    }
    return defaultCreator;
  }, [dbLounges, dbMatches]);

  // Filtered Lists
  const filteredRegular = useMemo(() => {
    return regularLobbies.filter((l) => {
      const matchCat = selectedCategory === "all" || l.category === selectedCategory;
      const matchSearch =
        !searchQuery ||
        l.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        l.subtitle.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [selectedCategory, searchQuery, regularLobbies]);

  const filteredCreator = useMemo(() => {
    return creatorLobbies.filter((l) => {
      const matchCat = selectedCategory === "all" || l.category === selectedCategory;
      const matchSearch =
        !searchQuery ||
        l.creatorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        l.subtitle.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [selectedCategory, searchQuery, creatorLobbies]);

  return (
    <AppShell>
      <div className="bg-slate-950 min-h-screen text-slate-100 selection:bg-pink-500 selection:text-white">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">
          {/* Page Title & Headline */}
          <div>
            <h1 className="text-3xl font-black uppercase tracking-tight text-white sm:text-4xl">
              CHOOSE <span className="text-pink-500">YOUR LOBBY</span>
            </h1>
            <p className="text-sm text-slate-400 pt-1">
              Join a lobby and enjoy the action your way.
            </p>
          </div>

          {/* Lobby Type Selection Banner Cards (2 Big Cards) */}
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Regular Lobbies Card */}
            <button
              type="button"
              onClick={() => setSelectedType(selectedType === "regular" ? "all" : "regular")}
              className={`group relative flex items-center gap-4 rounded-2xl border p-5 text-left transition-all duration-300 ${
                selectedType === "regular" || selectedType === "all"
                  ? "border-cyan-500/60 bg-gradient-to-r from-cyan-950/40 via-slate-900 to-slate-900 shadow-xl shadow-cyan-500/10 ring-1 ring-cyan-500/30"
                  : "border-slate-800 bg-slate-900/60 hover:border-slate-700"
              }`}
            >
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-cyan-500/40 bg-cyan-500/10 text-cyan-400 shadow-inner">
                <Tv className="h-7 w-7" />
              </div>
              <div>
                <div className="text-base font-extrabold uppercase tracking-wider text-white">
                  REGULAR LOBBIES
                </div>
                <div className="text-xs text-slate-300 pt-1 leading-relaxed">
                  Watch 4 live games at the same time. No creator, just pure sports.
                </div>
              </div>
            </button>

            {/* Creator Lobbies Card */}
            <button
              type="button"
              onClick={() => setSelectedType(selectedType === "creator" ? "all" : "creator")}
              className={`group relative flex items-center gap-4 rounded-2xl border p-5 text-left transition-all duration-300 ${
                selectedType === "creator" || selectedType === "all"
                  ? "border-pink-500/60 bg-gradient-to-r from-pink-950/40 via-slate-900 to-slate-900 shadow-xl shadow-pink-500/10 ring-1 ring-pink-500/30"
                  : "border-slate-800 bg-slate-900/60 hover:border-slate-700"
              }`}
            >
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-pink-500/40 bg-pink-500/10 text-pink-400 shadow-inner">
                <Users className="h-7 w-7" />
              </div>
              <div>
                <div className="text-base font-extrabold uppercase tracking-wider text-white">
                  CREATOR LOBBIES
                </div>
                <div className="text-xs text-slate-300 pt-1 leading-relaxed">
                  Watch with your favorite creators. More fun, more interaction.
                </div>
              </div>
            </button>
          </div>

          {/* Filter Categories Bar & Search */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
            {/* Category Tabs */}
            <div className="flex flex-wrap items-center gap-2">
              {[
                { id: "all", label: "All Sports", icon: Sparkles },
                { id: "football", label: "⚽ Football" },
                { id: "basketball", label: "🏀 Basketball" },
                { id: "mma", label: "🥊 MMA / Boxing" },
                { id: "hockey", label: "🏒 Hockey" },
                { id: "other", label: "💬 Other" },
              ].map((cat) => {
                const isActive = selectedCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id as any)}
                    className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-bold transition-all ${
                      isActive
                        ? "border-pink-500 bg-pink-500/10 text-white shadow-lg shadow-pink-500/20"
                        : "border-slate-800 bg-slate-900/80 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                    }`}
                  >
                    {cat.label}
                  </button>
                );
              })}
            </div>

            {/* Search Input & Sort Dropdown */}
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search lobbies..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-10 w-48 sm:w-64 rounded-xl border border-slate-800 bg-slate-900/90 pl-9 pr-4 text-xs text-white placeholder-slate-400 focus:border-pink-500 focus:outline-none"
                />
              </div>

              <div className="relative">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="h-10 rounded-xl border border-slate-800 bg-slate-900 px-3 pr-8 text-xs font-bold text-slate-300 focus:border-pink-500 focus:outline-none appearance-none cursor-pointer"
                >
                  <option value="popular">Most Popular</option>
                  <option value="viewers">Most Viewers</option>
                  <option value="new">Newly Created</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
            </div>
          </div>

          {/* SECTION 1: REGULAR LOBBIES */}
          {(selectedType === "all" || selectedType === "regular") && (
            <section className="space-y-4 pt-2">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-extrabold uppercase tracking-wider text-cyan-400 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-cyan-400" />
                  REGULAR LOBBIES
                </h2>
                <span className="text-xs font-semibold text-cyan-400 hover:underline cursor-pointer">
                  View All
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {filteredRegular.map((lobby) => (
                  <Link
                    key={lobby.id}
                    to="/arena/$matchId"
                    params={{ matchId: lobby.matchId }}
                    className="group flex flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/90 transition-all duration-300 hover:border-cyan-500/50 hover:shadow-xl hover:shadow-cyan-500/10"
                  >
                    {/* Top Badges & 4 Thumbnail Grid */}
                    <div className="relative p-2.5 pb-0">
                      <div className="absolute top-4 left-4 z-10 rounded bg-cyan-600 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-white shadow-md">
                        {lobby.gamesBadge}
                      </div>
                      <div className="absolute top-4 right-4 z-10 flex items-center gap-1 rounded bg-slate-950/80 px-2 py-0.5 text-[10px] font-bold text-slate-300 backdrop-blur-sm">
                        <Users className="h-3 w-3 text-cyan-400" />
                        {lobby.viewers}
                      </div>

                      {/* 4 Games Thumbnail Grid Collage */}
                      <div className="grid grid-cols-4 gap-1 overflow-hidden rounded-xl bg-slate-950 aspect-[16/7]">
                        {lobby.thumbnails.map((img, i) => (
                          <div key={i} className="relative h-full w-full overflow-hidden">
                            <img
                              src={img}
                              alt=""
                              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                            />
                            <div className="absolute inset-0 bg-slate-950/30" />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Card Details */}
                    <div className="p-4 flex items-center justify-between">
                      <div>
                        <h3 className="font-extrabold text-sm text-white group-hover:text-cyan-400 transition-colors">
                          {lobby.title}
                        </h3>
                        <p className="text-xs text-slate-400 pt-0.5">{lobby.subtitle}</p>
                        <div className="flex items-center gap-1 text-[11px] text-slate-400 pt-1.5 font-medium">
                          <Users className="h-3 w-3 text-slate-400" />
                          <span>{lobby.viewers} watching</span>
                        </div>
                      </div>

                      <span className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-extrabold text-cyan-300 shrink-0">
                        {lobby.fee}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* SECTION 2: CREATOR LOBBIES */}
          {(selectedType === "all" || selectedType === "creator") && (
            <section className="space-y-4 pt-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-extrabold uppercase tracking-wider text-pink-500 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-pink-500" />
                  CREATOR LOBBIES
                </h2>
                <span className="text-xs font-semibold text-pink-400 hover:underline cursor-pointer">
                  View All
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {filteredCreator.map((lobby) => (
                  <Link
                    key={lobby.id}
                    to="/arena/$matchId"
                    params={{ matchId: lobby.matchId }}
                    className="group flex flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/90 transition-all duration-300 hover:border-pink-500/50 hover:shadow-xl hover:shadow-pink-500/10"
                  >
                    {/* Top Badges & 4 Thumbnail Grid */}
                    <div className="relative p-2.5 pb-0">
                      <div className="absolute top-4 left-4 z-10 rounded bg-pink-600 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-white shadow-md">
                        CREATOR
                      </div>
                      <div className="absolute top-4 right-4 z-10 flex items-center gap-1 rounded bg-slate-950/80 px-2 py-0.5 text-[10px] font-bold text-slate-300 backdrop-blur-sm">
                        <Users className="h-3 w-3 text-pink-400" />
                        {lobby.viewers}
                      </div>

                      {/* 4 Games Thumbnail Grid Collage */}
                      <div className="grid grid-cols-4 gap-1 overflow-hidden rounded-xl bg-slate-950 aspect-[16/7]">
                        {lobby.thumbnails.map((img, i) => (
                          <div key={i} className="relative h-full w-full overflow-hidden">
                            <img
                              src={img}
                              alt=""
                              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                            />
                            <div className="absolute inset-0 bg-slate-950/30" />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Creator Avatar & Card Details */}
                    <div className="p-4 flex items-center gap-3">
                      <div className="relative h-10 w-10 shrink-0 rounded-full border-2 border-pink-500/60 overflow-hidden bg-slate-800">
                        <img
                          src={lobby.avatar}
                          alt={lobby.creatorName}
                          className="h-full w-full object-cover"
                        />
                        <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-slate-950 bg-rose-500" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1 font-bold text-xs text-white group-hover:text-pink-400 transition-colors truncate">
                          {lobby.creatorName}
                          <CheckCircle2 className="h-3.5 w-3.5 fill-cyan-400 text-slate-950 shrink-0" />
                        </div>
                        <p className="text-[11px] text-slate-400 truncate">{lobby.subtitle}</p>
                      </div>

                      <span className="rounded-xl border border-pink-500/40 bg-pink-500/10 px-3 py-2 text-xs font-extrabold text-pink-300 shrink-0">
                        {lobby.fee}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* BOTTOM FEATURES FOOTER STRIP (4 Box Features) */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 pt-4">
            <div className="flex items-center gap-3.5 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl backdrop-blur-md">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
                <Tv className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs font-extrabold text-white uppercase tracking-wider">
                  4 LIVE TVS
                </div>
                <div className="text-[10px] text-slate-400 pt-0.5">
                  Watch 4 different games at once
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3.5 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl backdrop-blur-md">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-pink-500/30 bg-pink-500/10 text-pink-400">
                <MessageCircle className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs font-extrabold text-white uppercase tracking-wider">
                  LIVE CHAT
                </div>
                <div className="text-[10px] text-slate-400 pt-0.5">
                  Chat with fans in every lobby
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3.5 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl backdrop-blur-md">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-purple-500/30 bg-purple-500/10 text-purple-400">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs font-extrabold text-white uppercase tracking-wider">
                  MULTIPLE LOBBIES
                </div>
                <div className="text-[10px] text-slate-400 pt-0.5">
                  Choose your favorite sports experience
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3.5 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl backdrop-blur-md">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400">
                <Crown className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs font-extrabold text-white uppercase tracking-wider">
                  VIP LOUENGES
                </div>
                <div className="text-[10px] text-slate-400 pt-0.5">
                  Exclusive access to private lounges
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
