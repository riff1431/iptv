import { Link } from "@tanstack/react-router";
import { Radio, Users, ChevronRight, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import creator1 from "@/assets/pgx/creator-1.jpg";
import creator2 from "@/assets/pgx/creator-2.jpg";
import creator3 from "@/assets/pgx/creator-3.jpg";
import creator4 from "@/assets/pgx/creator-4.jpg";

export type LiveCardItem = {
  id: string;
  title: string;
  creatorName: string;
  viewers: number;
  sportImg: string;
  creatorImg: string;
};

/**
 * Fixed marketing mock-ups for the home "LIVE IN SPORTS LOUNGE" grid.
 * Intentionally hardcoded (NBA, NHL, FIFA, Cricket) with realistic matchup
 * titles, female demo creators, and large viewer counts. These do NOT reflect
 * live database state. Sport backgrounds are served from /public/images.
 */
const DEFAULT_ITEMS: LiveCardItem[] = [
  {
    id: "demo-nba",
    title: "Lakers vs Celtics",
    creatorName: "LunaLove",
    viewers: 12480,
    sportImg: "/images/sport-nba.jpg",
    creatorImg: creator1,
  },
  {
    id: "demo-nhl",
    title: "Rangers vs Bruins",
    creatorName: "BellaBanks",
    viewers: 9820,
    sportImg: "/images/sport-nhl.jpg",
    creatorImg: creator2,
  },
  {
    id: "demo-fifa",
    title: "Real Madrid vs Barcelona",
    creatorName: "VickyVibes",
    viewers: 18540,
    sportImg: "/images/sport-soccer.jpg",
    creatorImg: creator3,
  },
  {
    id: "demo-cricket",
    title: "India vs Pakistan",
    creatorName: "AaliyahXO",
    viewers: 24180,
    sportImg: "/images/sport-cricket.jpg",
    creatorImg: creator4,
  },
];

type Props = {
  items?: LiveCardItem[];
};

export default function LiveSportsGrid({ items }: Props) {
  // Always the 4 fixed demo mock-ups, unless a caller overrides via `items`.
  const displayCards: LiveCardItem[] =
    items && items.length > 0 ? items : DEFAULT_ITEMS;

  return (
    <section className="rounded-2xl border border-slate-800/90 bg-slate-950/80 p-5 md:p-6 shadow-2xl backdrop-blur-md">
      {/* Section Header */}
      <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-rose-500 animate-ping" />
          <h2 className="text-lg md:text-xl font-black uppercase tracking-wider text-white">
            LIVE IN SPORTS LOUNGE
          </h2>
        </div>

        <Link to="/arena">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs font-bold text-slate-300 hover:text-white hover:bg-slate-800/80 rounded-lg"
          >
            View All
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </Link>
      </div>

      {/* 4 Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4">
        {displayCards.map((card) => (
          <Link
            key={card.id}
            to="/arena/$matchId"
            params={{ matchId: card.id }}
            className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/90 transition-all duration-300 hover:border-pink-500/70 hover:shadow-xl hover:shadow-pink-500/15"
          >
            {/* Thumbnail Image Container */}
            <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-950">
              <img
                src={card.sportImg}
                alt={card.title}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent opacity-90" />

              {/* LIVE Badge */}
              <div className="absolute top-2.5 left-2.5 inline-flex items-center gap-1.5 rounded-md bg-rose-600/90 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white backdrop-blur-sm shadow-md">
                <Radio className="h-3 w-3 animate-pulse" />
                LIVE
              </div>

              {/* Play Icon Hover Overlay */}
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-black/40 backdrop-blur-[2px]">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-pink-600 text-white shadow-lg shadow-pink-600/50 transform group-hover:scale-110 transition-transform">
                  <Play className="h-5 w-5 fill-white ml-0.5" />
                </div>
              </div>
            </div>

            {/* Overlapping Creator Profile Avatar */}
            <div className="relative px-3.5 pt-0 pb-3 flex flex-col items-start">
              <div className="relative -mt-6 mb-2 h-12 w-12 shrink-0 rounded-full border-2 border-slate-950 ring-2 ring-pink-500 overflow-hidden bg-slate-800 shadow-xl group-hover:ring-pink-400 transition-all">
                <img
                  src={card.creatorImg}
                  alt={card.creatorName}
                  className="h-full w-full object-cover"
                />
              </div>

              <div className="min-w-0 w-full">
                <h3 className="font-extrabold text-sm text-white group-hover:text-pink-400 transition-colors truncate">
                  {card.title}
                </h3>
                <div className="text-xs text-slate-400 truncate pt-0.5">
                  with <span className="text-slate-200 font-semibold">{card.creatorName}</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-300 font-medium pt-1">
                  <Users className="h-3.5 w-3.5 text-pink-400" />
                  <span>{card.viewers.toLocaleString()} watching</span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
