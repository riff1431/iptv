import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { withAuth } from "@/components/RequireAuth";
import { useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { LoungeGridWithAds } from "@/components/sports-arena/LoungeGridWithAds";
import theatreBg from "@/assets/arena-theatre-bg.jpg.asset.json";
import { LoungeAccessGate } from "@/components/sports-arena/LoungeAccessGate";
import { ArenaTopNav } from "@/components/sports-arena/ArenaTopNav";
import { ArenaHeader } from "@/components/sports-arena/ArenaHeader";
import { ArenaActionBar } from "@/components/sports-arena/ArenaActionBar";
import { ArenaBottomTabs } from "@/components/sports-arena/ArenaBottomTabs";
import { ArenaChatPanel } from "@/components/sports-arena/ArenaChatPanel";
import { publicLoungeBySlugQuery } from "@/lib/lounges.public.functions";
import { useLoungePresence } from "@/hooks/useLoungePresence";
import { getRequestOrigin } from "@/lib/origin.functions";

export const Route = createFileRoute("/lounge/$loungeId")({
  loader: async ({ params, context }) => {
    const [lounge, origin] = await Promise.all([
      context.queryClient.ensureQueryData(publicLoungeBySlugQuery(params.loungeId)),
      getRequestOrigin(),
    ]);
    if (!lounge) throw notFound();
    return { lounge, origin };
  },
  head: ({ params, loaderData }) => {
    const origin = loaderData?.origin ?? "";
    const url = `${origin}/lounge/${params.loungeId}`;
    const lounge = loaderData?.lounge;
    if (!lounge) {
      return {
        meta: [
          { title: "Lounge not found — PGX Sports Lounge" },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    const title = `${lounge.name} — PGX Sports Lounge`;
    const description =
      lounge.tagline ||
      `Watch ${lounge.match?.title ?? "live sports"} in the ${lounge.name} lounge with the PGX community.`;
    const image = lounge.coverImageUrl ?? lounge.match?.thumbnailUrl ?? null;
    const meta = [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "video.other" },
      { property: "og:url", content: url },
      { property: "og:site_name", content: "PGX Sports Lounge" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ];
    if (image) {
      meta.push(
        { property: "og:image", content: image },
        { name: "twitter:image", content: image },
      );
    }
    return {
      meta,
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: withAuth(LoungePage),
  notFoundComponent: () => (
    <div className="min-h-screen bg-arena text-white">
      <ArenaTopNav />
      <div className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="font-display text-3xl font-bold">Lounge not found</h1>
        <p className="mt-2 text-muted-foreground">This room doesn't exist yet.</p>
        <Button asChild className="mt-6">
          <Link to="/">Back to Lobby</Link>
        </Button>
      </div>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="min-h-screen bg-arena text-white">
      <ArenaTopNav />
      <div className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="font-display text-2xl font-bold">Lounge unavailable</h1>
        <p className="mt-2 text-muted-foreground">{error.message}</p>
      </div>
    </div>
  ),
});


function LoungePage() {
  const { loungeId: slug } = Route.useParams();
  const navigate = useNavigate();
  const { data: lounge } = useSuspenseQuery(publicLoungeBySlugQuery(slug));
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [chatVisible, setChatVisible] = useState(true);

  // Presence-based real viewer count for this lounge. `null` before the
  // channel is joined — fall back to the baseline so the header isn't blank.
  const presence = useLoungePresence(lounge?.id);
  const viewers = presence ?? lounge?.viewerCount ?? 0;

  if (!lounge) return null;

  return (
    <div className="min-h-screen bg-arena text-white">
      <ArenaTopNav />

      <main className="mx-auto max-w-[1600px] px-3 pt-3 sm:px-6 sm:pt-4">
        <ArenaHeader liveGames={lounge.tvs.length} viewers={viewers} />

        <div className="relative isolate overflow-hidden rounded-3xl border border-arena-border">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${theatreBg.url})` }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--arena-bg)_55%,transparent)_0%,color-mix(in_oklab,var(--arena-bg)_30%,transparent)_45%,color-mix(in_oklab,var(--arena-bg)_80%,transparent)_100%)]"
          />

          <div
            className={`relative grid gap-4 p-3 sm:gap-5 sm:p-5 lg:p-6 ${
              chatVisible ? "lg:grid-cols-[minmax(0,1fr)_360px]" : "lg:grid-cols-1"
            }`}
          >
            <div className="min-w-0">
              <LoungeAccessGate loungeId={lounge.id}>
                {(access) => (
                  <LoungeGridWithAds
                    loungeId={lounge.id}
                    activeSlot={activeSlot}
                    onActiveSlotChange={setActiveSlot}
                    adsEnabled={access.status === "preview" || access.status === "paid"}
                  />
                )}
              </LoungeAccessGate>
            </div>

            <div className={`min-w-0 ${chatVisible ? "" : "hidden"}`}>
              <ArenaChatPanel
                loungeId={lounge.id}
                online={viewers}
                visible={chatVisible}
              />
            </div>
          </div>

          <div className="relative px-3 pb-3 sm:px-5 sm:pb-5 lg:px-6 lg:pb-6">
            <ArenaActionBar
              loungeId={lounge.id}
              tvs={lounge.tvs}
              chatVisible={chatVisible}
              onToggleChat={() => setChatVisible((v) => !v)}
              onLeave={() => navigate({ to: "/" })}
            />
          </div>
        </div>
      </main>

      <ArenaBottomTabs />
    </div>
  );
}

