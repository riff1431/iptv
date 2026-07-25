import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from "react";
import { AppShell } from "@/components/AppShell";
import { publicLoungesQuery } from "@/lib/lounges.public.functions";
import { publicMatchesQuery, type PublicMatch } from "@/lib/matches.public.functions";
import { publicQuickDaresQuery } from "@/lib/quick-dares.public.functions";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getRequestOrigin } from "@/lib/origin.functions";



import {
  ArrowRight,
  Flame,
  Video,
  MessageCircle,
  AlertTriangle,
  Loader2,
} from "lucide-react";

import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import heroImg from "@/assets/pgx/hero.jpg";
import creator1 from "@/assets/pgx/creator-1.jpg";
import creator2 from "@/assets/pgx/creator-2.jpg";
import creator3 from "@/assets/pgx/creator-3.jpg";
import creator4 from "@/assets/pgx/creator-4.jpg";
import creatorLive from "@/assets/pgx/creator-live.jpg";
import { sportImage } from "@/lib/sport-image";
import { trackEvent } from "@/lib/analytics";

// Below-the-fold sections — each becomes its own chunk on the client. We
// gate them behind a hydration flag so React.lazy never suspends during SSR
// streaming (that path throws "Cannot read properties of undefined (reading
// 'matchCache')" inside TanStack Router). The route loader still prewarms
// Quick Dares data so the lazy chunk's useSuspenseQuery resolves from cache.
const QuickDaresCard = lazy(() => import("@/components/home/QuickDaresCard"));
const OneOnOneCard = lazy(() => import("@/components/home/OneOnOneCard"));
const WhyPgxCard = lazy(() => import("@/components/home/WhyPgxCard"));
const TrustStrip = lazy(() => import("@/components/home/TrustStrip"));

function ClientOnly({
  component: Component,
  fallback,
}: {
  component: ComponentType;
  fallback: React.ReactNode;
}) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  if (!hydrated) return <>{fallback}</>;
  return (
    <Suspense fallback={fallback}>
      <Component />
    </Suspense>
  );
}

const VIBES = ["all", "flagship", "themed", "free"] as const;
const lobbySearchSchema = z.object({
  q: z.string().optional(),
  vibe: z.enum(VIBES).optional(),
});

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


export const Route = createFileRoute("/")({
  validateSearch: zodValidator(lobbySearchSchema),
  loader: async ({ context }) => {
    const [, , , origin] = await Promise.all([
      context.queryClient.ensureQueryData(publicLoungesQuery()),
      context.queryClient.ensureQueryData(publicMatchesQuery()),
      context.queryClient.ensureQueryData(publicQuickDaresQuery()),
      getRequestOrigin(),
    ]);
    return { origin };
  },

  head: ({ loaderData }) => {
    const origin = loaderData?.origin ?? "";
    const url = origin ? `${origin}/` : "/";
    const title = "PGX Sports Lounge — Watch. Interact. Connect.";
    const description =
      "Live sports, beautiful creators, real connections. Watch every major event alongside your favorite creator in the ultimate sports lounge.";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
        { property: "og:site_name", content: "PGX Sports Lounge" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ],
      links: [
        { rel: "canonical", href: url },
        { rel: "preload", as: "image", href: heroImg, fetchPriority: "high" } as unknown as { rel: string; href: string },
      ],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: "PGX Sports Lounge",
            url: url,
            description,
          }),
        },
      ],
    };
  },
  pendingMs: 200,
  pendingComponent: LobbyPending,
  errorComponent: LobbyError,
  component: LobbyPage,
});


const CREATOR_AVATARS = [creator1, creator2, creator3, creator4] as const;

function pickAvatar(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return CREATOR_AVATARS[Math.abs(h) % CREATOR_AVATARS.length];
}

function formatViewers(n: number): string {
  return n.toLocaleString();
}

type LiveCard = {
  id: string;
  title: string;
  sport: string;
  creator: string;
  avatar: string;
  img: string;
  viewers: number;
  isLive: boolean;
};

function toLiveCard(m: PublicMatch): LiveCard {
  return {
    id: m.id,
    title: m.title || "Live Match",
    sport: m.sport ?? "",
    creator: m.hostDisplayName ?? "PGX Host",
    avatar: pickAvatar(m.ownerUserId ?? m.id),
    img: m.thumbnailUrl || sportImage(m.sport ?? m.title ?? ""),
    viewers: m.viewerCount,
    isLive: m.status === "live" || m.status === "halftime",
  };
}

// Quick Dares are managed by admins from /admin/quick-dares and fetched
// via publicQuickDaresQuery(). See QuickDaresCard below.




function LiveCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none overflow-hidden rounded-xl border border-arena-border bg-arena-panel/60 opacity-70"
    >
      <div className="relative aspect-[4/3] shimmer bg-gradient-to-br from-white/10 via-white/5 to-white/10">
        <span className="absolute left-2 top-2 h-4 w-10 rounded-md bg-live/50" />
        <span className="absolute -bottom-4 left-2 h-10 w-10 rounded-full bg-white/20 ring-2 ring-arena-panel" />
      </div>
      <div className="space-y-2 px-3 pt-5 pb-3">
        <div className="h-3 w-3/4 shimmer rounded bg-white/15" />
        <div className="h-2.5 w-1/2 shimmer rounded bg-white/10" />
        <div className="h-2 w-1/3 shimmer rounded bg-white/10" />
      </div>
    </div>
  );
}

function LiveLoungeSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="rounded-2xl border border-arena-border bg-arena-panel/50 p-5 backdrop-blur"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="h-4 w-40 shimmer rounded bg-white/15" />
        <div className="h-6 w-16 shimmer rounded-full bg-white/10" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">

        {Array.from({ length: 5 }).map((_, i) => (
          <LiveCardSkeleton key={i} />
        ))}
      </div>
      <span className="sr-only">Loading live matches…</span>
    </div>
  );
}

function FeaturedWatcherSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="w-full min-w-0 rounded-2xl border border-arena-border bg-arena-panel/80 p-4 backdrop-blur-md sm:w-auto sm:min-w-[20rem] sm:max-w-md lg:max-w-sm"
    >
      <div className="flex items-center gap-3">
        <div className="h-14 w-14 shrink-0 shimmer rounded-xl bg-white/15 ring-2 ring-arena-pink/40" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-3 w-16 shimmer rounded bg-live/40" />
          <div className="h-3 w-2/3 shimmer rounded bg-white/20" />
          <div className="h-2.5 w-3/4 shimmer rounded bg-white/10" />
          <div className="h-2 w-1/3 shimmer rounded bg-white/10" />
        </div>
      </div>
    </div>
  );
}

function HeroSkeleton() {
  return (
    <section
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="relative overflow-hidden rounded-3xl border border-arena-border bg-arena-panel/40"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-arena-panel/60 via-arena-bg/80 to-arena-panel/40" />
      <div className="relative grid gap-8 p-5 sm:p-8 lg:min-h-[560px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:p-10">
        <div className="flex min-w-0 flex-col justify-center gap-6">
          <div className="h-7 w-64 max-w-full shimmer rounded-full bg-white/10" />
          <div className="space-y-3">
            <div className="h-10 w-40 shimmer rounded bg-white/15 sm:h-14 sm:w-56" />
            <div className="h-10 w-48 shimmer rounded bg-white/15 sm:h-14 sm:w-64" />
            <div className="h-10 w-36 shimmer rounded bg-arena-pink/30 sm:h-14 sm:w-52" />
            <div className="h-10 w-52 shimmer rounded bg-arena-violet/30 sm:h-14 sm:w-72" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-56 shimmer rounded bg-white/10" />
            <div className="h-3 w-64 shimmer rounded bg-white/10" />
          </div>
          <div className="grid max-w-lg grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <div className="h-10 w-10 shrink-0 shimmer rounded-xl bg-white/10" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="h-2.5 w-16 shimmer rounded bg-white/15" />
                  <div className="h-2 w-12 shimmer rounded bg-white/10" />
                </div>
              </div>
            ))}
          </div>
          <div className="h-14 w-full max-w-md shimmer rounded-full bg-gradient-to-r from-arena-pink/40 to-arena-violet/40" />
        </div>
        <div className="relative flex min-w-0 flex-col items-stretch justify-end gap-4 sm:items-end">
          <FeaturedWatcherSkeleton />
        </div>
      </div>
      <span className="sr-only">Loading featured lounge…</span>
    </section>
  );
}

function LobbyPending() {
  return (
    <AppShell>
      <div className="bg-arena min-h-screen">
        <div className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 py-4 text-sm text-white/60">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span>Loading the lounge…</span>
          </div>
          <HeroSkeleton />
          <div className="mt-8">
            <LiveLoungeSkeleton />
          </div>
        </div>
      </div>
    </AppShell>
  );
}


function LobbyError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <AppShell>
      <div className="bg-arena min-h-screen">
        <div className="mx-auto max-w-2xl px-4 py-24">
          <div
            role="alert"
            className="rounded-2xl border border-arena-pink/40 bg-arena-panel/60 p-6 text-white"
          >
            <div className="mb-3 flex items-center gap-2 text-arena-pink">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              <span className="font-bold uppercase tracking-wider">Couldn't load the lounge</span>
            </div>
            <p className="text-sm text-white/70">{error.message || "Please try again."}</p>
            <button
              type="button"
              onClick={() => reset()}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-arena-pink to-arena-violet px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function LobbyPage() {
  useSuspenseQuery(publicLoungesQuery());
  const { data: matches } = useSuspenseQuery(publicMatchesQuery());
  const cards = matches.map(toLiveCard);
  const featured = cards[0] ?? null;

  return (
    <AppShell>
      <div className="bg-arena min-h-screen">
        <div className="mx-auto w-full max-w-7xl px-4 pb-16 pt-4 sm:px-6 sm:pt-6 lg:px-8 lg:pb-20">
          <HeroSection featured={featured} />
          <div className="mt-6 grid gap-4 sm:mt-8 sm:gap-6 lg:grid-cols-[1.7fr_1fr]">
            <LiveLoungeCard cards={cards.slice(0, 5)} />
            <ClientOnly
              component={QuickDaresCard}
              fallback={<SectionFallback minH="min-h-[340px]" />}
            />
          </div>

          <div className="mt-4 grid gap-4 sm:mt-6 sm:gap-6 lg:grid-cols-[1fr_1.4fr] content-visibility-auto contain-intrinsic-size-180">
            <ClientOnly
              component={OneOnOneCard}
              fallback={<SectionFallback minH="min-h-[180px]" />}
            />
            <ClientOnly
              component={WhyPgxCard}
              fallback={<SectionFallback minH="min-h-[180px]" />}
            />
          </div>
          <div className="content-visibility-auto contain-intrinsic-size-120">
            <ClientOnly
              component={TrustStrip}
              fallback={<SectionFallback minH="min-h-[120px]" />}
            />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function HeroSection({ featured }: { featured: LiveCard | null }) {
  const joinNowRef = useImpression<HTMLAnchorElement>(
    "cta_join_now_impression",
    { location: "home_hero", featured_match_id: featured?.id ?? null },
    "join_now:" + (featured?.id ?? "none"),
  );
  const watchScriptRef = useImpression<HTMLAnchorElement>(
    "cta_watch_with_me_impression",
    {
      location: "home_hero",
      featured_match_id: featured?.id ?? null,
      creator: featured?.creator ?? null,
    },
    featured ? "watch_script:" + featured.id : null,
  );
  const watchCardRef = useImpression<HTMLAnchorElement>(
    "cta_watch_with_me_impression",
    {
      location: "home_hero_card",
      featured_match_id: featured?.id ?? null,
      creator: featured?.creator ?? null,
    },
    featured ? "watch_card:" + featured.id : null,
  );
  return (

    <section className="relative overflow-hidden rounded-2xl border border-arena-border bg-arena-panel/40 sm:rounded-3xl">
      <img
        src={heroImg}
        alt="PGX Sports Lounge — creator in front of live sports screens"
        className="absolute inset-0 h-full w-full object-cover object-[70%_center] opacity-90 lg:object-center"
        width={1600}
        height={1000}
        loading="eager"
        fetchPriority="high"
        decoding="async"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-arena-bg/90 via-arena-bg/70 to-arena-bg/80 lg:bg-gradient-to-r lg:from-arena-bg lg:via-arena-bg/70 lg:to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-arena-bg via-transparent to-transparent" />

      <div className="relative grid gap-6 p-5 sm:gap-8 sm:p-8 lg:min-h-[560px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10 lg:p-12">
        <div className="flex min-w-0 flex-col justify-center">
          <span className="t-eyebrow group mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-arena-pink/40 bg-arena-panel/60 px-3 py-1.5 text-white/90 shadow-[0_0_24px_-8px_oklch(0.7_0.22_340/0.6)] backdrop-blur-md sm:mb-6 sm:px-4">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-arena-pink opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-arena-pink" />
            </span>
            The Ultimate Sports & Creator Lounge
          </span>

          <h1 className="font-hero text-[2.5rem] font-extrabold leading-[0.92] tracking-[-0.035em] text-white drop-shadow-[0_4px_30px_rgba(0,0,0,0.5)] sm:text-[4.25rem] lg:text-[5.25rem]">
            <span className="block">Watch.</span>
            <span className="block">Interact.</span>
            <span className="block bg-gradient-to-r from-arena-pink via-arena-pink to-rose-300 bg-clip-text text-transparent [background-size:200%_100%] shimmer">
              Dare.
            </span>
            <span className="block bg-gradient-to-r from-arena-violet via-fuchsia-400 to-arena-cyan bg-clip-text text-transparent [background-size:200%_100%] shimmer">
              Connect.
            </span>
          </h1>

          <p className="t-body mt-6 max-w-md text-white/75 sm:mt-7">
            Live sports. Beautiful creators. Real connections —{" "}
            <span className="font-medium text-white/95">endless entertainment.</span>
          </p>

          <div className="mt-6 grid max-w-lg grid-cols-2 gap-3 sm:mt-8 sm:grid-cols-4 sm:gap-4">
            <HeroFeature icon={Video} title="Live Sports" sub="Big Screens" />
            <HeroFeature icon={MessageCircle} title="Live Chat" sub="Real Time" />
            <HeroFeature icon={Flame} title="Quick Dares" sub="Fun & Spicy" />
            <HeroFeature icon={Video} title="1 on 1 Calls" sub="Private & Personal" />
          </div>

          <div className="mt-6 sm:mt-8">
            <HeroJoinCta
              featuredId={featured?.id ?? null}
              joinNowRef={joinNowRef}
            />
          </div>
        </div>


        <div className="relative flex min-w-0 flex-col items-stretch justify-end gap-4 sm:items-end">
          {featured ? (
            <>
              <Link
                ref={watchScriptRef}
                to="/arena/$matchId"
                params={{ matchId: featured.id }}
                preload="viewport"
                onClick={() =>
                  trackEvent("cta_watch_with_me_click", {
                    location: "home_hero",
                    featured_match_id: featured.id,
                    creator: featured.creator,
                  })
                }
                aria-label={`Watch with ${featured.creator}`}
                className="hidden md:flex flex-col items-end leading-none text-arena-pink drop-shadow-[0_0_20px_rgba(255,60,120,0.6)] transition hover:scale-[1.03]"
                style={{ fontFamily: "'Brush Script MT', 'Snell Roundhand', cursive" }}
              >
                <span className="text-3xl italic">Watch with me</span>
                <span className="mt-1 text-xl" aria-hidden="true">♥</span>
              </Link>
              <Link
                ref={watchCardRef}
                to="/arena/$matchId"
                params={{ matchId: featured.id }}
                preload="viewport"
                onClick={() =>
                  trackEvent("cta_watch_with_me_click", {
                    location: "home_hero_card",
                    featured_match_id: featured.id,
                    creator: featured.creator,
                  })
                }
                className="fx-lift group block w-full min-w-0 rounded-2xl border border-arena-border bg-arena-panel/80 p-4 backdrop-blur-md hover:border-arena-pink/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-arena-pink/70 focus-visible:ring-offset-2 focus-visible:ring-offset-arena-bg sm:w-auto sm:min-w-[20rem] sm:max-w-md lg:max-w-sm"
              >
                <div className="flex items-center gap-3">
                  <img
                    src={featured.avatar || creatorLive}
                    alt={`${featured.creator} live`}
                    className="h-14 w-14 shrink-0 rounded-xl object-cover ring-2 ring-arena-pink transition duration-300 group-hover:ring-4 group-hover:ring-arena-pink/70"
                    loading="lazy"
                  />
                  <div className="min-w-0 flex-1">
                    {featured.isLive ? (
                      <span className="mb-1 inline-block rounded-md bg-live px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow-lg">
                        Live Now
                      </span>
                    ) : null}
                    <div className="flex items-center gap-1.5">
                      <span className="t-label fx-label truncate text-white">{featured.creator}</span>
                      <span className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full bg-arena-cyan text-[8px] font-bold text-arena-bg">
                        ✓
                      </span>
                    </div>
                    <p className="t-meta mt-0.5 truncate text-white/75">Watching {featured.title}</p>
                    <p className="t-micro mt-0.5 text-white/70">{formatViewers(featured.viewers)} watching</p>
                  </div>
                  <ArrowRight className="fx-arrow h-4 w-4 shrink-0 text-white/40" />
                </div>
              </Link>
            </>
          ) : (
            <div
              role="status"
              className="w-full min-w-0 rounded-2xl border border-dashed border-arena-border bg-arena-panel/60 p-5 text-center backdrop-blur-md sm:w-auto sm:min-w-[20rem] sm:max-w-md lg:max-w-sm"
            >
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full border border-arena-pink/40 bg-arena-bg/60 text-arena-pink">
                <Video className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="t-h3 text-white">No creators live right now</p>
              <p className="t-body mt-2 text-white/75">
                The lounge is quiet — check back soon or browse upcoming matches.
              </p>
              <Link
                to="/arena"
                className="mt-4 inline-flex items-center gap-2 rounded-full border border-arena-border bg-arena-bg/60 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-white transition-colors hover:border-arena-pink/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-arena-pink/70 focus-visible:ring-offset-2 focus-visible:ring-offset-arena-bg"
              >
                Browse Arena
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function HeroJoinCta({
  featuredId,
  joinNowRef,
}: {
  featuredId: string | null;
  joinNowRef: React.Ref<HTMLAnchorElement>;
}) {
  return (
    <div className="hero-join-cta inline-block w-full max-w-md rounded-full">
      <Link
        ref={joinNowRef}
        to="/auth"
        search={{ mode: "signup", redirect: "/arena" }}
        preload="viewport"
        onClick={() =>
          trackEvent("cta_join_now_click", {
            location: "home_hero",
            featured_match_id: featuredId,
          })
        }
        className="group hover-shine relative inline-flex w-full items-center justify-center gap-3 overflow-hidden rounded-full bg-gradient-to-r from-arena-pink via-fuchsia-500 to-arena-violet px-8 py-4 text-sm font-bold uppercase tracking-[0.22em] text-white shadow-[0_10px_40px_-10px_oklch(0.65_0.25_330/0.7)] ring-1 ring-white/15 transition-transform hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent opacity-0 [transform:translateX(-100%)] transition-all duration-700 group-hover:opacity-100 group-hover:[transform:translateX(100%)]" />
        <span>Join the Lounge</span>
        <span className="grid h-7 w-7 place-items-center rounded-full bg-white/20 backdrop-blur-sm ring-1 ring-white/30">
          <span className="hero-join-arrow inline-flex">
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </span>
      </Link>
    </div>
  );
}

function HeroFeature({ icon: Icon, title, sub }: { icon: typeof Video; title: string; sub: string }) {
  return (
    <div className="group flex items-center gap-3">
      <span className="fx-icon-tile grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-arena-pink/30 bg-arena-panel/40 text-arena-pink shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 leading-tight">
        <p className="t-label fx-label whitespace-nowrap text-white">{title}</p>
        <p className="t-micro mt-1 whitespace-nowrap text-white/70">{sub}</p>
      </div>
    </div>
  );
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
        <ArrowRight className="fx-arrow h-3 w-3" />
      </Link>
    </div>
  );
}

function LiveLoungeCard({ cards }: { cards: LiveCard[] }) {
  const sectionRef = useImpression<HTMLDivElement>(
    "live_lounge_impression",
    { location: "home_live_lounge", card_count: cards.length },
    "live_lounge:" + cards.length,
  );
  return (
    <div ref={sectionRef} className="rounded-2xl border border-arena-border bg-arena-panel/50 p-4 backdrop-blur sm:p-5">

      <SectionHeader title="Live in Sports Lounge" />
      {cards.length === 0 ? (
        <p className="t-body rounded-xl border border-dashed border-arena-border bg-arena-bg/40 p-6 text-center text-white/75">
          No live matches right now. Check back soon.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5">

          {cards.map((l, index) => (
            <Link
              key={l.id}
              to="/arena/$matchId"
              params={{ matchId: l.id }}
              preload="viewport"
              onClick={() =>
                trackEvent("live_lounge_tile_click", {
                  location: "home_live_lounge",
                  match_id: l.id,
                  creator: l.creator,
                  position: index,
                  is_live: l.isLive,
                })
              }
              className="fx-lift group block overflow-hidden rounded-xl border border-arena-border bg-arena-panel/60 hover:border-arena-pink/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-arena-pink/70 focus-visible:ring-offset-2 focus-visible:ring-offset-arena-bg"
            >
              <div className="relative aspect-[4/3] overflow-hidden">
                <img
                  src={l.img}
                  alt={l.title}
                  className="h-full w-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-110"
                  loading="lazy"
                />
                <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-arena-bg/70 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                {l.isLive ? (
                  <span className="absolute left-2 top-2 rounded-md bg-live px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow-lg transition-transform group-hover:scale-105">
                    Live
                  </span>
                ) : null}
                <img
                  src={l.avatar}
                  alt=""
                  className="absolute -bottom-4 left-2 h-10 w-10 rounded-full object-cover ring-2 ring-arena-panel transition-transform duration-300 group-hover:-translate-y-1 group-hover:ring-arena-pink"
                  loading="lazy"
                />
              </div>
              <div className="px-3 pt-5 pb-3.5">
                <p className="t-label fx-label truncate text-white">{l.title}</p>
                <p className="t-meta mt-1 truncate text-white/75">with {l.creator}</p>
                <p className="t-micro mt-0.5 text-white/65">{formatViewers(l.viewers)} watching</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}


function SectionFallback({ minH = "min-h-[180px]" }: { minH?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`rounded-2xl border border-arena-border bg-arena-panel/40 ${minH} shimmer`}
    />
  );
}
