import { createFileRoute, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LoungeGridWithAds } from "@/components/sports-arena/LoungeGridWithAds";

/**
 * Embed route: renders only the 4-TV grid, no shell, no gate, no chat.
 * Designed to be iframed from PlayGroundX. Access control still applies
 * via the underlying playlist proxy (bearer token required), so this page
 * only works when the parent site loads it with an authenticated session.
 *
 * Allowed parent origins can be configured in `app_settings.allowed_iframe_parent_origins`.
 * A future CSP `frame-ancestors` header can be added at the edge; browsers
 * ignore that directive from `<meta>` tags, so it must be set as an HTTP header.
 */
export const Route = createFileRoute("/embed/lounge/$loungeId")({
  loader: async ({ params }) => {
    const { data } = await supabase
      .from("lounges")
      .select("id, name, slug")
      .or(`id.eq.${params.loungeId},slug.eq.${params.loungeId}`)
      .maybeSingle();
    if (!data) throw notFound();
    return { lounge: data };
  },
  component: EmbedLoungePage,
  notFoundComponent: () => (
    <div className="flex h-screen items-center justify-center bg-black text-sm text-white/70">
      Lounge not found
    </div>
  ),
  errorComponent: () => (
    <div className="flex h-screen items-center justify-center bg-black text-sm text-white/70">
      Failed to load lounge
    </div>
  ),
});

function EmbedLoungePage() {
  const { lounge } = Route.useLoaderData();
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  // Wait for a session so the playlist proxy can authenticate.
  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (mounted) setReady(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setReady(!!session);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-xs uppercase tracking-widest text-white/60">
        Waiting for parent session…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black p-2">
      <LoungeGridWithAds
        loungeId={lounge.id}
        activeSlot={activeSlot}
        onActiveSlotChange={setActiveSlot}
        adsEnabled
      />
    </div>
  );
}
