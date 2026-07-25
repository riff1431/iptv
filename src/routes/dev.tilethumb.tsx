import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  Banknote,
  Bell,
  CreditCard,
  ImageIcon,
  Plus,
  Settings,
  Shield,
  Sparkles,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { ThumbFallback, ThumbHeader } from "@/components/ThumbFallback";

/**
 * Dev-only permutation matrix for ThumbHeader / ThumbFallback. Not linked
 * from any nav — exists so the pixel-diff regression can snapshot every
 * variant (icon presets, corner-icon on/off, corner accent themes, and
 * ThumbFallback size presets) across every breakpoint.
 *
 * Keep the layout deterministic: fixed order, one tile per row, aspect-3/2
 * boxes for the raw ThumbFallback previews so their absolute-inset children
 * have a positioned parent.
 */
export const Route = createFileRoute("/dev/tilethumb")({
  head: () => ({
    meta: [
      { title: "TileThumb permutations (dev)" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TileThumbPermutations,
});

function Tile({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      data-permutation={id}
      className="rounded-2xl border border-arena-border bg-arena-card p-4 sm:p-5"
    >
      {children}
      <h2 className="text-sm font-semibold text-arena-text">{title}</h2>
      <p className="text-xs text-arena-text-muted">Variant: {id}</p>
    </section>
  );
}

function FallbackBox({
  id,
  size,
  icon,
}: {
  id: string;
  size: "sm" | "md" | "lg";
  icon: React.ComponentProps<typeof ThumbFallback>["icon"];
}) {
  return (
    <div
      data-permutation={id}
      className="relative aspect-[3/2] overflow-hidden rounded-2xl border border-arena-border bg-arena-card"
    >
      <ThumbFallback icon={icon} label={`Fallback ${size}`} size={size} />
    </div>
  );
}

function TileThumbPermutations() {
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold text-arena-text">
          TileThumb permutations
        </h1>
        <p className="text-xs text-arena-text-muted">
          Deterministic reference surface for pixel-diff regression.
        </p>
      </header>

      {/* Baseline banner: no corner icon */}
      <Tile id="banner-default" title="Banner · default icon">
        <ThumbHeader icon={ImageIcon} label="Default banner" />
      </Tile>

      {/* Common production icons */}
      <Tile id="banner-plus" title="Banner · Plus">
        <ThumbHeader icon={Plus} label="Quick actions" />
      </Tile>
      <Tile id="banner-users" title="Banner · Users">
        <ThumbHeader icon={Users} label="Users" />
      </Tile>
      <Tile id="banner-shield" title="Banner · Shield">
        <ThumbHeader icon={Shield} label="Roles" />
      </Tile>
      <Tile id="banner-settings" title="Banner · Settings">
        <ThumbHeader icon={Settings} label="Settings" />
      </Tile>
      <Tile id="banner-activity" title="Banner · Activity">
        <ThumbHeader icon={Activity} label="Sessions" />
      </Tile>
      <Tile id="banner-creditcard" title="Banner · CreditCard">
        <ThumbHeader icon={CreditCard} label="Top up wallet" />
      </Tile>
      <Tile id="banner-banknote" title="Banner · Banknote">
        <ThumbHeader icon={Banknote} label="Withdraw" />
      </Tile>
      <Tile id="banner-trending" title="Banner · TrendingUp">
        <ThumbHeader icon={TrendingUp} label="Balance chart" />
      </Tile>
      <Tile id="banner-bar" title="Banner · BarChart3">
        <ThumbHeader icon={BarChart3} label="Spending chart" />
      </Tile>

      {/* Corner-icon permutations */}
      <Tile id="corner-default-theme" title="Banner + corner · default theme">
        <ThumbHeader
          icon={Activity}
          label="Sessions"
          cornerIcon={TrendingUp}
          cornerLabel="Trending"
        />
      </Tile>
      <Tile id="corner-emerald" title="Banner + corner · emerald">
        <ThumbHeader
          icon={Activity}
          label="Sessions"
          cornerIcon={TrendingUp}
          cornerClassName="bg-emerald-500/15 text-emerald-500"
          cornerLabel="Up"
        />
      </Tile>
      <Tile id="corner-rose" title="Banner + corner · rose">
        <ThumbHeader
          icon={Bell}
          label="Notifications"
          cornerIcon={Sparkles}
          cornerClassName="bg-rose-500/15 text-rose-500"
          cornerLabel="Alert"
        />
      </Tile>
      <Tile id="corner-amber" title="Banner + corner · amber">
        <ThumbHeader
          icon={Zap}
          label="Live"
          cornerIcon={Sparkles}
          cornerClassName="bg-amber-500/15 text-amber-500"
          cornerLabel="Boost"
        />
      </Tile>

      {/* ThumbFallback size presets */}
      <FallbackBox id="fallback-sm" size="sm" icon={ImageIcon} />
      <FallbackBox id="fallback-md" size="md" icon={ImageIcon} />
      <FallbackBox id="fallback-lg" size="lg" icon={ImageIcon} />
    </main>
  );
}
