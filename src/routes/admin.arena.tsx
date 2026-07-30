import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The legacy Arena match editor has been retired in favour of Lounge and TV
 * management. Keep the route as a redirect so saved admin bookmarks do not
 * land on a broken or partially supported screen.
 */
export const Route = createFileRoute("/admin/arena")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/lounges" });
  },
});
