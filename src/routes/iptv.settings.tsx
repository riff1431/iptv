import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  ShieldCheck,
  Cloud,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useIptvSettings } from "@/hooks/useIptvSettings";
import { useIptvPlaylist, useIptvPlaylistStatus } from "@/hooks/useIptvPlaylist";

// Error messages produced by the SSRF guard in
// src/routes/api/public/iptv/playlist.ts. Keep in sync with `validateUrl` there.
// We classify each into a short human reason so the UI can show *why* the
// playlist was refused instead of just "Proxy HTTP 400".
function classifySsrfBlock(message: string | undefined): {
  blocked: boolean;
  reason: string;
} {
  const m = (message ?? "").toLowerCase();
  if (!m) return { blocked: false, reason: "" };
  if (m.includes("only http(s)") || m.includes("must be http"))
    return { blocked: true, reason: "Only http:// and https:// URLs are allowed." };
  if (m.includes("credentials"))
    return {
      blocked: true,
      reason: "URLs with embedded user:password credentials are not allowed.",
    };
  if (m.startsWith("port ") || m.includes("port is not allowed") || m.includes("is not allowed") && m.startsWith("port"))
    return { blocked: true, reason: "That port is not on the allowlist (80, 443, 8080, 8443)." };
  if (m.includes("host is not allowed"))
    return {
      blocked: true,
      reason:
        "That host is blocked (loopback, private/RFC1918, link-local, cloud metadata, or mDNS).",
    };
  if (m.includes("host is required"))
    return { blocked: true, reason: "The URL is missing a hostname." };
  if (m.includes("control characters") || m.includes("whitespace"))
    return {
      blocked: true,
      reason: "The URL contains whitespace or control characters.",
    };
  if (m.includes("internationalised") || m.includes("xn--"))
    return {
      blocked: true,
      reason: "Internationalised (punycode) hostnames are not allowed.",
    };
  if (m.includes("exceeds maximum length"))
    return { blocked: true, reason: "The URL is too long (max 2048 chars)." };
  if (m.includes("invalid url"))
    return { blocked: true, reason: "The URL could not be parsed." };
  return { blocked: false, reason: "" };
}

export const Route = createFileRoute("/iptv/settings")({
  head: () => ({
    meta: [
      { title: "IPTV — Playlist settings" },
      { name: "description", content: "Configure the IPTV M3U playlist URL." },
    ],
  }),
  component: IptvSettings,
});

function IptvSettings() {
  const { url, setUrl, reset, ready, demoUrl, globalUrl, hasLocalOverride, source } =
    useIptvSettings();
  const [draft, setDraft] = useState(url);
  const query = useIptvPlaylist(ready ? url : "");
  const status = useIptvPlaylistStatus(ready ? url : "");

  useEffect(() => {
    setDraft(url);
  }, [url]);


  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/iptv">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to IPTV
          </Link>
        </Button>
      </div>

      <section className="rounded-lg border border-border/50 bg-card/40 p-5">
        <h2 className="text-lg font-semibold">M3U Playlist</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The active playlist is configured by an admin under{" "}
          <Link to="/admin/iptv-provider" className="underline">
            IPTV Provider settings
          </Link>{" "}
          and shared across every match. You can optionally override it in this browser only.
        </p>
        <div className="mt-3 rounded-md border border-border/50 bg-background/60 p-3 text-xs">
          <div className="font-semibold">
            Current source:{" "}
            <span className="text-primary">
              {source === "override"
                ? "Local override (this browser only)"
                : source === "global"
                  ? "Global admin-configured provider"
                  : "Demo playlist (no provider configured)"}
            </span>
          </div>
          {globalUrl && (
            <div className="mt-1 text-muted-foreground">
              Global: <code className="break-all">{globalUrl}</code>
            </div>
          )}
        </div>
        <div className="mt-4 grid gap-2">
          <Label htmlFor="m3u-url">Local override URL</Label>
          <Input
            id="m3u-url"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="https://example.com/playlist.m3u"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button onClick={() => setUrl(draft.trim())}>Use this playlist here</Button>
            <Button variant="outline" onClick={reset} disabled={!hasLocalOverride}>
              Clear override
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Demo playlist:{" "}
            <a href={demoUrl} className="underline" target="_blank" rel="noreferrer">
              {demoUrl}
            </a>{" "}
            (public iptv-org catalog — for development/testing only).
          </p>
        </div>


        <div className="mt-5 space-y-2 rounded-md border border-border/50 bg-background/60 p-3 text-sm">
          {query.isLoading && (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading playlist…
            </span>
          )}
          {query.isSuccess && (
            <span className="flex items-center gap-2 text-emerald-500">
              <CheckCircle2 className="h-4 w-4" />
              Loaded {query.data.length} channels.
            </span>
          )}
          {query.isError && (() => {
            const errMsg = (query.error as Error).message;
            // The proxy's SSRF guard surfaces its reason through either the
            // query error (when the client fetch echoed it) or status.proxyError.
            const cls = classifySsrfBlock(errMsg);
            const proxyCls = classifySsrfBlock(status?.proxyError);
            const block = cls.blocked ? cls : proxyCls;
            if (block.blocked) {
              return (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs"
                >
                  <div className="flex items-center gap-2 font-medium text-destructive">
                    <ShieldAlert className="h-4 w-4" />
                    Playlist blocked by security policy
                  </div>
                  <p className="mt-1 text-foreground/90">{block.reason}</p>
                  <p className="mt-2 text-muted-foreground">
                    The playlist proxy refuses URLs that could be used to reach
                    internal or non-HTTP services. Update the playlist URL and
                    try again.
                  </p>
                  {(status?.proxyError || errMsg) && (
                    <p className="mt-2 text-muted-foreground">
                      <span className="font-medium">Server response:</span>{" "}
                      <code className="break-all">{status?.proxyError ?? errMsg}</code>
                    </p>
                  )}
                </div>
              );
            }
            return (
              <span className="flex items-start gap-2 text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {errMsg}
              </span>
            );
          })()}

          {status && (status.source === "direct" ? (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              Loaded directly from the provider (CORS allowed).
            </span>
          ) : (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
              <div className="flex items-center gap-2 font-medium text-amber-600 dark:text-amber-400">
                <Cloud className="h-3.5 w-3.5" />
                Using server-side proxy fallback
              </div>
              <p className="mt-1 text-muted-foreground">
                The provider blocked the direct browser fetch, so this playlist is being routed
                through <code>/api/public/iptv/playlist</code>.
              </p>
              {status.directError && (
                <p className="mt-1 text-muted-foreground">
                  <span className="font-medium">Direct fetch error:</span> {status.directError}
                </p>
              )}
              {status.proxyError && (
                <p className="mt-1 text-destructive">
                  <span className="font-medium">Proxy error:</span> {status.proxyError}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-dashed border-border/60 bg-card/20 p-5">
        <h3 className="text-base font-semibold">Xtream Codes (production — coming soon)</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          These fields are reserved for your licensed provider. Values entered here are not saved
          yet.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Server URL</Label>
            <Input disabled placeholder="http://provider.example.com" />
          </div>
          <div className="grid gap-1.5">
            <Label>Username</Label>
            <Input disabled placeholder="username" />
          </div>
          <div className="grid gap-1.5">
            <Label>Password</Label>
            <Input disabled type="password" placeholder="••••••••" />
          </div>
          <div className="grid gap-1.5">
            <Label>EPG / XMLTV URL</Label>
            <Input disabled placeholder="https://provider.example.com/xmltv.php" />
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Admins with an existing subscription can already wire real Xtream credentials into a TV
          slot at{" "}
          <Link to="/admin/tvs" className="underline">
            /admin/tvs
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
