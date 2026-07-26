import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Tv, MessageCircle, Flame, Video, ArrowRight, Play, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import heroImg from "@/assets/pgx/hero.jpg";
import creatorLive from "@/assets/pgx/creator-live.jpg";

export default function HeroSection() {
  const [showTrailer, setShowTrailer] = useState(false);

  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-6 md:p-10 border border-slate-800/80 shadow-2xl">
      {/* Background Glow Effects */}
      <div className="pointer-events-none absolute -left-20 -top-20 h-72 w-72 rounded-full bg-pink-600/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 top-1/2 h-80 w-80 rounded-full bg-cyan-600/20 blur-3xl" />

      <div className="relative z-10 grid gap-8 lg:grid-cols-12 lg:items-center">
        {/* Left Column — Copy & Typography */}
        <div className="lg:col-span-7 flex flex-col items-start gap-5">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 rounded-full border border-pink-500/30 bg-pink-500/10 px-3.5 py-1 text-xs font-semibold tracking-wider text-pink-400 uppercase">
            <span className="h-2 w-2 rounded-full bg-pink-500 animate-pulse" />
            The Ultimate Sports & Creator Lounge
          </div>

          {/* Main Headline */}
          <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl md:text-6xl leading-[1.08]">
            WATCH.
            <br />
            INTERACT.
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-500 via-rose-400 to-pink-400">
              DARE.
            </span>
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-400">
              CONNECT.
            </span>
          </h1>

          {/* Subtitle */}
          <p className="text-base text-slate-300 md:text-lg max-w-xl">
            Live Sports. Beautiful Creators. Real Connections. Endless Entertainment.
          </p>

          {/* 4 Feature Highlights */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full py-2">
            <div className="flex items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-900/80 p-2.5 text-slate-200">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-pink-500/10 text-pink-400 shrink-0">
                <Tv className="h-5 w-5" />
              </div>
              <div className="text-left">
                <div className="text-xs font-bold text-white">Live Sports</div>
                <div className="text-[10px] text-slate-400">Big Screens</div>
              </div>
            </div>

            <div className="flex items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-900/80 p-2.5 text-slate-200">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400 shrink-0">
                <MessageCircle className="h-5 w-5" />
              </div>
              <div className="text-left">
                <div className="text-xs font-bold text-white">Live Chat</div>
                <div className="text-[10px] text-slate-400">Real Time</div>
              </div>
            </div>

            <div className="flex items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-900/80 p-2.5 text-slate-200">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-500/10 text-rose-400 shrink-0">
                <Flame className="h-5 w-5" />
              </div>
              <div className="text-left">
                <div className="text-xs font-bold text-white">Quick Dares</div>
                <div className="text-[10px] text-slate-400">Fun & Spicy</div>
              </div>
            </div>

            <div className="flex items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-900/80 p-2.5 text-slate-200">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400 shrink-0">
                <Video className="h-5 w-5" />
              </div>
              <div className="text-left">
                <div className="text-xs font-bold text-white">1 on 1 Calls</div>
                <div className="text-[10px] text-slate-400">Private & Personal</div>
              </div>
            </div>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link to="/auth" search={{ mode: "signup" }}>
              <Button
                size="lg"
                className="h-12 px-6 rounded-xl font-bold bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 hover:from-pink-500 hover:to-indigo-500 text-white shadow-lg shadow-pink-500/25 transition-all duration-200"
              >
                JOIN FREE NOW
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>

            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => setShowTrailer(true)}
              className="h-12 px-6 rounded-xl font-bold border-slate-700 bg-slate-900/80 hover:bg-slate-800 text-white hover:text-white transition-all"
            >
              WATCH TRAILER
              <Play className="ml-2 h-4 w-4 fill-pink-500 text-pink-500" />
            </Button>
          </div>
        </div>

        {/* Right Column — Model Artwork & Floating Badge */}
        <div className="lg:col-span-5 relative flex justify-center">
          <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-800 shadow-2xl bg-slate-950 group">
            <img
              src={heroImg}
              alt="PGX Sports Lounge Hero"
              className="h-[440px] w-full object-cover object-top transition-transform duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent opacity-80" />

            {/* Cursive Overlay */}
            <div className="absolute top-4 right-4 text-pink-400 font-serif italic text-xl drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] font-semibold select-none">
              Watch with me ♡
            </div>

            {/* Floating Creator Badge */}
            <div className="absolute bottom-4 right-4 left-4 sm:left-auto sm:w-72 rounded-xl border border-slate-700/80 bg-slate-900/90 p-3 shadow-2xl backdrop-blur-md">
              <div className="flex items-center gap-3">
                <div className="relative h-12 w-12 shrink-0 rounded-lg overflow-hidden border border-pink-500/50">
                  <img src={creatorLive} alt="SophieL_Xo" className="h-full w-full object-cover" />
                  <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-slate-900 bg-emerald-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[9px] font-bold text-white uppercase tracking-wider">
                      LIVE NOW
                    </span>
                  </div>
                  <div className="flex items-center gap-1 font-bold text-sm text-white truncate">
                    SophieL_Xo
                    <CheckCircle2 className="h-3.5 w-3.5 fill-cyan-400 text-slate-900 shrink-0" />
                  </div>
                  <div className="text-xs text-slate-300 truncate">Watching NBA Playoffs</div>
                  <div className="text-[10px] text-pink-400 font-medium">1,248 watching</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Video Trailer Modal */}
      {showTrailer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 p-2 shadow-2xl">
            <button
              onClick={() => setShowTrailer(false)}
              className="absolute top-4 right-4 z-10 rounded-full bg-slate-900/80 p-2 text-slate-300 hover:text-white hover:bg-slate-800"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="aspect-video w-full">
              <iframe
                className="h-full w-full rounded-xl"
                src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1"
                title="PGX Sports Lounge Trailer"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
