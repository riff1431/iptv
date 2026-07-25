import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Flame, Zap } from "lucide-react";
import { publicQuickDaresQuery } from "@/lib/quick-dares.public.functions";
import { quickDareIcon, formatDarePrice } from "@/lib/quick-dares-icons";
import { trackEvent } from "@/lib/analytics";

function useImpression<T extends Element>(
  eventName: string,
  props: Record<string, string | number | boolean | null | undefined>,
  key: string | null,
) {
  const ref = useRef<T | null>(null);
  const firedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!key || firedRef.current === key) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      if (key) {
        firedRef.current = key;
        trackEvent(eventName, props);
      }
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && firedRef.current !== key) {
            firedRef.current = key;
            trackEvent(eventName, props);
            io.disconnect();
            break;
          }
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, eventName]);
  return ref;
}

function SectionHeader({ title, href = "/arena" }: { title: string; href?: string }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3">
      <h2 className="t-h2 truncate text-white">{title}</h2>
      <Link
        to={href}
        className="group inline-flex shrink-0 items-center gap-1.5 rounded-full border border-arena-border bg-arena-panel/60 px-3.5 py-1.5 text-[11px] font-medium text-white/85 transition-colors hover:border-arena-pink/60 hover:bg-arena-panel hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-arena-pink/70 focus-visible:ring-offset-2 focus-visible:ring-offset-arena-bg"
      >
        <span>View all</span>
      </Link>
    </div>
  );
}

export default function QuickDaresCard() {
  const sendDareRef = useImpression<HTMLButtonElement>(
    "cta_send_a_dare_impression",
    { location: "home_quick_dares" },
    "send_a_dare",
  );
  const { data: dares } = useSuspenseQuery(publicQuickDaresQuery());

  return (
    <div className="flex flex-col rounded-2xl border border-arena-border bg-arena-panel/50 p-4 backdrop-blur sm:p-5">
      <SectionHeader title="Quick Dares" />
      {dares.length === 0 ? (
        <div className="t-eyebrow rounded-lg border border-dashed border-arena-border/60 bg-arena-bg/40 px-3 py-6 text-center text-muted-foreground">
          No dares available right now.
        </div>
      ) : (
        <ul className="space-y-2">
          {dares.map((d) => {
            const Icon = quickDareIcon(d.icon);
            return (
              <li
                key={d.id}
                className="fx-row group flex cursor-pointer items-center justify-between rounded-lg border border-arena-border/60 bg-arena-bg/50 px-3 py-2.5"
              >
                <div className="flex items-center gap-3">
                  <span className="fx-icon-tile grid h-8 w-8 place-items-center rounded-full border border-arena-pink/40 bg-arena-panel/80 text-arena-pink">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="t-label fx-label text-white/90">{d.label}</span>
                </div>
                <span className="t-label text-white transition-transform duration-300 group-hover:scale-110">
                  {formatDarePrice(d.price_cents)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <button
        ref={sendDareRef}
        type="button"
        onClick={() =>
          trackEvent("cta_send_a_dare_click", { location: "home_quick_dares" })
        }
        className="t-eyebrow hover-shine group relative mt-4 inline-flex items-center justify-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-arena-pink via-arena-violet to-arena-cyan px-6 py-3 text-white shadow-[0_10px_30px_-10px_var(--arena-pink)] transition-transform duration-300 hover:scale-[1.02] hover:shadow-[0_18px_45px_-12px_var(--arena-pink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-arena-bg"
      >
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent opacity-0 [transform:translateX(-100%)] transition-all duration-700 group-hover:opacity-100 group-hover:[transform:translateX(100%)]" />
        <span>Send a Dare</span>
        <Flame className="h-4 w-4 transition-transform duration-300 group-hover:-rotate-12" />
        <Zap className="h-4 w-4 transition-transform duration-300 group-hover:rotate-12 group-hover:scale-110" />
      </button>
    </div>
  );
}
