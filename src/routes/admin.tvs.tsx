import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Tv,
  Search,
  PlayCircle,
  Loader2,
  Radio,
  Signal,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Link2Off,
  KeyRound,
  ListX,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  useLounges,
  useTvsForLounge,
  useUpsertTv,
  useUpdateLoungeMatch,
  useSwapTvSlots,
  type Tv as TvRow,
  type Lounge,
  type LoungeMatchInput,
} from "@/lib/admin-queries";
import {
  GlobalIptvChannelPicker as IptvChannelPicker,
  type PickedChannel,
} from "@/components/GlobalIptvChannelPicker";
import { XtreamChannelPicker, type XtreamPicked } from "@/components/XtreamChannelPicker";
import { StreamPreviewDialog } from "@/components/StreamPreviewDialog";
import { AdminEmptyBlock, AdminLoadingBlock } from "@/components/admin/AdminStates";
import { StreamControl } from "@/components/admin/StreamControl";
import { testIptvConnection } from "@/lib/iptv-admin.functions";
import { Building2 } from "lucide-react";

type ConnType = "xtream" | "m3u" | "hls";

export const Route = createFileRoute("/admin/tvs")({
  component: AdminTvsPage,
});

const SLOTS = [1, 2, 3, 4] as const;

const httpUrl = z
  .string()
  .trim()
  .url({ message: "Must be a valid URL" })
  .refine((v) => /^https?:\/\//i.test(v), {
    message: "URL must start with http:// or https://",
  })
  .refine((v) => v.length <= 2048, { message: "URL is too long (max 2048)" });

const tvFormSchema = z
  .object({
    display_name: z.string().trim().max(80, "Max 80 characters").optional().or(z.literal("")),
    selected_channel_id: z
      .string()
      .trim()
      .max(120, "Channel id too long (max 120)")
      .regex(/^[A-Za-z0-9._-]*$/, "Only letters, numbers, '.', '_' and '-' allowed")
      .optional()
      .or(z.literal("")),
    selected_channel_name: z
      .string()
      .trim()
      .max(120, "Channel name too long (max 120)")
      .optional()
      .or(z.literal("")),
    selected_channel_logo: z
      .string()
      .trim()
      .max(2048, "Logo URL too long")
      .optional()
      .or(z.literal("")),
    current_stream_url: z.string().trim().optional().or(z.literal("")),
  })
  .superRefine((val, ctx) => {
    if (val.selected_channel_logo) {
      const r = httpUrl.safeParse(val.selected_channel_logo);
      if (!r.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["selected_channel_logo"],
          message: r.error.issues[0]?.message ?? "Invalid logo URL",
        });
      }
    }
    if (val.current_stream_url) {
      const r = httpUrl.safeParse(val.current_stream_url);
      if (!r.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["current_stream_url"],
          message: r.error.issues[0]?.message ?? "Invalid stream URL",
        });
      }
    }
    // Cross-field: name/logo/stream only make sense when a channel id is set.
    const hasAny =
      !!val.selected_channel_name || !!val.selected_channel_logo || !!val.current_stream_url;
    if (hasAny && !val.selected_channel_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selected_channel_id"],
        message: "Pick a channel (id required) before setting name, logo, or stream URL",
      });
    }
  });

type TvFormErrors = Partial<
  Record<
    | "display_name"
    | "selected_channel_id"
    | "selected_channel_name"
    | "selected_channel_logo"
    | "current_stream_url",
    string
  >
>;

function AdminTvsPage() {
  const { data: lounges = [] } = useLounges();
  const [loungeId, setLoungeId] = useState<string | null>(null);

  useEffect(() => {
    if (!loungeId && lounges.length) setLoungeId(lounges[0].id);
  }, [lounges, loungeId]);

  const { data: tvs = [], isLoading } = useTvsForLounge(loungeId);
  const activeLounge = lounges.find((l) => l.id === loungeId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-bold">
          TVs & IPTV — {activeLounge?.name ?? "Select a lounge"}
        </h2>
        <select
          value={loungeId ?? ""}
          onChange={(e) => setLoungeId(e.target.value)}
          className="rounded-md border border-arena-border bg-arena-panel-2/60 px-3 py-1.5 text-sm"
        >
          {lounges.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
          {lounges.length === 0 && <option value="">No lounges yet</option>}
        </select>
      </div>

      {!loungeId ? (
        <div className="arena-card rounded-xl">
          <AdminEmptyBlock
            icon={Building2}
            title="No lounge selected"
            description="Create a lounge first, then configure its TVs here."
          />
        </div>
      ) : isLoading ? (
        <div className="arena-card rounded-xl">
          <AdminLoadingBlock label="Loading TVs…" />
        </div>
      ) : (
        <>
          {activeLounge && <LoungeMatchCard lounge={activeLounge} />}
          <div className="grid gap-4 lg:grid-cols-2">
            {SLOTS.map((slot) => {
              const existing = tvs.find((t) => t.slot === slot);
              const slotOptions = SLOTS.map((s) => {
                const t = tvs.find((tv) => tv.slot === s);
                return {
                  slot: s,
                  label: t?.display_name?.trim() ? t.display_name : `TV ${s}`,
                  id: t?.id ?? null,
                };
              });
              return (
                <TvConfigCard
                  key={slot}
                  loungeId={loungeId}
                  slot={slot}
                  tv={existing}
                  slotOptions={slotOptions}
                  totalSlots={SLOTS.length}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function TvConfigCard({
  loungeId,
  slot,
  tv,
  slotOptions,
  totalSlots,
}: {
  loungeId: string;
  slot: number;
  tv?: TvRow;
  slotOptions: { slot: number; label: string; id: string | null }[];
  totalSlots: number;
}) {
  const upsert = useUpsertTv();
  const swap = useSwapTvSlots();
  const runTest = useServerFn(testIptvConnection);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [xtreamPickerOpen, setXtreamPickerOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    code: "ok" | "invalid_url" | "unreachable" | "auth_failed" | "no_channels" | "upstream_error";
    headline: string;
    detail: string;
    channelCount?: number;
  } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [errors, setErrors] = useState<TvFormErrors>({});
  // Ref-based lock — synchronous, so rapid repeat clicks or Enter presses that
  // fire before React re-renders `upsert.isPending` are still ignored.
  const savingRef = useRef(false);
  const [form, setForm] = useState({
    display_name: tv?.display_name ?? "",
    provider_name: tv?.provider_name ?? "",
    server_url: tv?.server_url ?? "",
    username: tv?.username ?? "",
    password: tv?.password ?? "",
    connection_type: (tv?.connection_type as ConnType | null) ?? "xtream",
    selected_channel_id: tv?.selected_channel_id ?? "",
    selected_channel_name: tv?.selected_channel_name ?? "",
    selected_channel_logo: tv?.selected_channel_logo ?? "",
    current_stream_url: tv?.current_stream_url ?? "",
    enabled: tv?.enabled ?? true,
    // Match & scoreboard (admin-editable, streamed live to every viewer)
    sport: tv?.sport ?? "",
    matchup: tv?.matchup ?? "",
    home_label: tv?.home_label ?? "",
    away_label: tv?.away_label ?? "",
    home_score: tv?.home_score ?? 0,
    away_score: tv?.away_score ?? 0,
    period_label: tv?.period_label ?? "",
    clock_label: tv?.clock_label ?? "",
    accent_home: tv?.accent_home ?? "",
    accent_away: tv?.accent_away ?? "",
  });

  useEffect(() => {
    setForm({
      display_name: tv?.display_name ?? "",
      provider_name: tv?.provider_name ?? "",
      server_url: tv?.server_url ?? "",
      username: tv?.username ?? "",
      password: tv?.password ?? "",
      connection_type: (tv?.connection_type as ConnType | null) ?? "xtream",
      selected_channel_id: tv?.selected_channel_id ?? "",
      selected_channel_name: tv?.selected_channel_name ?? "",
      selected_channel_logo: tv?.selected_channel_logo ?? "",
      current_stream_url: tv?.current_stream_url ?? "",
      enabled: tv?.enabled ?? true,
      sport: tv?.sport ?? "",
      matchup: tv?.matchup ?? "",
      home_label: tv?.home_label ?? "",
      away_label: tv?.away_label ?? "",
      home_score: tv?.home_score ?? 0,
      away_score: tv?.away_score ?? 0,
      period_label: tv?.period_label ?? "",
      clock_label: tv?.clock_label ?? "",
      accent_home: tv?.accent_home ?? "",
      accent_away: tv?.accent_away ?? "",
    });
  }, [tv?.id]);

  // Live-validate whenever the validated fields change so inline errors clear.
  const liveErrors = useMemo<TvFormErrors>(() => {
    const parsed = tvFormSchema.safeParse(form);
    if (parsed.success) return {};
    const next: TvFormErrors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof TvFormErrors | undefined;
      if (key && !next[key]) next[key] = issue.message;
    }
    return next;
  }, [
    form.display_name,
    form.selected_channel_id,
    form.selected_channel_name,
    form.selected_channel_logo,
    form.current_stream_url,
  ]);

  // Only show an error inline once the user has attempted a save (errors state)
  // OR the field currently has a value that fails validation.
  const shownErrors: TvFormErrors = { ...liveErrors, ...errors };

  function applyPickedChannel(ch: PickedChannel) {
    setForm((f) => ({
      ...f,
      provider_name: "Global IPTV",
      connection_type: ch.streamUrl ? "hls" : "xtream",
      selected_channel_id: ch.id,
      selected_channel_name: ch.name,
      selected_channel_logo: ch.logo ?? "",
      current_stream_url: ch.streamUrl ?? "",
    }));
    toast.success(`Selected ${ch.name}`);
  }

  function applyXtreamPick(ch: XtreamPicked) {
    setForm((f) => ({
      ...f,
      provider_name: f.provider_name || "Xtream",
      connection_type: "xtream",
      selected_channel_id: ch.id,
      selected_channel_name: ch.name,
      selected_channel_logo: ch.logo,
      // Stream URL is derived server-side from creds + id; clear any old override.
      current_stream_url: "",
    }));
    toast.success(`Selected ${ch.name}`);
  }

  const CODE_HEADLINE: Record<
    "ok" | "invalid_url" | "unreachable" | "auth_failed" | "no_channels" | "upstream_error",
    string
  > = {
    ok: "Connection OK",
    invalid_url: "Server URL is invalid",
    unreachable: "Cannot reach the IPTV server",
    auth_failed: "Username or password rejected",
    no_channels: "Subscription has no live channels",
    upstream_error: "Provider returned an unexpected error",
  };

  async function handleTest() {
    if (testing) return;
    if (!form.server_url) {
      setTestResult({
        ok: false,
        code: "invalid_url",
        headline: CODE_HEADLINE.invalid_url,
        detail: "Enter the Server URL first (e.g. http://cf.8knn.xyz).",
      });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await runTest({
        data: {
          server_url: form.server_url,
          username: form.username || null,
          password: form.password || null,
          connection_type: form.connection_type === "m3u" ? "m3u" : "xtream",
        },
      });
      setTestResult({
        ok: res.ok,
        code: res.code,
        headline: CODE_HEADLINE[res.code] ?? (res.ok ? "Connection OK" : "Connection failed"),
        detail: res.message,
        channelCount: res.channelCount,
      });
      if (res.ok) {
        toast.success(CODE_HEADLINE[res.code], { description: res.message });
      } else {
        toast.error(CODE_HEADLINE[res.code] ?? "Connection failed", {
          description: res.message,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Test failed";
      setTestResult({
        ok: false,
        code: "upstream_error",
        headline: "Test request failed",
        detail: msg,
      });
      toast.error("Test request failed", { description: msg });
    } finally {
      setTesting(false);
    }
  }

  // Clear stale test results when the credentials the test would validate
  // change — otherwise a green "OK" would linger next to freshly-edited
  // credentials the admin hasn't re-verified.
  useEffect(() => {
    setTestResult(null);
  }, [form.server_url, form.username, form.password, form.connection_type]);

  async function save() {
    // Block re-entrancy — repeated clicks / Enter presses while a save is in
    // flight are ignored entirely.
    if (savingRef.current || upsert.isPending) return;
    savingRef.current = true;

    const previousForm = form;
    const previousTv = tv;

    // Client-side validation gate.
    const parsed = tvFormSchema.safeParse(form);
    if (!parsed.success) {
      const next: TvFormErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof TvFormErrors | undefined;
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      toast.error(`TV ${slot} — please fix the highlighted fields`, {
        description: Object.entries(next)
          .map(([k, v]) => `• ${k}: ${v}`)
          .join("\n"),
      });
      savingRef.current = false;
      return;
    }
    setErrors({});

    try {
      const connType: ConnType = form.connection_type ?? "xtream";
      const saved = await upsert.mutateAsync({
        id: tv?.id,
        lounge_id: loungeId,
        slot,
        display_name: form.display_name || `TV ${slot}`,
        provider_name: form.provider_name || null,
        server_url: form.server_url || null,
        username: form.username || null,
        password: form.password || null,
        selected_channel_id: form.selected_channel_id || null,
        selected_channel_name: form.selected_channel_name || null,
        selected_channel_logo: form.selected_channel_logo || null,
        current_stream_url: form.current_stream_url || null,
        enabled: form.enabled,
        connection_type: connType,
        sport: form.sport || null,
        matchup: form.matchup || null,
        home_label: form.home_label || null,
        away_label: form.away_label || null,
        home_score: Number(form.home_score) || 0,
        away_score: Number(form.away_score) || 0,
        period_label: form.period_label || null,
        clock_label: form.clock_label || null,
        accent_home: form.accent_home || null,
        accent_away: form.accent_away || null,
      });

      const channelName = saved?.selected_channel_name ?? form.selected_channel_name;
      const channelId = saved?.selected_channel_id ?? form.selected_channel_id;
      const streamUrl = saved?.current_stream_url ?? form.current_stream_url;
      const logo = saved?.selected_channel_logo ?? form.selected_channel_logo;
      const persistedType = saved?.connection_type ?? connType;

      if (channelId) {
        const truncatedUrl =
          streamUrl && streamUrl.length > 60 ? `${streamUrl.slice(0, 57)}…` : streamUrl || "—";
        toast.success(`TV ${slot} saved — channel persisted`, {
          description: [
            `Channel: ${channelName || channelId} (${channelId})`,
            `Connection: ${persistedType}`,
            `Logo: ${logo ? "✓ saved" : "— none"}`,
            `Stream URL: ${truncatedUrl}`,
          ].join("\n"),
        });
      } else {
        toast.success(`TV ${slot} saved`, {
          description: "No IPTV channel selected for this slot.",
        });
      }
    } catch (e) {
      // Roll form back to the last known-good values so the UI reflects what
      // is actually stored in the database.
      setForm({
        display_name: previousTv?.display_name ?? previousForm.display_name,
        provider_name: previousTv?.provider_name ?? previousForm.provider_name,
        server_url: previousTv?.server_url ?? previousForm.server_url,
        username: previousTv?.username ?? previousForm.username,
        password: previousTv?.password ?? previousForm.password,
        connection_type:
          (previousTv?.connection_type as ConnType | null) ?? previousForm.connection_type,
        selected_channel_id: previousTv?.selected_channel_id ?? previousForm.selected_channel_id,
        selected_channel_name:
          previousTv?.selected_channel_name ?? previousForm.selected_channel_name,
        selected_channel_logo:
          previousTv?.selected_channel_logo ?? previousForm.selected_channel_logo,
        current_stream_url: previousTv?.current_stream_url ?? previousForm.current_stream_url,
        enabled: previousTv?.enabled ?? previousForm.enabled,
        sport: previousTv?.sport ?? previousForm.sport,
        matchup: previousTv?.matchup ?? previousForm.matchup,
        home_label: previousTv?.home_label ?? previousForm.home_label,
        away_label: previousTv?.away_label ?? previousForm.away_label,
        home_score: previousTv?.home_score ?? previousForm.home_score,
        away_score: previousTv?.away_score ?? previousForm.away_score,
        period_label: previousTv?.period_label ?? previousForm.period_label,
        clock_label: previousTv?.clock_label ?? previousForm.clock_label,
        accent_home: previousTv?.accent_home ?? previousForm.accent_home,
        accent_away: previousTv?.accent_away ?? previousForm.accent_away,
      });

      const err = e as { message?: string; code?: string; details?: string; hint?: string } | Error;
      const message = (err as { message?: string }).message ?? "Unknown error while saving";
      const code = (err as { code?: string }).code;
      const details = (err as { details?: string }).details;
      const hint = (err as { hint?: string }).hint;

      const descriptionLines = [
        code ? `Code: ${code}` : null,
        details ? `Details: ${details}` : null,
        hint ? `Hint: ${hint}` : null,
        previousTv
          ? "Form reverted to the last saved values."
          : "No previous saved values — form left unchanged.",
      ].filter(Boolean) as string[];

      toast.error(`TV ${slot} save failed — ${message}`, {
        description: descriptionLines.join("\n"),
        duration: 8000,
      });
    } finally {
      savingRef.current = false;
    }
  }

  const status = tv?.status ?? "unconfigured";
  const statusColors: Record<string, string> = {
    online: "bg-success/15 text-success",
    unconfigured: "bg-arena-panel-2 text-muted-foreground",
    error: "bg-destructive/15 text-destructive",
    testing: "bg-warning/15 text-warning",
  };

  return (
    <div
      id={`tv-slot-${slot}`}
      className="arena-card rounded-xl p-5"
      onKeyDown={(e) => {
        // Swallow Enter inside inputs so it can't retrigger save while one is
        // already in flight; a fresh Enter still goes through save() which
        // has its own re-entrancy guard.
        if (e.key === "Enter" && (savingRef.current || upsert.isPending)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Tv className="h-4 w-4" />
          </div>
          <div>
            <div className="font-display text-base font-bold">
              TV {slot}
              {form.display_name && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {form.display_name}
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">IPTV configuration</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Move up"
              title="Move up (swap with previous slot)"
              disabled={slot <= 1 || swap.isPending}
              onClick={() =>
                swap.mutate(
                  { loungeId, slotA: slot, slotB: slot - 1 },
                  {
                    onSuccess: () => toast.success(`Swapped TV ${slot} ↔ TV ${slot - 1}`),
                    onError: (e) => toast.error(`Reorder failed — ${(e as Error).message}`),
                  },
                )
              }
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-arena-border bg-arena-panel-2/60 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Move down"
              title="Move down (swap with next slot)"
              disabled={slot >= totalSlots || swap.isPending}
              onClick={() =>
                swap.mutate(
                  { loungeId, slotA: slot, slotB: slot + 1 },
                  {
                    onSuccess: () => toast.success(`Swapped TV ${slot} ↔ TV ${slot + 1}`),
                    onError: (e) => toast.error(`Reorder failed — ${(e as Error).message}`),
                  },
                )
              }
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-arena-border bg-arena-panel-2/60 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
          </div>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${statusColors[status] ?? statusColors.unconfigured}`}
          >
            ● {status}
          </span>
        </div>
      </div>

      <div className="grid gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Swap with another TV Screen
          </span>
          <select
            value={slot}
            onChange={(e) => {
              const nextSlot = Number(e.target.value);
              if (nextSlot === slot) return;
              swap.mutate(
                { loungeId, slotA: slot, slotB: nextSlot },
                {
                  onSuccess: () => toast.success(`Swapped TV ${slot} ↔ TV ${nextSlot}`),
                  onError: (err) => toast.error(`Reorder failed — ${(err as Error).message}`),
                },
              );
            }}
            disabled={swap.isPending}
            className="w-full rounded-md border border-arena-border bg-arena-panel-2/60 px-3 py-2 text-sm disabled:opacity-60"
            data-testid="tv-screen-selector"
            aria-label="Swap this slot with another TV screen"
          >
            {slotOptions.map((opt) => (
              <option key={opt.slot} value={opt.slot}>
                TV {opt.slot} — {opt.label}
                {opt.id ? "" : " (unconfigured)"}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] text-muted-foreground">
            Screen ID: <span className="font-mono">{tv?.id ?? "not yet saved"}</span>
          </span>
        </label>
        <Field
          label="Display Name"
          value={form.display_name}
          onChange={(v) => setForm({ ...form, display_name: v })}
          placeholder={`TV ${slot}`}
          error={shownErrors.display_name}
          maxLength={80}
        />
        <Field
          label="Provider Name"
          value={form.provider_name}
          onChange={(v) => setForm({ ...form, provider_name: v })}
          placeholder="e.g. FlickyTV"
        />
        <Field
          label="Server URL"
          value={form.server_url}
          onChange={(v) => setForm({ ...form, server_url: v })}
          placeholder="http://server.example:8080"
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Username"
            value={form.username}
            onChange={(v) => setForm({ ...form, username: v })}
            placeholder="user"
          />
          <Field
            label="Password"
            type="password"
            value={form.password}
            onChange={(v) => setForm({ ...form, password: v })}
            placeholder="••••••••"
          />
        </div>
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Connection type
            </span>
            <select
              value={form.connection_type}
              onChange={(e) => setForm({ ...form, connection_type: e.target.value as ConnType })}
              className="w-full rounded-md border border-arena-border bg-arena-panel-2/60 px-3 py-2 text-sm"
              data-testid="tv-connection-type"
            >
              <option value="xtream">Xtream Codes (user + pass)</option>
              <option value="m3u">M3U playlist</option>
              <option value="hls">Direct HLS URL</option>
            </select>
          </label>
          <Button
            size="sm"
            variant="arenaOutline"
            onClick={handleTest}
            disabled={testing || !form.server_url}
            aria-busy={testing}
            data-testid={form.connection_type === "m3u" ? "tv-test-m3u" : "tv-test-connection"}
            title={
              form.connection_type === "m3u"
                ? "Fetch the M3U playlist and report success or the exact failure reason"
                : "Test the IPTV credentials against the provider"
            }
          >
            {testing ? (
              <>
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />{" "}
                {form.connection_type === "m3u" ? "Testing M3U…" : "Testing…"}
              </>
            ) : (
              <>
                <Signal className="mr-1 h-3.5 w-3.5" />{" "}
                {form.connection_type === "m3u" ? "Test M3U URL" : "Test connection"}
              </>
            )}
          </Button>
        </div>
        {testResult &&
          (() => {
            const Icon =
              testResult.code === "ok"
                ? CheckCircle2
                : testResult.code === "invalid_url"
                  ? AlertTriangle
                  : testResult.code === "unreachable"
                    ? Link2Off
                    : testResult.code === "auth_failed"
                      ? KeyRound
                      : testResult.code === "no_channels"
                        ? ListX
                        : XCircle;
            const tone = testResult.ok
              ? "border-success/40 bg-success/10 text-success"
              : testResult.code === "no_channels"
                ? "border-warning/40 bg-warning/10 text-warning"
                : "border-destructive/40 bg-destructive/10 text-destructive";
            const hint =
              testResult.code === "invalid_url"
                ? "Check the Server URL — it must start with http:// or https:// and include the host/port."
                : testResult.code === "unreachable"
                  ? "The server didn't respond. Check the URL, port, and whether the provider is online."
                  : testResult.code === "auth_failed"
                    ? "The provider rejected the credentials. Double-check the username and password."
                    : testResult.code === "no_channels"
                      ? "Credentials are valid, but this subscription exposes no live channels."
                      : testResult.code === "upstream_error"
                        ? "The provider returned an unexpected response. Try again or contact the provider."
                        : null;
            return (
              <div
                role="status"
                aria-live="polite"
                data-testid="tv-test-result"
                data-code={testResult.code}
                className={`flex items-start gap-2 rounded-md border p-3 text-xs ${tone}`}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{testResult.headline}</div>
                  <div className="mt-0.5 break-words text-[11px] opacity-90">
                    {testResult.detail}
                  </div>
                  {hint && <div className="mt-1 text-[11px] opacity-80">{hint}</div>}
                  {typeof testResult.channelCount === "number" && (
                    <div className="mt-1 text-[11px] opacity-80">
                      Live channels detected: {testResult.channelCount}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        {tv?.id && form.connection_type !== "hls" && (
          <Button
            size="sm"
            variant="arenaOutline"
            onClick={() => setXtreamPickerOpen(true)}
            data-testid="tv-browse-provider"
          >
            <Radio className="mr-1 h-3.5 w-3.5" /> Browse channels from provider
          </Button>
        )}
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Selected Channel
          </div>
          <div
            className={`flex items-center gap-3 rounded-md border bg-arena-panel-2/60 p-2 ${
              shownErrors.selected_channel_id ||
              shownErrors.selected_channel_name ||
              shownErrors.selected_channel_logo
                ? "border-destructive"
                : "border-arena-border"
            }`}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-arena-panel-2">
              {form.selected_channel_logo ? (
                <img
                  src={form.selected_channel_logo}
                  alt=""
                  className="h-full w-full object-contain"
                  onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
                />
              ) : (
                <Tv className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {form.selected_channel_name || "No channel selected"}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {form.selected_channel_id
                  ? `${form.selected_channel_id}${form.current_stream_url ? " · stream ready" : " · no stream"}`
                  : "Pick from the global provider or type an Xtream channel below"}
              </div>
            </div>
            <Button size="sm" variant="arenaOutline" onClick={() => setPickerOpen(true)}>
              <Search className="mr-1 h-3.5 w-3.5" /> Browse
            </Button>
          </div>
          {(shownErrors.selected_channel_id ||
            shownErrors.selected_channel_name ||
            shownErrors.selected_channel_logo) && (
            <ul className="mt-1 space-y-0.5 text-xs text-destructive">
              {shownErrors.selected_channel_id && <li>{shownErrors.selected_channel_id}</li>}
              {shownErrors.selected_channel_name && <li>{shownErrors.selected_channel_name}</li>}
              {shownErrors.selected_channel_logo && <li>{shownErrors.selected_channel_logo}</li>}
            </ul>
          )}
        </div>
        <Field
          label="Stream URL (optional override)"
          value={form.current_stream_url}
          onChange={(v) => setForm({ ...form, current_stream_url: v })}
          placeholder="https://…/index.m3u8"
          error={shownErrors.current_stream_url}
          maxLength={2048}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          />
          Enabled
        </label>

        {/* --- Match & Scoreboard (streams live to viewers via realtime) --- */}
        <div className="mt-2 rounded-lg border border-arena-border bg-arena-panel-2/40 p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-wider text-white/80">
              Match & Scoreboard
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Live to viewers on save
            </div>
          </div>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Sport (e.g. NBA)"
                value={form.sport}
                onChange={(v) => setForm({ ...form, sport: v })}
                placeholder="NBA"
                maxLength={40}
              />
              <Field
                label="Matchup"
                value={form.matchup}
                onChange={(v) => setForm({ ...form, matchup: v })}
                placeholder="Lakers vs Celtics"
                maxLength={120}
              />
            </div>
            <div className="grid grid-cols-4 gap-3">
              <Field
                label="Home code"
                value={form.home_label}
                onChange={(v) => setForm({ ...form, home_label: v.toUpperCase() })}
                placeholder="LAL"
                maxLength={6}
              />
              <Field
                label="Home score"
                type="number"
                value={String(form.home_score)}
                onChange={(v) => setForm({ ...form, home_score: Number(v) || 0 })}
                placeholder="0"
              />
              <Field
                label="Away code"
                value={form.away_label}
                onChange={(v) => setForm({ ...form, away_label: v.toUpperCase() })}
                placeholder="BOS"
                maxLength={6}
              />
              <Field
                label="Away score"
                type="number"
                value={String(form.away_score)}
                onChange={(v) => setForm({ ...form, away_score: Number(v) || 0 })}
                placeholder="0"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Period"
                value={form.period_label}
                onChange={(v) => setForm({ ...form, period_label: v })}
                placeholder="4TH · ROUND 2 · 78'"
                maxLength={24}
              />
              <Field
                label="Clock"
                value={form.clock_label}
                onChange={(v) => setForm({ ...form, clock_label: v })}
                placeholder="6:32"
                maxLength={16}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Home accent (CSS color)"
                value={form.accent_home}
                onChange={(v) => setForm({ ...form, accent_home: v })}
                placeholder="oklch(0.5 0.2 290)"
                maxLength={40}
              />
              <Field
                label="Away accent (CSS color)"
                value={form.accent_away}
                onChange={(v) => setForm({ ...form, accent_away: v })}
                placeholder="#008000"
                maxLength={40}
              />
            </div>
          </div>
        </div>
      </div>

      {tv?.id && (
        <StreamControl
          tvId={tv.id}
          slot={slot}
          displayName={form.display_name || tv.display_name || null}
          loungeId={loungeId}
          hasChannel={!!form.selected_channel_id}
          currentChannelId={form.selected_channel_id || null}
          currentChannelName={form.selected_channel_name || null}
          currentChannelLogo={form.selected_channel_logo || null}
          currentStreamUrl={form.current_stream_url || null}
        />
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" variant="arenaOutline" onClick={() => setPickerOpen(true)}>
          <Search className="mr-1 h-3.5 w-3.5" /> Pick channel
        </Button>
        <Button
          size="sm"
          variant="arenaOutline"
          onClick={() => {
            if (!form.current_stream_url) {
              toast.error("Set a stream URL first");
              return;
            }
            setPreviewOpen(true);
          }}
          disabled={!form.current_stream_url}
        >
          <PlayCircle className="mr-1 h-3.5 w-3.5" /> Preview
        </Button>
        <Button
          size="sm"
          onClick={save}
          disabled={upsert.isPending || Object.keys(liveErrors).length > 0}
          aria-busy={upsert.isPending}
        >
          {upsert.isPending ? (
            <>
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Saving…
            </>
          ) : (
            "Save"
          )}
        </Button>
      </div>

      <IptvChannelPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={applyPickedChannel}
      />
      <XtreamChannelPicker
        open={xtreamPickerOpen}
        onOpenChange={setXtreamPickerOpen}
        tvId={tv?.id ?? null}
        onPick={applyXtreamPick}
      />
      <StreamPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        url={form.current_stream_url}
        title={form.selected_channel_name || form.display_name || `TV ${slot}`}
      />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  error,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  error?: string;
  maxLength?: number;
}) {
  const invalid = !!error;
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-invalid={invalid || undefined}
        className={`w-full rounded-md border bg-arena-panel-2/60 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none ${
          invalid
            ? "border-destructive focus:border-destructive"
            : "border-arena-border focus:border-primary"
        }`}
      />
      {invalid ? <span className="mt-1 block text-xs text-destructive">{error}</span> : null}
    </label>
  );
}

// -------------------- Lounge match editor --------------------

const MATCH_STATUSES: LoungeMatchInput["match_status"][] = [
  "off",
  "scheduled",
  "live",
  "halftime",
  "final",
];

const EMPTY_MATCH: LoungeMatchInput = {
  match_title: null,
  match_sport: null,
  match_home_label: null,
  match_away_label: null,
  match_home_score: 0,
  match_away_score: 0,
  match_period_label: null,
  match_clock_label: null,
  match_thumbnail_url: null,
  match_status: "off",
  match_starts_at: null,
  match_accent_home: null,
  match_accent_away: null,
};

function loungeToMatch(l: Lounge): LoungeMatchInput {
  return {
    match_title: l.match_title ?? null,
    match_sport: l.match_sport ?? null,
    match_home_label: l.match_home_label ?? null,
    match_away_label: l.match_away_label ?? null,
    match_home_score: l.match_home_score ?? 0,
    match_away_score: l.match_away_score ?? 0,
    match_period_label: l.match_period_label ?? null,
    match_clock_label: l.match_clock_label ?? null,
    match_thumbnail_url: l.match_thumbnail_url ?? null,
    match_status: (l.match_status ?? "off") as LoungeMatchInput["match_status"],
    match_starts_at: l.match_starts_at ?? null,
    match_accent_home: l.match_accent_home ?? null,
    match_accent_away: l.match_accent_away ?? null,
  };
}

function LoungeMatchCard({ lounge }: { lounge: Lounge }) {
  const update = useUpdateLoungeMatch();
  const [form, setForm] = useState<LoungeMatchInput>(() => loungeToMatch(lounge));

  useEffect(() => {
    setForm(loungeToMatch(lounge));
  }, [lounge.id, lounge.updated_at]);

  const set = <K extends keyof LoungeMatchInput>(k: K, v: LoungeMatchInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const nullable = (v: string) => {
    const t = v.trim();
    return t.length ? t : null;
  };

  async function save() {
    const payload: LoungeMatchInput = {
      ...form,
      match_title: nullable(form.match_title ?? ""),
      match_sport: nullable(form.match_sport ?? ""),
      match_home_label: nullable(form.match_home_label ?? ""),
      match_away_label: nullable(form.match_away_label ?? ""),
      match_period_label: nullable(form.match_period_label ?? ""),
      match_clock_label: nullable(form.match_clock_label ?? ""),
      match_thumbnail_url: nullable(form.match_thumbnail_url ?? ""),
      match_accent_home: nullable(form.match_accent_home ?? ""),
      match_accent_away: nullable(form.match_accent_away ?? ""),
    };
    try {
      await update.mutateAsync({ id: lounge.id, match: payload });
      toast.success("Match saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save match");
    }
  }

  async function clearMatch() {
    try {
      await update.mutateAsync({ id: lounge.id, match: EMPTY_MATCH });
      setForm(EMPTY_MATCH);
      toast.success("Match cleared");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to clear match");
    }
  }

  const inputCls =
    "h-9 w-full rounded-md border border-arena-border bg-arena-panel-2/60 px-2 text-sm text-white placeholder:text-muted-foreground focus:border-arena-violet focus:outline-none";

  const dtLocal = form.match_starts_at
    ? new Date(form.match_starts_at).toISOString().slice(0, 16)
    : "";

  return (
    <div className="arena-card mb-4 rounded-xl border border-arena-border bg-arena-panel/80 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-base font-bold">Match details</h3>
          <p className="text-xs text-muted-foreground">
            Shown on the public Arena card for this lounge. Set status to <em>Off</em> to hide.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={clearMatch} disabled={update.isPending}>
            Clear
          </Button>
          <Button size="sm" onClick={save} disabled={update.isPending}>
            {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save match"}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground md:col-span-2 lg:col-span-2">
          Title
          <input
            className={`${inputCls} mt-1`}
            value={form.match_title ?? ""}
            onChange={(e) => set("match_title", e.target.value)}
            placeholder="e.g. Lakers vs Celtics — Game 5"
            maxLength={160}
          />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Status
          <select
            className={`${inputCls} mt-1`}
            value={form.match_status}
            onChange={(e) =>
              set("match_status", e.target.value as LoungeMatchInput["match_status"])
            }
          >
            {MATCH_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Sport
          <input
            className={`${inputCls} mt-1`}
            value={form.match_sport ?? ""}
            onChange={(e) => set("match_sport", e.target.value)}
            placeholder="Basketball"
            maxLength={40}
          />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Starts at
          <input
            type="datetime-local"
            className={`${inputCls} mt-1`}
            value={dtLocal}
            onChange={(e) =>
              set("match_starts_at", e.target.value ? new Date(e.target.value).toISOString() : null)
            }
          />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Thumbnail URL
          <input
            className={`${inputCls} mt-1`}
            value={form.match_thumbnail_url ?? ""}
            onChange={(e) => set("match_thumbnail_url", e.target.value)}
            placeholder="https://…"
            maxLength={2048}
          />
        </label>

        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Home label
          <input
            className={`${inputCls} mt-1`}
            value={form.match_home_label ?? ""}
            onChange={(e) => set("match_home_label", e.target.value)}
            placeholder="LAL"
            maxLength={40}
          />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Home score
          <input
            type="number"
            className={`${inputCls} mt-1`}
            value={form.match_home_score}
            onChange={(e) => set("match_home_score", Number(e.target.value) || 0)}
          />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Home accent
          <input
            className={`${inputCls} mt-1`}
            value={form.match_accent_home ?? ""}
            onChange={(e) => set("match_accent_home", e.target.value)}
            placeholder="#552583"
            maxLength={20}
          />
        </label>

        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Away label
          <input
            className={`${inputCls} mt-1`}
            value={form.match_away_label ?? ""}
            onChange={(e) => set("match_away_label", e.target.value)}
            placeholder="BOS"
            maxLength={40}
          />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Away score
          <input
            type="number"
            className={`${inputCls} mt-1`}
            value={form.match_away_score}
            onChange={(e) => set("match_away_score", Number(e.target.value) || 0)}
          />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Away accent
          <input
            className={`${inputCls} mt-1`}
            value={form.match_accent_away ?? ""}
            onChange={(e) => set("match_accent_away", e.target.value)}
            placeholder="#007A33"
            maxLength={20}
          />
        </label>

        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Period
          <input
            className={`${inputCls} mt-1`}
            value={form.match_period_label ?? ""}
            onChange={(e) => set("match_period_label", e.target.value)}
            placeholder="Q3"
            maxLength={20}
          />
        </label>
        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Clock
          <input
            className={`${inputCls} mt-1`}
            value={form.match_clock_label ?? ""}
            onChange={(e) => set("match_clock_label", e.target.value)}
            placeholder="4:12"
            maxLength={20}
          />
        </label>
      </div>

      {form.match_thumbnail_url ? (
        <div className="mt-3">
          <img
            src={form.match_thumbnail_url}
            alt="Match thumbnail preview"
            className="h-24 w-auto rounded-md border border-arena-border object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
