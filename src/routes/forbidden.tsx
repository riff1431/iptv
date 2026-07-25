import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { z } from "zod";

export const Route = createFileRoute("/forbidden")({
  ssr: false,
  validateSearch: z.object({ from: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "403 — Access denied" },
      { name: "description", content: "You don't have permission to view this page." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ForbiddenPage,
});

function ForbiddenPage() {
  const { from } = Route.useSearch();
  return (
    <div className="flex min-h-screen items-center justify-center bg-stadium px-4">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/15 text-destructive">
          <ShieldAlert className="h-8 w-8" />
        </div>
        <h1 className="font-display text-6xl font-bold text-gradient-primary">403</h1>
        <h2 className="mt-3 text-xl font-semibold text-foreground">Admins only</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account doesn't have permission to view
          {from ? <> <span className="font-mono text-foreground">{from}</span></> : " this page"}.
          If you think this is a mistake, ask an existing admin to add you to the allowlist.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Link
            to="/dashboard"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:brightness-110"
          >
            Go to dashboard
          </Link>
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted"
          >
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
