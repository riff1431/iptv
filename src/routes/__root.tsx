import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";

import appCss from "../styles.css?url";

// Keep the fallback asset version deterministic across SSR and hydration.
// A runtime Date.now() value here renders different HTML on the server and
// client, which breaks React hydration and can make the first interaction fall
// back to a full document reload instead of a smooth client-side transition.
const FALLBACK_ASSET_VERSION = "site";


import { reportLovableError } from "../lib/lovable-error-reporting";
import { trackEvent } from "@/lib/analytics";
import { Toaster } from "@/components/ui/sonner";
import { installSessionPersistence } from "@/lib/session-persistence";
import { PageTransition } from "@/components/motion";
import { getSiteSettings, type SiteSettings } from "@/lib/site-settings.functions";
import { buildSiteHeadTags } from "@/lib/site-head-tags";
import { installPerfObserver, installRouterPerfTracing, traceSpan } from "@/lib/perf-trace";
import { AuthProvider } from "@/hooks/useAuth";

if (typeof window !== "undefined") {
  installPerfObserver();
}

// Install "remember me" ephemeral-session handling before any Supabase
// client access. Restores a stashed session token from sessionStorage
// (set on the previous pagehide) so the client can hydrate it.
if (typeof window !== "undefined") {
  installSessionPersistence();
}

function matchTrackedPrefix(pathname: string): string | null {
  if (pathname === "/") return "/";
  const seg = "/" + (pathname.split("/")[1] ?? "");
  if (seg === "/auth" || seg === "/arena" || seg === "/admin") return seg;
  return null;
}



function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stadium px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-7xl font-bold text-gradient-primary">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Lounge not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This room doesn't exist. Head back to the main lobby.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:brightness-110"
          >
            Back to Lobby
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-stadium px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This screen didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong. Try refreshing or head back to the lobby.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-110"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
          >
            Lobby
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // Site settings rarely change. Keep the loader result fresh for a minute so
  // client-side navigations reuse the cached value; the server function has
  // its own per-isolate cache with the same TTL and is busted on admin save.
  staleTime: 60_000,
  gcTime: 5 * 60_000,
  loader: async (): Promise<SiteSettings> => {
    return traceSpan(
      "loader /__root (getSiteSettings)",
      async () => {
        try {
          return await getSiteSettings();
        } catch {
          return {
            site_name: "Sports Lounge — PlayGroundX",
            meta_title: "Sports Lounge — PlayGroundX",
            meta_description:
              "Enter a luxury virtual sports lounge and watch four live sporting events at once. Powered by PlayGroundX.",
            logo_url: null,
            favicon_url: null,
            og_image_url: null,
            twitter_handle: null,
            updated_at: null,
          };
        }
      },
      { thresholdMs: 500, meta: { kind: "loader", route: "/__root" } },
    );
  },
  head: ({ loaderData }) => {
    const s = loaderData as SiteSettings | undefined;
    const assetVersion = s?.updated_at
      ? encodeURIComponent(s.updated_at)
      : FALLBACK_ASSET_VERSION;
    const { meta, links } = buildSiteHeadTags(s, { buildId: assetVersion });
    return {
      meta,
      links: [
        { rel: "stylesheet", href: appCss },
        ...links,
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=Manrope:wght@400;500;700&family=Space+Grotesk:wght@500;700&display=swap",
        },
      ],
    };
  },
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>

    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const prevPathRef = useRef<string | null>(null);

  useEffect(() => {
    function emit(pathname: string, search: string) {
      const section = matchTrackedPrefix(pathname);
      if (!section) return;
      const from = prevPathRef.current;
      trackEvent("pageview", {
        path: pathname,
        section,
        search: search || null,
        from,
        referrer: typeof document !== "undefined" ? document.referrer || null : null,
      });
      if (from && from !== pathname) {
        trackEvent("route_change", { from, to: pathname, section });
      }
      prevPathRef.current = pathname;
    }

    // initial pageview
    const loc = router.state.location;
    emit(loc.pathname, loc.searchStr ?? "");

    const unsub = router.subscribe("onResolved", ({ toLocation }) => {
      emit(toLocation.pathname, toLocation.searchStr ?? "");
    });
    const unsubPerf = installRouterPerfTracing(
      router as unknown as Parameters<typeof installRouterPerfTracing>[0],
    );
    return () => {
      unsub();
      unsubPerf();
    };
  }, [router]);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PageTransition>
          <Outlet />
        </PageTransition>
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  );
}

