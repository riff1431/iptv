import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { ArrowRight } from "lucide-react";
import creator1 from "@/assets/pgx/creator-1.jpg";
import creator2 from "@/assets/pgx/creator-2.jpg";
import creator3 from "@/assets/pgx/creator-3.jpg";
import creator4 from "@/assets/pgx/creator-4.jpg";
import { trackEvent } from "@/lib/analytics";

export default function OneOnOneCard() {
  const ref = useRef<HTMLAnchorElement | null>(null);
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      fired.current = true;
      trackEvent("cta_one_on_one_impression", { location: "home_one_on_one" });
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !fired.current) {
            fired.current = true;
            trackEvent("cta_one_on_one_impression", { location: "home_one_on_one" });
            io.disconnect();
            break;
          }
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className="rounded-2xl border border-arena-border bg-arena-panel/50 p-4 backdrop-blur sm:p-5">
      <div className="grid grid-cols-1 items-center gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6">
        <div className="min-w-0">
          <h3 className="t-h2 text-white">
            Live <span className="bg-gradient-to-r from-arena-pink to-arena-cyan bg-clip-text text-transparent">1&nbsp;on&nbsp;1</span> Video Calls
          </h3>
          <p className="t-body mt-2 text-white/75">
            Private. Personal. <span className="text-white/90">Unforgettable.</span>
          </p>
          <Link
            ref={ref}
            to="/auth"
            search={{ mode: "signup" }}
            onClick={() =>
              trackEvent("cta_one_on_one_click", { location: "home_one_on_one" })
            }
            className="t-eyebrow group mt-5 inline-flex w-fit items-center gap-2 rounded-full border border-arena-border bg-arena-bg/60 px-5 py-2.5 text-white transition-colors hover:border-arena-pink/60 hover:bg-arena-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-arena-pink/70 focus-visible:ring-offset-2 focus-visible:ring-offset-arena-bg"
          >
            <span>Browse Creators</span>
            <ArrowRight className="fx-arrow h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="fx-avatar-cluster flex -space-x-3 justify-start sm:justify-end">
          {[creator1, creator2, creator3, creator4].map((src, i) => (
            <div key={i} className="relative">
              <img
                src={src}
                alt=""
                className="h-14 w-14 rounded-full border-2 border-arena-panel object-cover ring-1 ring-arena-pink/40 transition hover:ring-2 hover:ring-arena-pink"
                loading="lazy"
                decoding="async"
              />
              <span className="absolute bottom-0.5 right-0.5 h-3 w-3 rounded-full border-2 border-arena-panel bg-green-400 shadow-[0_0_0_2px_rgba(74,222,128,0.35)]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
