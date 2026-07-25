import { ShieldCheck, Zap, HeartCrack, Lock, Star } from "lucide-react";

const TRUST_ITEMS = [
  { icon: ShieldCheck, title: "18+ Only", sub: "Safe & Verified" },
  { icon: Zap, title: "Instant Access", sub: "Join in Seconds" },
  { icon: HeartCrack, title: "Real People", sub: "Real Connections", red: true },
  { icon: Lock, title: "Secure Payments", sub: "Encrypted & Safe" },
  { icon: Star, title: "VIP Benefits", sub: "Exclusive Perks" },
];

export default function TrustStrip() {
  return (
    <div className="mt-4 rounded-2xl border border-arena-border bg-arena-panel/40 p-5 backdrop-blur sm:mt-6 sm:p-6">
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 sm:gap-x-5 sm:gap-y-6 lg:grid-cols-5">
        {TRUST_ITEMS.map(({ icon: Icon, title, sub, red }) => (
          <div key={title} className="group flex cursor-default items-center gap-3">
            <span
              className={
                red
                  ? "fx-icon-tile grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-live/40 bg-live/10 text-live shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]"
                  : "fx-icon-tile grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-arena-pink/30 bg-arena-bg/50 text-arena-pink shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]"
              }
            >
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
