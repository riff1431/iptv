import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tv, Coins, Trophy, Users, Timer, Wallet, type LucideIcon } from "lucide-react";
import { publicLoungesQuery, type PublicLounge } from "@/lib/lounges.public.functions";
import stepPick from "@/assets/how-to-play/step-pick.jpg.asset.json";
import stepPreview from "@/assets/how-to-play/step-preview.jpg.asset.json";
import stepPay from "@/assets/how-to-play/step-pay.jpg.asset.json";
import stepChat from "@/assets/how-to-play/step-chat.jpg.asset.json";
import stepTip from "@/assets/how-to-play/step-tip.jpg.asset.json";

function StepIllustration({
  src,
  alt,
  Icon,
}: {
  src: string | null;
  alt: string;
  Icon: LucideIcon;
}) {
  const [errored, setErrored] = useState(false);
  const showImage = !!src && !errored;
  return (
    <div
      aria-hidden="true"
      className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-arena-violet/15 text-arena-violet ring-1 ring-arena-violet/30"
    >
      {showImage ? (
        <img
          src={src}
          alt={alt}
          width={48}
          height={48}
          loading="lazy"
          decoding="async"
          onError={() => setErrored(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <Icon className="h-5 w-5" />
      )}
    </div>
  );
}



export type HowToPlayDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
};

type DerivedContent = {
  previewLabel: string;
  entryFeeLabel: string;
  liveGames: string[];
  totalLounges: number;
};

function formatSeconds(seconds: number): string {
  if (seconds <= 0) return "a short";
  if (seconds % 60 === 0) {
    const m = seconds / 60;
    return `${m}-minute`;
  }
  if (seconds < 60) return `${seconds}-second`;
  const m = Math.round(seconds / 60);
  return `~${m}-minute`;
}

function formatCents(cents: number): string {
  if (cents % 100 === 0) return `$${cents / 100}`;
  return `$${(cents / 100).toFixed(2)}`;
}

/** Pick up to 4 short "game name" strings from lounges + their TVs. */
function pickLiveGames(lounges: PublicLounge[]): string[] {
  const seen = new Set<string>();
  const games: string[] = [];
  for (const l of lounges) {
    for (const tv of l.tvs) {
      const label = (tv.matchup || "").trim();
      if (label && !seen.has(label.toLowerCase())) {
        seen.add(label.toLowerCase());
        games.push(label);
        if (games.length >= 4) return games;
      }
    }
  }
  // Fallback: use lounge names.
  for (const l of lounges) {
    if (!seen.has(l.name.toLowerCase())) {
      seen.add(l.name.toLowerCase());
      games.push(l.name);
      if (games.length >= 4) return games;
    }
  }
  return games;
}

function deriveContent(lounges: PublicLounge[] | undefined): DerivedContent {
  const active = (lounges ?? []).filter((l) => l.isActive);
  const featured = active.find((l) => l.isFeatured) ?? active[0];

  const previewSeconds = featured?.freePreviewSeconds ?? 120;
  const entryFeeCents = featured?.entryFeeCents ?? 500;

  return {
    previewLabel: formatSeconds(previewSeconds),
    entryFeeLabel: formatCents(entryFeeCents),
    liveGames: pickLiveGames(active),
    totalLounges: active.length,
  };
}

export function HowToPlayDialog({ open, onOpenChange }: HowToPlayDialogProps) {
  const { data: lounges } = useQuery({ ...publicLoungesQuery(), enabled: open });
  const content = useMemo(() => deriveContent(lounges), [lounges]);

  const gamesSentence =
    content.liveGames.length > 0
      ? `Live right now: ${content.liveGames.join(", ")}.`
      : `Browse the Sports Arena grid across ${content.totalLounges || "our"} lounges and tap any tile to jump in.`;

  const steps = [
    {
      icon: Tv,
      image: stepPick.url,
      title: "Pick a live game",
      body: gamesSentence,
    },
    {
      icon: Timer,
      image: stepPreview.url,
      title: `Enjoy a free ${content.previewLabel} preview`,
      body: `Every session starts with a free ${content.previewLabel} preview. No card, no commitment — just watch.`,
    },
    {
      icon: Coins,
      image: stepPay.url,
      title: `Pay-per-view for ${content.entryFeeLabel}`,
      body: `When your preview ends, pay ${content.entryFeeLabel} from your wallet to keep watching for the rest of the event.`,
    },
    {
      icon: Users,
      image: stepChat.url,
      title: "Chat with the lounge",
      body: "Trash-talk in real time, react with emojis, and follow friends into the same lounge.",
    },
    {
      icon: Trophy,
      image: stepTip.url,
      title: "Tip creators & hosts",
      body: "Loved a call? Tap the menu on any chat message to send a tip straight to the user.",
    },
  ] as const;


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-arena-border bg-arena-panel text-white">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-extrabold uppercase tracking-wide text-arena-gradient">
            How to Play the Arena
          </DialogTitle>
          <DialogDescription className="text-white/70">
            Watch live sports, chat with the lounge, and tip creators — here&apos;s the 60-second tour.
          </DialogDescription>
        </DialogHeader>

        <ol
          aria-label="How to play, step by step"
          className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          {steps.map((step, i) => {
            const stepNumber = i + 1;
            return (
              <li
                key={step.title}
                className="relative flex gap-3 rounded-xl border border-arena-border bg-arena-panel-2/60 p-3.5"
                aria-label={`Step ${stepNumber} of ${steps.length}: ${step.title}`}
              >
                <StepIllustration src={step.image} alt="" Icon={step.icon} />

                <div className="min-w-0">
                  <div className="flex items-center gap-2" aria-hidden="true">
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">
                      Step {stepNumber}
                    </span>
                  </div>
                  <h4 className="mt-0.5 text-sm font-bold text-white">{step.title}</h4>
                  <p className="mt-1 text-[12px] leading-relaxed text-white/70">{step.body}</p>
                </div>
              </li>
            );
          })}
        </ol>

        <aside
          aria-label="Pro tip"
          className="mt-2 flex flex-col gap-3 rounded-xl border border-arena-violet/30 bg-arena-violet/10 p-3 text-[12px] text-white/85 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="min-w-0">
            <span className="font-bold text-arena-violet">Pro tip:</span>{" "}
            Top up your wallet so pay-per-view is one tap away when the preview timer runs out.
          </p>
          <Link
            to="/wallet"
            hash="topup"
            onClick={() => onOpenChange(false)}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-arena-violet px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-white transition hover:bg-arena-violet/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-arena-violet focus-visible:ring-offset-2 focus-visible:ring-offset-arena-panel"
          >

            <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
            Top up wallet
          </Link>
        </aside>

      </DialogContent>
    </Dialog>
  );
}
