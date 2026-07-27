import { useState } from "react";
import { withAuth } from "@/components/RequireAuth";
import { Link, Outlet, createFileRoute, useParams, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Home, Menu, Settings2, Trophy, Tv, Radio, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
    const title = "IPTV — Live TV Cinema | PGX Sports";
    const description =
      "Stream 18,000+ live IPTV channels with HD clarity and zero buffering in PGX Sports Lounge.";
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
      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-xs text-destructive">
          <p className="font-semibold">{error instanceof Error ? error.message : String(error)}</p>
          <div className="mt-3">
            <Button
              asChild
              size="sm"
              variant="outline"
              className="h-8 border-destructive/50 text-xs"
            >
              <Link to="/iptv/settings">Re-check IPTV Settings</Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
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
              loading={isLoading}
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
    <div className="min-h-screen w-full bg-[#0B0F17] text-foreground selection:bg-primary selection:text-primary-foreground">
      {/* Top Header */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0B0F17]/80 backdrop-blur-md px-4 py-3">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground hover:bg-white/10 hover:text-foreground"
              aria-label="Go back"
              onClick={handleBack}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 border-white/10 md:hidden"
                  aria-label="Channels"
                >
                  <Menu className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-[88vw] max-w-md border-white/10 bg-[#0B0F17] p-4 text-foreground"
              >
                <SheetHeader className="pb-2 border-b border-white/10">
                  <SheetTitle className="flex items-center gap-2 text-base text-foreground">
                    <Tv className="h-5 w-5 text-primary" />
                    <span>Channels Explorer</span>
                  </SheetTitle>
                </SheetHeader>
                <div className="mt-4 h-[calc(100vh-6.5rem)]" onClick={() => setSheetOpen(false)}>
                  {sidebar}
                </div>
              </SheetContent>
            </Sheet>
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-tr from-primary to-purple-600 text-white shadow-md shadow-primary/20">
                <Tv className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-bold tracking-tight text-foreground">
                    IPTV Cinema
                  </h1>
                  <Badge
                    variant="outline"
                    className="hidden sm:inline-flex border-emerald-500/40 bg-emerald-500/10 text-emerald-400 text-[10px] font-bold"
                  >
                    <Radio className="mr-1 h-3 w-3 animate-pulse text-emerald-400" />
                    LIVE
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {isLoading
                    ? "Connecting to provider..."
                    : `${channels.length.toLocaleString()} Live Channels`}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="hidden sm:inline-flex h-8 border-white/5 text-xs text-muted-foreground hover:text-foreground"
            >
              <Link to="/">
                <Home className="mr-1.5 h-3.5 w-3.5" /> Home
              </Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="hidden sm:inline-flex h-8 border-white/5 text-xs text-muted-foreground hover:text-foreground"
            >
              <Link to="/arena">
                <Trophy className="mr-1.5 h-3.5 w-3.5 text-amber-400" /> Arena
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-8 border-white/10 bg-white/5 text-xs font-semibold hover:bg-white/10"
            >
              <Link to="/iptv/settings">
                <Settings2 className="mr-1.5 h-3.5 w-3.5 text-primary" /> Settings
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Grid Content */}
      <div className="mx-auto max-w-7xl p-4">
        <div className="grid gap-4 md:grid-cols-[340px_1fr]">
          <aside className="hidden md:block h-[calc(100vh-6.5rem)] rounded-xl border border-white/10 bg-card/40 backdrop-blur-md p-3.5 shadow-xl shadow-black/40">
            {sidebar}
          </aside>
          <main className="min-w-0">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
