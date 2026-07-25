import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Beta-namespace typed wrapper — mirrors the runtime methods provided by
// @supabase/supabase-js's auth.oauth namespace.
type AuthorizationClient = { name?: string | null; client_id?: string | null };
type AuthorizationDetails = {
  client?: AuthorizationClient | null;
  redirect_uri?: string | null;
  scope?: string | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
};
type OAuthResult = { data: AuthorizationDetails | null; error: { message: string } | null };
type OAuthNamespace = {
  getAuthorizationDetails: (id: string) => Promise<OAuthResult>;
  approveAuthorization: (id: string) => Promise<OAuthResult>;
  denyAuthorization: (id: string) => Promise<OAuthResult>;
};
const oauth = (supabase.auth as unknown as { oauth: OAuthNamespace }).oauth;

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/auth", search: { redirect: next } });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauth.getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="mx-auto max-w-md p-8 text-white">
      <h1 className="text-xl font-bold">Authorization error</h1>
      <p className="mt-2 text-white/70">
        Could not load this authorization request: {String((error as Error)?.message ?? error)}
      </p>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientName = details?.client?.name ?? "an app";

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error } = approve
      ? await oauth.approveAuthorization(authorization_id)
      : await oauth.denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6 text-white">
      <div>
        <h1 className="font-hero text-2xl font-black tracking-tight sm:text-3xl">
          Connect {clientName} to your PGX account
        </h1>
        <p className="mt-2 text-sm text-white/70">
          {clientName} will be able to call PGX Sports Lounge's enabled tools while you are signed in.
        </p>
      </div>
      <ul className="space-y-2 rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/80">
        <li>• Share your basic profile</li>
        <li>• Read your lounges, matches, and wallet balance</li>
      </ul>
      <p className="text-xs text-white/50">
        This does not bypass PGX's permissions or backend policies.
      </p>
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button
          disabled={busy}
          onClick={() => decide(true)}
          className="flex-1 rounded-lg px-4 py-3 font-semibold text-white shadow-lg disabled:opacity-50"
          style={{ backgroundImage: "linear-gradient(90deg, var(--arena-pink), var(--arena-violet))" }}
        >
          {busy ? "Working…" : "Approve"}
        </button>
        <button
          disabled={busy}
          onClick={() => decide(false)}
          className="flex-1 rounded-lg border border-white/15 bg-white/5 px-4 py-3 font-semibold text-white/90 hover:bg-white/10 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </main>
  );
}
