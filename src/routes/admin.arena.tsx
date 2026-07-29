import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Trophy,
  Plus,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  ImageIcon,
  Loader2,
  Search,
  LayoutGrid,
  Rows3,
  Minus,
  X,
  ChevronLeft,
  ChevronRight,
  Check,
  PlayCircle,
  CalendarClock,
} from "lucide-react";
import { z } from "zod";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { AdminEmptyBlock, AdminLoadingBlock } from "@/components/admin/AdminStates";
import { Field, ThumbnailUploader } from "@/components/admin/ThumbnailUploader";
import { SlotThumbs } from "@/components/admin/SlotThumbs";
import { slotNumbers } from "@/lib/match-slot-count";
import {
  GlobalIptvChannelPicker as IptvChannelPicker,
  type PickedChannel,
} from "@/components/GlobalIptvChannelPicker";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  listMatchesAdmin,
  upsertMatch,
  deleteMatch,
  upsertMatchSlot,
  swapMatchSlots,
} from "@/lib/matches-admin.functions";

type MatchRow = Database["public"]["Tables"]["matches"]["Row"];
type SlotRow = Database["public"]["Tables"]["match_slots"]["Row"];
type MatchStatus = MatchRow["status"];

const STATUS_OPTIONS: Array<{ value: MatchStatus; label: string }> = [
  { value: "scheduled", label: "Scheduled" },
  { value: "live", label: "Live" },
  { value: "halftime", label: "Halftime" },
  { value: "final", label: "Final" },
];

const LOCAL_TZ =
  typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" : "UTC";

const COMMON_TIMEZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Istanbul",
  "Africa/Cairo",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];
const TZ_OPTIONS = Array.from(new Set([LOCAL_TZ, ...COMMON_TIMEZONES]));

function formatWithTz(d: Date, tz?: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZoneName: "short",
      timeZone: tz,
    }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

// Convert a naive "YYYY-MM-DDTHH:mm" string interpreted as being in `tz` to a UTC Date.
function zonedInputToUtc(local: string, tz: string): Date | null {
  if (!local) return null;
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, Y, Mo, D, H, Mi] = m.map(Number) as unknown as number[];
  const asUTC = Date.UTC(Y, Mo - 1, D, H, Mi);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(asUTC));
    const p: Record<string, string> = {};
    for (const x of parts) p[x.type] = x.value;
    const asTZ = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    const offset = asTZ - asUTC;
    return new Date(asUTC - offset);
  } catch {
    return new Date(asUTC);
  }
}

// Project a UTC ISO string into a "YYYY-MM-DDTHH:mm" wall-clock string in `tz`.
function utcIsoToZonedInput(iso: string, tz: string): string {
  if (!iso) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(iso));
    const p: Record<string, string> = {};
    for (const x of parts) p[x.type] = x.value;
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  } catch {
    return new Date(iso).toISOString().slice(0, 16);
  }
}

const WIZARD_STEPS = ["basics", "score", "media", "slots"] as const;
type WizardStep = (typeof WIZARD_STEPS)[number];

const searchSchema = z.object({
  view: fallback(z.string(), "grid").default("grid"),
  q: fallback(z.string(), "").default(""),
  status: fallback(z.string(), "all").default("all"),
  active: fallback(z.string(), "all").default("all"),
  sport: fallback(z.string(), "all").default("all"),
  sort: fallback(z.string(), "order").default("order"),
  // Editor persistence: `edit` is "" (closed), "new", or a match UUID.
  // `tab` is the wizard/editor tab. Both survive refresh via the URL.
  edit: fallback(z.string(), "").default(""),
  tab: fallback(z.string(), "basics").default("basics"),
});

function isWizardStep(v: string): v is WizardStep {
  return (WIZARD_STEPS as readonly string[]).includes(v);
}

export const Route = createFileRoute("/admin/arena")({
  validateSearch: zodValidator(searchSchema),
  component: AdminArenaPage,
});

function useAdminMatches() {
  const fn = useServerFn(listMatchesAdmin);
  return useQuery({
    queryKey: ["admin", "matches"],
    queryFn: () => fn(),
  });
}

function AdminArenaPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data, isLoading } = useAdminMatches();
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState<MatchRow | null>(null);
  const deleteFn = useServerFn(deleteMatch);

  // Editor open state comes straight from the URL so a refresh restores it.
  const editorOpen = search.edit !== "";
  const editingId = search.edit && search.edit !== "new" ? search.edit : null;
  const activeTab: WizardStep = isWizardStep(search.tab) ? search.tab : "basics";

  const matches = data?.matches ?? [];
  const slotsByMatch = useMemo(() => {
    const map = new Map<string, SlotRow[]>();
    for (const s of data?.slots ?? []) {
      const arr = map.get(s.match_id) ?? [];
      arr.push(s);
      map.set(s.match_id, arr);
    }
    return map;
  }, [data?.slots]);

  const editing = useMemo(
    () => matches.find((m) => m.id === editingId) ?? null,

    [matches, editingId],
  );

  const sportOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of matches) if (m.sport) set.add(m.sport);
    return Array.from(set).sort();
  }, [matches]);

  const filtered = useMemo(() => {
    const q = search.q.trim().toLowerCase();
    let list = matches.filter((m) => {
      if (q) {
        const hay =
          `${m.title ?? ""} ${m.sport ?? ""} ${m.home_label ?? ""} ${m.away_label ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (search.status !== "all" && m.status !== search.status) return false;
      if (search.active === "active" && !m.is_active) return false;
      if (search.active === "inactive" && m.is_active) return false;
      if (search.sport !== "all" && m.sport !== search.sport) return false;
      return true;
    });
    list = [...list];
    switch (search.sort) {
      case "title":
        list.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""));
        break;
      case "status":
        list.sort((a, b) => (a.status ?? "").localeCompare(b.status ?? ""));
        break;
      case "updated":
        list.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
        break;
      default:
        list.sort(
          (a, b) =>
            (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
            (a.created_at ?? "").localeCompare(b.created_at ?? ""),
        );
    }
    return list;
  }, [matches, search]);

  useEffect(() => {
    const invalidate = () => qc.invalidateQueries({ queryKey: ["admin", "matches"] });
    const suffix = Math.random().toString(36).slice(2);
    const ch = supabase
      .channel(`admin-matches-${suffix}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "match_slots" }, invalidate)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Match deleted");
      qc.invalidateQueries({ queryKey: ["admin", "matches"] });
      qc.invalidateQueries({ queryKey: ["publicMatches"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setSearch = (patch: Partial<z.infer<typeof searchSchema>>) =>
    navigate({ search: (prev: z.infer<typeof searchSchema>) => ({ ...prev, ...patch }) });

  const openEditor = (id: string | null) => setSearch({ edit: id ?? "new", tab: "basics" });
  const closeEditor = () => setSearch({ edit: "", tab: "basics" });
  const setEditorTab = (t: WizardStep) => setSearch({ tab: t });

  const totalCount = matches.length;
  const activeCount = matches.filter((m) => m.is_active).length;
  const liveCount = matches.filter((m) => m.status === "live").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold">Arena Matches</h2>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Manage matches and pin IPTV channels to their slots. Changes appear on /arena in real
            time.
          </p>
        </div>
        <Button onClick={() => openEditor(null)} className="gap-2">
          <Plus className="h-4 w-4" />
          New match
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatChip label="Total" value={totalCount} />
        <StatChip label="Active" value={activeCount} tone="ok" />
        <StatChip label="Live" value={liveCount} tone="live" />
      </div>

      <div className="arena-card flex flex-wrap items-center gap-2 rounded-xl p-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search.q}
            onChange={(e) => setSearch({ q: e.target.value })}
            placeholder="Search title, teams, sport…"
            className="pl-8"
          />
          {search.q && (
            <button
              type="button"
              onClick={() => setSearch({ q: "" })}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-arena-panel-2 hover:text-white"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <Select value={search.status} onValueChange={(v) => setSearch({ status: v })}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={search.active} onValueChange={(v) => setSearch({ active: v })}>
          <SelectTrigger className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All visibility</SelectItem>
            <SelectItem value="active">Active only</SelectItem>
            <SelectItem value="inactive">Inactive only</SelectItem>
          </SelectContent>
        </Select>

        {sportOptions.length > 0 && (
          <Select value={search.sport} onValueChange={(v) => setSearch({ sport: v })}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sports</SelectItem>
              {sportOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select value={search.sort} onValueChange={(v) => setSearch({ sort: v })}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="order">Sort: manual order</SelectItem>
            <SelectItem value="title">Sort: title A-Z</SelectItem>
            <SelectItem value="status">Sort: status</SelectItem>
            <SelectItem value="updated">Sort: recently updated</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto inline-flex rounded-md border border-arena-border bg-arena-panel-2/50 p-0.5">
          <button
            type="button"
            onClick={() => setSearch({ view: "grid" })}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${
              search.view === "grid" ? "bg-arena-panel text-white" : "text-muted-foreground"
            }`}
            aria-pressed={search.view === "grid"}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> Grid
          </button>
          <button
            type="button"
            onClick={() => setSearch({ view: "table" })}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${
              search.view === "table" ? "bg-arena-panel text-white" : "text-muted-foreground"
            }`}
            aria-pressed={search.view === "table"}
          >
            <Rows3 className="h-3.5 w-3.5" /> Table
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="arena-card rounded-xl">
          <AdminLoadingBlock label="Loading matches…" />
        </div>
      ) : matches.length === 0 ? (
        <div className="arena-card rounded-xl">
          <AdminEmptyBlock
            icon={Trophy}
            title="No matches yet"
            description="Click 'New match' to add your first Arena match."
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="arena-card rounded-xl">
          <AdminEmptyBlock
            icon={Search}
            title="No matches match your filters"
            description="Try clearing the search or filters."
          />
        </div>
      ) : search.view === "table" ? (
        <MatchTable
          matches={filtered}
          slotsByMatch={slotsByMatch}
          onEdit={(m) => openEditor(m.id)}
          onDelete={(m) => setConfirmDelete(m)}
        />
      ) : (
        <div className="grid gap-3">
          {filtered.map((m) => (
            <MatchRowCard
              key={m.id}
              match={m}
              slots={slotsByMatch.get(m.id) ?? []}
              onEdit={() => openEditor(m.id)}
              onDelete={() => setConfirmDelete(m)}
            />
          ))}
        </div>
      )}

      <MatchEditorDialog
        key={editing?.id ?? (editorOpen ? "new" : "closed")}
        open={editorOpen}
        onOpenChange={(v) => {
          if (!v) closeEditor();
        }}
        match={editing}
        slots={editing ? (slotsByMatch.get(editing.id) ?? []) : []}
        tab={activeTab}
        onTabChange={setEditorTab}
        onSaved={(id) => {
          // Once a new match has an id, keep the URL in sync so refresh reopens it.
          if (id !== editingId) setSearch({ edit: id });
        }}
      />

      <AlertDialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this match?</AlertDialogTitle>
            <AlertDialogDescription>
              "{confirmDelete?.title || "Untitled"}" and its channel slots will be permanently
              removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDelete) remove.mutate(confirmDelete.id);
                setConfirmDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatChip({ label, value, tone }: { label: string; value: number; tone?: "ok" | "live" }) {
  const toneCls = tone === "live" ? "text-live" : tone === "ok" ? "text-emerald-400" : "text-white";
  return (
    <div className="arena-card rounded-lg px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`font-display text-xl font-bold tabular-nums ${toneCls}`}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: MatchStatus }) {
  const cls =
    status === "live"
      ? "bg-live text-live-foreground"
      : status === "final"
        ? "bg-black/70 text-white/70"
        : "bg-arena-panel-2 text-muted-foreground";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${cls}`}>
      {status}
    </span>
  );
}

// SlotThumbs is imported from "@/components/admin/SlotThumbs" (below).

function MatchRowCard({
  match,
  slots,
  onEdit,
  onDelete,
}: {
  match: MatchRow;
  slots: SlotRow[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="arena-card flex flex-col gap-3 rounded-xl p-3 sm:flex-row sm:items-center sm:p-4">
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-arena-panel-2 sm:h-24 sm:w-40 sm:shrink-0">
        {match.thumbnail_url ? (
          <img
            src={match.thumbnail_url}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageIcon className="h-6 w-6" />
          </div>
        )}
        <span className="absolute left-1 top-1">
          <StatusBadge status={match.status} />
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">
            {match.title || <span className="text-muted-foreground">Untitled match</span>}
          </span>
          {!match.is_active && (
            <span className="rounded bg-arena-panel-2 px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
              Inactive
            </span>
          )}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {match.sport ? (
            <span className="mr-2 uppercase tracking-wider">{match.sport}</span>
          ) : null}
          {match.home_label && match.away_label ? (
            <span>{match.home_label} vs {match.away_label}</span>
          ) : (
            <span>No teams set</span>
          )}
        </div>
        <div className="mt-2">
          <SlotThumbs match={match} slots={slots} />
        </div>
      </div>

      <div className="flex items-center gap-2 sm:flex-col">
        <Button size="sm" variant="outline" onClick={onEdit} className="gap-1">
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} className="gap-1 text-destructive">
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      </div>
    </div>
  );
}

function MatchTable({
  matches,
  slotsByMatch,
  onEdit,
  onDelete,
}: {
  matches: MatchRow[];
  slotsByMatch: Map<string, SlotRow[]>;
  onEdit: (m: MatchRow) => void;
  onDelete: (m: MatchRow) => void;
}) {
  return (
    <div className="arena-card overflow-x-auto rounded-xl">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[60px]">Status</TableHead>
            <TableHead>Match</TableHead>
            <TableHead>Sport</TableHead>
            <TableHead className="text-right">Score source</TableHead>
            <TableHead>Slots</TableHead>
            <TableHead>Active</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {matches.map((m) => (
            <TableRow key={m.id}>
              <TableCell>
                <StatusBadge status={m.status} />
              </TableCell>
              <TableCell>
                <div className="font-semibold">
                  {m.title || <span className="text-muted-foreground">Untitled</span>}
                </div>
                {(m.home_label || m.away_label) && (
                  <div className="text-xs text-muted-foreground">
                    {m.home_label ?? "?"} vs {m.away_label ?? "?"}
                  </div>
                )}
              </TableCell>
              <TableCell className="text-xs uppercase tracking-wider text-muted-foreground">
                {m.sport ?? "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums font-semibold">
                {m.home_score} – {m.away_score}
              </TableCell>
              <TableCell>
                <SlotThumbs match={m} slots={slotsByMatch.get(m.id) ?? []} />
              </TableCell>
              <TableCell>
                {m.is_active ? (
                  <span className="text-xs text-emerald-400">Yes</span>
                ) : (
                  <span className="text-xs text-muted-foreground">No</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <div className="inline-flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => onEdit(m)} className="gap-1">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onDelete(m)}
                    className="gap-1 text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

type FormState = {
  title: string;
  sport: string;
  home_label: string;
  away_label: string;
  home_score: number;
  away_score: number;
  status: MatchStatus;
  starts_at: string;
  starts_at_tz: string;
  clock_label: string;
  period_label: string;
  accent_home: string;
  accent_away: string;
  thumbnail_url: string;
  is_active: boolean;
  sort_order: number;
  slot_count: number;
};

function emptyForm(): FormState {
  return {
    title: "",
    sport: "",
    home_label: "",
    away_label: "",
    home_score: 0,
    away_score: 0,
    status: "scheduled",
    starts_at: "",
    starts_at_tz: LOCAL_TZ,
    clock_label: "",
    period_label: "",
    accent_home: "",
    accent_away: "",
    thumbnail_url: "",
    is_active: true,
    sort_order: 0,
    slot_count: 4,
  };
}

function fromRow(row: MatchRow): FormState {
  return {
    title: row.title ?? "",
    sport: row.sport ?? "",
    home_label: row.home_label ?? "",
    away_label: row.away_label ?? "",
    home_score: row.home_score ?? 0,
    away_score: row.away_score ?? 0,
    status: (row.status ?? "scheduled") as MatchStatus,
    starts_at: row.starts_at ? utcIsoToZonedInput(row.starts_at, LOCAL_TZ) : "",
    starts_at_tz: LOCAL_TZ,
    clock_label: row.clock_label ?? "",
    period_label: row.period_label ?? "",
    accent_home: row.accent_home ?? "",
    accent_away: row.accent_away ?? "",
    thumbnail_url: row.thumbnail_url ?? "",
    is_active: row.is_active,
    sort_order: row.sort_order ?? 0,
    slot_count: Math.max(1, Math.min(8, row.slot_count ?? 4)),
  };
}

const STEP_LABEL: Record<WizardStep, string> = {
  basics: "Basics",
  score: "Status",
  media: "Media",
  slots: "Channel slots",
};

const DRAFT_KEY_PREFIX = "admin.arena.editor.draft:";
const draftKey = (id: string | null) => `${DRAFT_KEY_PREFIX}${id ?? "new"}`;

function readDraft(id: string | null): FormState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(draftKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FormState>;
    // Merge over an empty form so schema drift doesn't break older drafts.
    return { ...emptyForm(), ...parsed };
  } catch {
    return null;
  }
}

function writeDraft(id: string | null, form: FormState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(draftKey(id), JSON.stringify(form));
  } catch {
    // Quota / private-mode failures are fine to swallow.
  }
}

function clearDraft(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(draftKey(id));
  } catch {
    /* ignore */
  }
}

function MatchEditorDialog({
  open,
  onOpenChange,
  match,
  slots,
  tab,
  onTabChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  match: MatchRow | null;
  slots: SlotRow[];
  tab: WizardStep;
  onTabChange: (t: WizardStep) => void;
  onSaved?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const upsertFn = useServerFn(upsertMatch);
  const slotFn = useServerFn(upsertMatchSlot);
  const swapFn = useServerFn(swapMatchSlots);

  // Hydrate form: prefer a saved localStorage draft for this id (or "new")
  // so a refresh restores in-progress edits. Fall back to the row/defaults.
  const initialId = match?.id ?? null;
  const [form, setForm] = useState<FormState>(
    () => readDraft(initialId) ?? (match ? fromRow(match) : emptyForm()),
  );
  const [savedId, setSavedId] = useState<string | null>(initialId);
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [confirmStart, setConfirmStart] = useState(false);
  const [hasDraft, setHasDraft] = useState<boolean>(() => readDraft(initialId) !== null);
  const isCreating = !savedId;

  // Re-hydrate whenever the editor is (re)opened for a different match.
  useEffect(() => {
    if (!open) return;
    const id = match?.id ?? null;
    const draft = readDraft(id);
    setForm(draft ?? (match ? fromRow(match) : emptyForm()));
    setSavedId(id);
    setHasDraft(draft !== null);
  }, [open, match]);

  // Persist form changes as a draft so refreshes don't lose input.
  useEffect(() => {
    if (!open) return;
    writeDraft(savedId, form);
    setHasDraft(true);
  }, [open, form, savedId]);

  const setTab = onTabChange;

  const bySlot = useMemo(() => new Map(slots.map((s) => [s.slot, s])), [slots]);

  const save = useMutation({
    mutationFn: async (overrides?: {
      status?: MatchStatus;
      is_active?: boolean;
      start?: boolean;
      schedule?: boolean;
    }) => {
      const status = overrides?.status ?? form.status;
      const is_active = overrides?.is_active ?? form.is_active;
      const payload = {
        id: savedId ?? undefined,
        title: form.title,
        sport: form.sport || null,
        home_label: form.home_label || null,
        away_label: form.away_label || null,
        home_score: Number(form.home_score) || 0,
        away_score: Number(form.away_score) || 0,
        status,
        starts_at: form.starts_at
          ? (zonedInputToUtc(form.starts_at, form.starts_at_tz)?.toISOString() ?? null)
          : null,
        clock_label: form.clock_label || null,
        period_label: form.period_label || null,
        accent_home: form.accent_home || null,
        accent_away: form.accent_away || null,
        thumbnail_url: form.thumbnail_url || null,
        is_active,
        sort_order: Number(form.sort_order) || 0,
        slot_count: Math.max(1, Math.min(8, Number(form.slot_count) || 4)),
      };
      const saved = await upsertFn({ data: payload });
      return {
        saved,
        started: !!overrides?.start,
        scheduled: !!overrides?.schedule,
        status,
        is_active,
      };
    },
    onSuccess: ({ saved, started, scheduled, status, is_active }) => {
      const prevId = savedId;
      const wasCreate = !prevId;
      if (saved?.id) {
        clearDraft(prevId);
        if (prevId !== saved.id) clearDraft(prevId);
        clearDraft(saved.id);
        setHasDraft(false);
        setSavedId(saved.id);
        setForm((f) => ({ ...f, status, is_active }));
        onSaved?.(saved.id);
      }
      const count = saved?.slot_count ?? form.slot_count;
      const title = saved?.title || form.title || "Untitled match";
      if (started) {
        toast.success("Match started in Arena", {
          description: `${title} is now live with ${count} channel slot${count === 1 ? "" : "s"}.`,
        });
      } else if (scheduled) {
        const when = saved?.starts_at
          ? new Date(saved.starts_at)
          : form.starts_at
            ? zonedInputToUtc(form.starts_at, form.starts_at_tz)
            : null;
        const tz = form.starts_at_tz || LOCAL_TZ;
        toast.success("Match scheduled", {
          description: when
            ? `${title} will go live automatically on ${formatWithTz(when, tz)} (${tz}).`
            : `${title} is scheduled.`,
        });
      } else {
        toast.success(wasCreate ? "Match created" : "Match updated", {
          description: `${title} — ${count} channel slot${count === 1 ? "" : "s"} configured.`,
        });
      }
      qc.invalidateQueries({ queryKey: ["admin", "matches"] });
      qc.invalidateQueries({ queryKey: ["publicMatches"] });
    },

    onError: (e: Error) => toast.error("Could not save match", { description: e.message }),
  });

  const saveSlot = useMutation({
    mutationFn: (input: { slot: number; channel: PickedChannel | null; enabled?: boolean }) => {
      if (!savedId) throw new Error("Save the match first");
      return slotFn({
        data: {
          match_id: savedId,
          slot: input.slot,
          channel_id: input.channel?.id ?? null,
          channel_name: input.channel?.name ?? null,
          channel_logo: input.channel?.logo ?? null,
          enabled: input.enabled ?? true,
        },
      });
    },
    onSuccess: (_res, input) => {
      const label = input.channel
        ? `assigned "${input.channel.name}"`
        : input.enabled === false
          ? "turned off"
          : input.enabled === true
            ? "turned on"
            : "cleared";
      toast.success(`Slot ${input.slot} ${label}`);
      qc.invalidateQueries({ queryKey: ["admin", "matches"] });
      qc.invalidateQueries({ queryKey: ["publicMatches"] });
    },
    onError: (e: Error) => toast.error("Could not save slot", { description: e.message }),
  });

  const swap = useMutation({
    mutationFn: (input: { a: number; b: number }) => {
      if (!savedId) throw new Error("Save the match first");
      return swapFn({ data: { match_id: savedId, slot_a: input.a, slot_b: input.b } });
    },
    onSuccess: (_res, input) => {
      toast.success(`Swapped slots ${input.a} and ${input.b}`);
      qc.invalidateQueries({ queryKey: ["admin", "matches"] });
      qc.invalidateQueries({ queryKey: ["publicMatches"] });
    },
    onError: (e: Error) => toast.error("Could not reorder slot", { description: e.message }),
  });

  const stepIndex = WIZARD_STEPS.indexOf(tab);
  const isLastStep = stepIndex === WIZARD_STEPS.length - 1;
  const canGoNext = tab !== "slots";
  const canSave = form.title.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5" />
            {savedId ? "Edit match" : "New match"}
            {isCreating && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                Step {stepIndex + 1} of {WIZARD_STEPS.length} · {STEP_LABEL[tab]}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {isCreating
              ? "Walk through each step, or jump around by clicking the tabs."
              : "Edit any section. Slot changes save immediately."}
          </DialogDescription>
          {hasDraft && (
            <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-arena-border bg-arena-panel-2/40 px-2 py-1 text-[11px] text-muted-foreground">
              <span>
                Draft saved on this device — your changes will still be here after a refresh.
              </span>
              <button
                type="button"
                onClick={() => {
                  clearDraft(savedId);
                  setForm(match ? fromRow(match) : emptyForm());
                  setHasDraft(false);
                }}
                className="rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-destructive hover:bg-destructive/10"
              >
                Discard draft
              </button>
            </div>
          )}
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as WizardStep)} className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            {WIZARD_STEPS.map((s, i) => (
              <TabsTrigger
                key={s}
                value={s}
                className="text-xs"
              >
                <span className="mr-1 hidden sm:inline">{i + 1}.</span>
                {STEP_LABEL[s]}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="basics" className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Title" required className="sm:col-span-2">
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Lakers vs Warriors — Game 5"
                />
              </Field>
              <Field label="Sport">
                <Input
                  value={form.sport}
                  onChange={(e) => setForm({ ...form, sport: e.target.value })}
                  placeholder="Basketball, Soccer…"
                />
              </Field>
              <Field label={`Start time (${form.starts_at_tz})`}>
                <div className="flex gap-2">
                  <Input
                    type="datetime-local"
                    value={form.starts_at}
                    onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
                    className="flex-1"
                  />
                  <Select
                    value={form.starts_at_tz}
                    onValueChange={(v) => setForm({ ...form, starts_at_tz: v })}
                  >
                    <SelectTrigger className="w-[180px] shrink-0">
                      <SelectValue placeholder="Timezone" />
                    </SelectTrigger>
                    <SelectContent>
                      {TZ_OPTIONS.map((tz) => (
                        <SelectItem key={tz} value={tz}>
                          {tz}
                          {tz === LOCAL_TZ ? " (browser)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {form.starts_at && zonedInputToUtc(form.starts_at, form.starts_at_tz) ? (
                    <>
                      Will go live at{" "}
                      <strong>
                        {formatWithTz(
                          zonedInputToUtc(form.starts_at, form.starts_at_tz)!,
                          form.starts_at_tz,
                        )}
                      </strong>
                      .
                    </>
                  ) : (
                    <>
                      Times are interpreted in <strong>{form.starts_at_tz}</strong>. Used by{" "}
                      <strong>Schedule start</strong>.
                    </>
                  )}
                </p>
              </Field>
              <Field label="Home team">
                <Input
                  value={form.home_label}
                  onChange={(e) => setForm({ ...form, home_label: e.target.value })}
                />
              </Field>
              <Field label="Away team">
                <Input
                  value={form.away_label}
                  onChange={(e) => setForm({ ...form, away_label: e.target.value })}
                />
              </Field>
              <Field label="Home accent color">
                <Input
                  value={form.accent_home}
                  onChange={(e) => setForm({ ...form, accent_home: e.target.value })}
                  placeholder="#552583"
                />
              </Field>
              <Field label="Away accent color">
                <Input
                  value={form.accent_away}
                  onChange={(e) => setForm({ ...form, accent_away: e.target.value })}
                  placeholder="#FDB927"
                />
              </Field>
              <Field label="Sort order">
                <Input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
                />
              </Field>
              <Field label="Visibility">
                <label className="inline-flex h-10 items-center gap-2 text-sm">
                  <Switch
                    checked={form.is_active}
                    onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                  />
                  Active on /arena
                </label>
              </Field>
            </div>
          </TabsContent>

          <TabsContent value="score" className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Status">
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm({ ...form, status: v as MatchStatus })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </TabsContent>

          <TabsContent value="media" className="mt-4">
            <ThumbnailUploader
              value={form.thumbnail_url}
              onChange={(url) => setForm({ ...form, thumbnail_url: url })}
            />
          </TabsContent>

          <TabsContent value="slots" className="mt-4 space-y-3">
            {!savedId ? (
              <div className="rounded-lg border border-arena-border bg-arena-panel-2/40 p-4">
                <div className="text-sm font-semibold text-white">Create this match first</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Channel slots need a saved match ID. Your current form will be saved, then the
                  slot controls will appear here.
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="mt-3"
                  onClick={() => save.mutate(undefined)}
                  disabled={save.isPending || !canSave}
                >
                  {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Create match and continue
                </Button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between rounded-lg border border-arena-border bg-arena-panel-2/40 p-3">
                  <div>
                    <div className="text-sm font-semibold">Channel slots</div>
                    <div className="text-xs text-muted-foreground">
                      1 – 8 tiles per match. Extras above the count are hidden on /arena.
                    </div>
                  </div>
                  <div className="inline-flex items-center gap-2">
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => {
                        const next = Math.max(1, form.slot_count - 1);
                        setForm({ ...form, slot_count: next });
                        save.mutate(undefined);
                      }}
                      disabled={form.slot_count <= 1 || save.isPending}
                      aria-label="Fewer slots"
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <span className="w-6 text-center font-display text-lg font-bold tabular-nums">
                      {form.slot_count}
                    </span>
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => {
                        const next = Math.min(8, form.slot_count + 1);
                        setForm({ ...form, slot_count: next });
                        save.mutate(undefined);
                      }}
                      disabled={form.slot_count >= 8 || save.isPending}
                      aria-label="More slots"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2">
                  {slotNumbers(form.slot_count).map((n, idx, arr) => {
                    const s = bySlot.get(n);
                    return (
                      <div
                        key={n}
                        className="flex items-center gap-3 rounded-lg border border-arena-border bg-arena-panel-2/40 p-3"
                      >
                        <div className="flex flex-col gap-1">
                          <button
                            type="button"
                            disabled={idx === 0 || swap.isPending}
                            onClick={() => swap.mutate({ a: n, b: n - 1 })}
                            className="text-muted-foreground hover:text-white disabled:opacity-30"
                            aria-label="Move slot up"
                          >
                            <ArrowUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === arr.length - 1 || swap.isPending}
                            onClick={() => swap.mutate({ a: n, b: n + 1 })}
                            className="text-muted-foreground hover:text-white disabled:opacity-30"
                            aria-label="Move slot down"
                          >
                            <ArrowDown className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="flex h-12 w-16 items-center justify-center overflow-hidden rounded border border-arena-border bg-black/40">
                          {s?.channel_logo ? (
                            <img
                              src={s.channel_logo}
                              alt=""
                              className="max-h-full max-w-full object-contain"
                            />
                          ) : (
                            <span className="text-xs font-bold text-muted-foreground">TV{n}</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-sm font-semibold">
                            <span>Slot {n}</span>
                            <Select
                              value={String(n)}
                              onValueChange={(v) => {
                                const target = Number(v);
                                if (target !== n) swap.mutate({ a: n, b: target });
                              }}
                              disabled={swap.isPending || arr.length <= 1}
                            >
                              <SelectTrigger
                                className="h-6 w-[92px] text-[11px]"
                                aria-label={`Move slot ${n} to position`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {arr.map((p) => (
                                  <SelectItem key={p} value={String(p)} className="text-xs">
                                    Position {p}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {s?.channel_name ? (
                              <span className="truncate font-normal text-muted-foreground">
                                — {s.channel_name}
                              </span>
                            ) : (
                              <span className="font-normal text-muted-foreground">— empty</span>
                            )}
                          </div>
                          {s?.channel_id && (
                            <div className="mt-0.5 text-xs text-muted-foreground truncate">
                              {s.channel_id}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <label className="inline-flex items-center gap-1.5 text-xs">
                            <Switch
                              checked={s?.enabled ?? true}
                              disabled={!s}
                              onCheckedChange={(v) =>
                                saveSlot.mutate({
                                  slot: n,
                                  channel: s
                                    ? {
                                        id: s.channel_id ?? "",
                                        name: s.channel_name ?? "",
                                        logo: s.channel_logo ?? "",
                                        country: "",
                                        categories: [],
                                      }
                                    : null,
                                  enabled: v,
                                })
                              }
                            />
                            On
                          </label>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setPickerFor(n)}
                            className="gap-1"
                          >
                            <Search className="h-3.5 w-3.5" />
                            {s?.channel_id ? "Change" : "Pick channel"}
                          </Button>
                          {s?.channel_id && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => saveSlot.mutate({ slot: n, channel: null })}
                              className="text-destructive"
                            >
                              Clear
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <Button
                variant="ghost"
                onClick={() => setTab(WIZARD_STEPS[stepIndex - 1])}
                className="gap-1"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            {isCreating && !isLastStep ? (
              <>
                <Button
                  onClick={() => save.mutate(undefined)}
                  disabled={save.isPending || !canSave}
                  variant="secondary"
                >
                  {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save draft
                </Button>
                {canGoNext && (
                  <Button
                    onClick={() => setTab(WIZARD_STEPS[stepIndex + 1])}
                    disabled={!canSave}
                    className="gap-1"
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button
                  onClick={() => save.mutate(undefined)}
                  disabled={save.isPending || !canSave}
                  variant="secondary"
                >
                  {save.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="mr-2 h-4 w-4" />
                  )}
                  {savedId ? "Save match" : "Create match"}
                </Button>
                <Button
                  onClick={() => setConfirmStart(true)}
                  disabled={save.isPending || !canSave}
                  title="Save and immediately go live in the Arena"
                >
                  {save.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <PlayCircle className="mr-2 h-4 w-4" />
                  )}
                  Save & Start in Arena
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (!form.starts_at) {
                      toast.error("Set a start time first", {
                        description:
                          "Choose a future Start time on the Basics tab to schedule this match.",
                      });
                      setTab("basics");
                      return;
                    }
                    const when = zonedInputToUtc(form.starts_at, form.starts_at_tz);
                    if (!when || Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
                      toast.error("Start time must be in the future", {
                        description: "Pick a time later than now to schedule this match.",
                      });
                      setTab("basics");
                      return;
                    }
                    save.mutate({ status: "scheduled", is_active: true, schedule: true });
                  }}
                  disabled={save.isPending || !canSave}
                  title="Save with a scheduled start time; the Arena will flip it live automatically"
                >
                  <CalendarClock className="mr-2 h-4 w-4" />
                  Schedule start
                </Button>
              </>
            )}
          </div>
        </DialogFooter>

        <IptvChannelPicker
          open={pickerFor !== null}
          onOpenChange={(v) => !v && setPickerFor(null)}
          onPick={(ch) => {
            if (pickerFor === null) return;
            saveSlot.mutate({ slot: pickerFor, channel: ch });
            setPickerFor(null);
          }}
        />

        <AlertDialog open={confirmStart} onOpenChange={setConfirmStart}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Start this match in the Arena?</AlertDialogTitle>
              <AlertDialogDescription>
                This will save the match, mark it as <strong>live</strong> and{" "}
                <strong>active</strong>, and push it to every Arena viewer in real time. You can
                pause it later by editing the status.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirmStart(false);
                  save.mutate({ status: "live", is_active: true, start: true });
                }}
              >
                Save & Start
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
