import { useState } from "react";
import { withAuth } from "@/components/RequireAuth";
import { Link, Outlet, createFileRoute, useParams, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Home, Menu, Settings2, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetHeader } from "@/components/ui/sheet";
import { useIptvSettings } from "@/hooks/useIptvSettings";
import { useIptvFavorites } from "@/hooks/useIptvFavorites";
import { useIptvRecents } from "@/hooks/useIptvRecents";
import { useIptvPlaylist } from "@/hooks/useIptvPlaylist";
import { ChannelList } from "@/components/iptv/ChannelList";
import { RecentlyWatched } from "@/components/iptv/RecentlyWatched";
import { getRequestOrigin } from "@/lib/origin.functions";

export const Route = createFileRoute("/iptv")({
  loader: async () => ({ origin: await getRequestOrigin() }),
  head: ({ loaderData }) => {
    const origin = loaderData?.origin ?? "";
    const url = origin ? `${origin}/iptv` : "/iptv";
    const title = "IPTV — Live TV | PGX";
    const description = "Watch live IPTV channels from any M3U playlist URL in PGX.";
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
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: withAuth(IptvLayout),
});

function IptvLayout() {
  const { url, ready } = useIptvSettings();
  const { data: channels = [], isLoading, error } = useIptvPlaylist(ready ? url : "");
  const { ids: favorites, toggle } = useIptvFavorites();
  const { ids: recentIds } = useIptvRecents();
  const params = useParams({ strict: false }) as { channelId?: string };
  const activeId = params.channelId;
  const [sheetOpen, setSheetOpen] = useState(false);
  const router = useRouter();
  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.history.back();
    } else {
      router.navigate({ to: "/" });
    }
  };

  const sidebar = (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Channels</h2>
          <p className="text-xs text-muted-foreground">
            {isLoading ? "Loading…" : `${channels.length} loaded`}
          </p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/iptv/settings">
            <Settings2 className="h-4 w-4" />
          </Link>
        </Button>
      </div>
      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          {(error as Error).message}
          <div className="mt-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/iptv/settings">Open settings</Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {channels.length > 0 && recentIds.length > 0 && (
            <RecentlyWatched
              channels={channels}
              recentIds={recentIds}
              activeId={activeId}
              onNavigate={() => setSheetOpen(false)}
            />
          )}
          <div className="min-h-0 flex-1">
            <ChannelList
              channels={channels}
              favorites={favorites}
              activeId={activeId}
              onToggleFavorite={toggle}
            />
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Go back" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="md:hidden" aria-label="Channels">
                <Menu className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[85vw] max-w-sm p-4">
              <SheetHeader>
                <SheetTitle>Channels</SheetTitle>
              </SheetHeader>
              <div className="mt-3 h-[calc(100vh-6rem)]" onClick={() => setSheetOpen(false)}>
                {sidebar}
              </div>
            </SheetContent>
          </Sheet>
          <h1 className="text-xl font-semibold">IPTV</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/">
              <Home className="mr-2 h-4 w-4" /> Home
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/arena">
              <Trophy className="mr-2 h-4 w-4" /> Arena
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/iptv/settings">
              <Settings2 className="mr-2 h-4 w-4" /> Settings
            </Link>
          </Button>
        </div>
      </header>
      <div className="grid gap-4 md:grid-cols-[320px_1fr]">
        <aside className="hidden md:block h-[calc(100vh-8rem)] rounded-lg border border-border/50 bg-card/40 p-3">
          {sidebar}
        </aside>
        <main className="min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
