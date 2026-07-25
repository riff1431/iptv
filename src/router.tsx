import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Prefetch the matched route + its loader data on hover/focus/touchstart
    // so client-side navigations to deep links (arena matches, lounges, iptv)
    // feel instant. Query owns cache freshness (defaultPreloadStaleTime: 0).
    defaultPreload: "intent",
    defaultPreloadDelay: 50,
    defaultPreloadStaleTime: 0,
  });

  return router;
};

