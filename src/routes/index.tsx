import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/useAuth";
import { publicLoungesQuery } from "@/lib/lounges.public.functions";
import { publicMatchesQuery } from "@/lib/matches.public.functions";
import { publicQuickDaresQuery } from "@/lib/quick-dares.public.functions";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getRequestOrigin } from "@/lib/origin.functions";
import { AlertTriangle, Loader2 } from "lucide-react";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import heroImg from "@/assets/pgx/hero.jpg";

// Lazy load home landing page sections & logged-in user dashboard
const HeroSection = lazy(() => import("@/components/home/HeroSection"));
const LiveSportsGrid = lazy(() => import("@/components/home/LiveSportsGrid"));
const QuickDaresCard = lazy(() => import("@/components/home/QuickDaresCard"));
const OneOnOneCard = lazy(() => import("@/components/home/OneOnOneCard"));
const WhyPgxCard = lazy(() => import("@/components/home/WhyPgxCard"));
const TrustStrip = lazy(() => import("@/components/home/TrustStrip"));
const UserDashboardHome = lazy(() => import("@/components/home/UserDashboardHome"));

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
        { rel: "preload", as: "image", href: heroImg, fetchPriority: "high" } as unknown as {
          rel: string;
          href: string;
        },
      ],
    };
  },
  pendingMs: 200,
  pendingComponent: LobbyPending,
  errorComponent: LobbyError,
  component: HomePage,
});

function SectionFallback({ minH = "min-h-[180px]" }: { minH?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`rounded-2xl border border-slate-800 bg-slate-900/40 ${minH} animate-pulse`}
    />
  );
}

function LobbyPending() {
  return (
    <AppShell>
      <div className="bg-slate-950 min-h-screen">
        <div className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 py-4 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin text-pink-500" aria-hidden="true" />
            <span>Loading PGX Sports Lounge…</span>
          </div>
          <SectionFallback minH="min-h-[480px]" />
        </div>
      </div>
    </AppShell>
  );
}

function LobbyError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <AppShell>
      <div className="bg-slate-950 min-h-screen py-16">
        <div className="mx-auto max-w-md px-4 text-center">
          <div className="rounded-2xl border border-rose-900/50 bg-rose-950/20 p-6 text-slate-200 backdrop-blur">
            <AlertTriangle className="mx-auto h-10 w-10 text-rose-500" />
            <h2 className="mt-3 text-lg font-bold text-white">Could not load the lounge</h2>
            <p className="mt-2 text-xs text-slate-400">{error?.message || "An error occurred."}</p>
            <button
              type="button"
              onClick={() => reset()}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-lg"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function HomePage() {
  const { user } = useAuth();
  useSuspenseQuery(publicLoungesQuery());
  useSuspenseQuery(publicMatchesQuery());

  return (
    <AppShell>
      <div className="bg-slate-950 min-h-screen text-slate-100 selection:bg-pink-500 selection:text-white">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">
          {user ? (
            /* LOGGED IN USER HOME VIEW (Image 2 Dashboard) */
            <ClientOnly
              component={UserDashboardHome}
              fallback={<SectionFallback minH="min-h-[600px]" />}
            />
          ) : (
            /* LOGGED OUT VISITOR LANDING PAGE VIEW (Image 1 Hero Landing) */
            <>
              <ClientOnly
                component={HeroSection}
                fallback={<SectionFallback minH="min-h-[450px]" />}
              />

              <div className="grid gap-6 lg:grid-cols-[1.8fr_1fr]">
                <ClientOnly
                  component={LiveSportsGrid}
                  fallback={<SectionFallback minH="min-h-[360px]" />}
                />
                <ClientOnly
                  component={QuickDaresCard}
                  fallback={<SectionFallback minH="min-h-[360px]" />}
                />
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <ClientOnly
                  component={OneOnOneCard}
                  fallback={<SectionFallback minH="min-h-[180px]" />}
                />
                <ClientOnly
                  component={WhyPgxCard}
                  fallback={<SectionFallback minH="min-h-[180px]" />}
                />
              </div>

              <ClientOnly
                component={TrustStrip}
                fallback={<SectionFallback minH="min-h-[100px]" />}
              />
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
