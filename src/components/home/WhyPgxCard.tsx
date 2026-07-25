import { ShieldCheck, Star, Heart, Flame } from "lucide-react";

const WHY_ITEMS = [
  { icon: ShieldCheck, title: "Safe & Secure", sub: "18+ Verified" },
  { icon: Star, title: "Top Creators", sub: "Verified & Active" },
  { icon: Heart, title: "Private & Fun", sub: "Your Experience" },
  { icon: Flame, title: "Always Live", sub: "24/7 Entertainment" },
];

export default function WhyPgxCard() {
  return (
    <div className="rounded-2xl border border-arena-border bg-arena-panel/50 p-4 backdrop-blur sm:p-5">
      <h3 className="t-h2 mb-5 text-white">
        Why <span className="bg-gradient-to-r from-arena-pink to-arena-cyan bg-clip-text text-transparent">PGX?</span>
      </h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4 sm:gap-x-5 sm:gap-y-6">
        {WHY_ITEMS.map(({ icon: Icon, title, sub }) => (
          <div key={title} className="group flex cursor-default items-center gap-3">
            <span className="fx-icon-tile grid h-10 w-10 shrink-0 place-items-center rounded-full border border-arena-pink/40 bg-arena-bg/60 text-arena-pink shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]">
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 leading-tight">
              <p className="t-label fx-label text-white">{title}</p>
              <p className="t-micro mt-1 text-white/70">{sub}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
