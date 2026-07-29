// Admin UI: Start / Stop / status for a TV's shared stream session.
// Reads realtime updates from `tv_stream_sessions` so the badge flips
// instantly for every admin viewing this page.

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Play, Square, Activity, Loader2, Users, RefreshCw, MonitorPlay } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useLoungePresence } from "@/hooks/useLoungePresence";

import {
  startLoungeStream,
  stopLoungeStream,
  switchChannel,
  getStreamHealth,
} from "@/lib/stream-admin.functions";

const LazyAdminTvPreviewDialog = lazy(() =>
  import("@/components/admin/AdminTvPreviewDialog").then((module) => ({
    default: module.AdminTvPreviewDialog,
  })),
);

type SessionRow = {
  status: "starting" | "live" | "stopped" | "error";
  channel_id: string | null;
  started_at: string | null;
  last_playlist_fetch_at: string | null;
  last_error: string | null;
};

export function StreamControl({
  tvId,
  slot,
  displayName,
  loungeId,
  hasChannel,
  currentChannelId,
  currentChannelName,
  currentChannelLogo,
  currentStreamUrl,
}: {
  tvId: string;
  slot: number;
  displayName: string | null;
  loungeId: string;
  hasChannel: boolean;
  currentChannelId: string | null;
  currentChannelName?: string | null;
  currentChannelLogo?: string | null;
  currentStreamUrl?: string | null;
}) {
  const start = useServerFn(startLoungeStream);
  const stop = useServerFn(stopLoungeStream);
  const switchCh = useServerFn(switchChannel);
  const fetchHealth = useServerFn(getStreamHealth);
  const viewerCount = useLoungePresence(loungeId);

  const [session, setSession] = useState<SessionRow | null>(null);
  const [busy, setBusy] = useState<"start" | "stop" | "switch" | null>(null);
  const [lastLatency, setLastLatency] = useState<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  // Ref guard: blocks re-entry even if two clicks fire before React re-renders
  // the disabled state. State drives UI; ref drives correctness.
  const inFlightRef = useRef(false);

  // Initial + poll for latency, and realtime for status flips.
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const h = await fetchHealth({ data: { tvId } });
        if (cancelled) return;
        setSession(
          h.session
            ? {
                status: h.session.status,
                channel_id: h.session.channelId,
                started_at: h.session.startedAt,
                last_playlist_fetch_at: h.session.lastPlaylistFetchAt,
                last_error: h.session.lastError,
              }
            : null,
        );
        setLastLatency(h.recent[0]?.latencyMs ?? null);
      } catch {
        /* noop */
      }
    }
    void refresh();
    const t = setInterval(refresh, 8000);

    const channel = supabase
      .channel(`tv-stream-${tvId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tv_stream_sessions",
          filter: `tv_id=eq.${tvId}`,
        },
        (payload) => {
          const row = payload.new as SessionRow | null;
          if (row) setSession(row);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      clearInterval(t);
      void supabase.removeChannel(channel);
    };
  }, [tvId, fetchHealth]);

  const status = session?.status ?? "stopped";
  const badge =
    status === "live"
      ? "bg-success/15 text-success"
      : status === "error"
        ? "bg-destructive/15 text-destructive"
        : status === "starting"
          ? "bg-warning/15 text-warning"
          : "bg-arena-panel-2 text-muted-foreground";

  /**
   * Turn any server-fn failure into a helpful toast. Unauthenticated /
   * expired-session errors surface as a "Sign in again" prompt instead of
   * the raw "No authorization header provided" wire message.
   */
  function reportError(fallback: string, e: unknown) {
    const msg = e instanceof Error ? e.message : String(e ?? fallback);
    if (/unauthor(ized|ised)|no authorization header|invalid token/i.test(msg)) {
      toast.error("Your session expired — please sign in again", {
        action: {
          label: "Sign in",
          onClick: () => {
            window.location.href = `/auth?redirect=${encodeURIComponent(window.location.pathname)}`;
          },
        },
      });
      return;
    }
    toast.error(`${fallback}: ${msg}`);
  }

  async function onStart() {
    if (inFlightRef.current) return;
    if (!hasChannel) {
      toast.error("Save a channel first, then start the stream");
      return;
    }
    inFlightRef.current = true;
    setBusy("start");
    try {
      await start({ data: { tvId } });
      toast.success("Stream started — viewers can watch now");
    } catch (e) {
      reportError("Could not start", e);
    } finally {
      setBusy(null);
      inFlightRef.current = false;
    }
  }
  /**
   * Start (or reuse) the shared session for THIS TV only, then open the
   * admin preview dialog with the custom HLS player pointed at this
   * screen's signed playlist. No other TV in the lounge is affected.
   */
  async function onStartOnThisTv() {
    if (inFlightRef.current) return;
    if (!hasChannel) {
      toast.error("Save a channel first, then start the stream");
      return;
    }
    inFlightRef.current = true;
    setBusy("start");
    try {
      if (status !== "live" && status !== "starting") {
        await start({ data: { tvId } });
      }
      setPreviewOpen(true);
      toast.success(`Playing on TV ${slot}${displayName ? ` — ${displayName}` : ""}`);
    } catch (e) {
      reportError("Could not start on this TV", e);
    } finally {
      setBusy(null);
      inFlightRef.current = false;
    }
  }
  async function onSwitch() {
    if (inFlightRef.current) return;
    if (!currentChannelId) return;
    inFlightRef.current = true;
    setBusy("switch");
    try {
      await switchCh({
        data: {
          tvId,
          channelId: currentChannelId,
          channelName: currentChannelName ?? undefined,
          channelLogo: currentChannelLogo ?? undefined,
          streamUrl: currentStreamUrl ?? undefined,
        },
      });
      toast.success(`Switched to ${currentChannelName ?? currentChannelId}`);
    } catch (e) {
      reportError("Could not switch channel", e);
    } finally {
      setBusy(null);
      inFlightRef.current = false;
    }
  }

  const channelDrift =
    !!currentChannelId &&
    !!session &&
    session.status !== "stopped" &&
    session.channel_id !== currentChannelId;

  async function onStop() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy("stop");
    try {
      await stop({ data: { tvId } });
      toast.success("Stream stopped");
    } catch (e) {
      reportError("Could not stop", e);
    } finally {
      setBusy(null);
      inFlightRef.current = false;
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-arena-border bg-arena-panel-2/40 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-xs font-bold uppercase tracking-wider text-white/80">
          Shared Stream Session
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1 rounded-full bg-arena-panel-2 px-2 py-0.5 text-[11px] font-semibold text-white/80"
            title="Live viewers in this lounge"
          >
            <Users className="h-3 w-3" />
            {viewerCount ?? "—"}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${badge}`}
          >
            <Activity className="h-3 w-3" /> {status}
          </span>
        </div>
      </div>

      <div className="grid gap-1 text-xs text-muted-foreground">
        <div>
          Channel: <span className="text-white/80">{session?.channel_id ?? "—"}</span>
        </div>
        <div>
          Last upstream poll:{" "}
          <span className="text-white/80">
            {session?.last_playlist_fetch_at
              ? new Date(session.last_playlist_fetch_at).toLocaleTimeString()
              : "—"}
          </span>
          {lastLatency != null && <span className="ml-2 text-white/60">({lastLatency} ms)</span>}
        </div>
        {session?.last_error && (
          <div className="text-destructive">Last error: {session.last_error}</div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy !== null || status === "live" || status === "starting"}
          onClick={onStart}
          aria-busy={busy === "start"}
        >
          {busy === "start" ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="mr-1 h-3.5 w-3.5" />
          )}
          {busy === "start" ? "Working…" : "Start stream"}
        </Button>
        <Button
          size="sm"
          variant="arenaOutline"
          disabled={busy !== null || !hasChannel}
          onClick={onStartOnThisTv}
          aria-busy={busy === "start" && previewOpen === false}
          data-testid="tv-start-on-this-tv"
          title={`Launch playback on TV ${slot} only, using the custom player`}
        >
          <MonitorPlay className="mr-1 h-3.5 w-3.5" />
          Start on this TV
        </Button>
        <Button
          size="sm"
          variant="arenaOutline"
          disabled={busy !== null || status === "stopped"}
          onClick={onStop}
          aria-busy={busy === "stop"}
        >
          {busy === "stop" ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Square className="mr-1 h-3.5 w-3.5" />
          )}
          {busy === "stop" ? "Working…" : "Stop stream"}
        </Button>
        {channelDrift && (
          <Button
            size="sm"
            variant="arenaOutline"
            disabled={busy !== null}
            onClick={onSwitch}
            aria-busy={busy === "switch"}
            title={`Session is on ${session?.channel_id ?? "—"}; TV is set to ${currentChannelName ?? currentChannelId}`}
          >
            {busy === "switch" ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
            )}
            {busy === "switch" ? "Working…" : `Switch to ${currentChannelName ?? currentChannelId}`}
          </Button>
        )}
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        Every viewer in this lounge shares one upstream IPTV session. The provider sees a single
        connection regardless of viewer count.
      </p>

      <Suspense fallback={null}>
        {previewOpen ? (
          <LazyAdminTvPreviewDialog
            open={previewOpen}
            onOpenChange={setPreviewOpen}
            tvId={tvId}
            slot={slot}
            displayName={displayName}
            channelName={currentChannelName ?? null}
          />
        ) : null}
      </Suspense>
    </div>
  );
}
