import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import {
  Flame,
  Plus,
  Trash2,
  RefreshCw,
  Save,
  X,
  Eye,
  EyeOff,
  GripVertical,
  Zap,
  Search,
  XCircle,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

import {
  listQuickDaresForAdmin,
  createQuickDare,
  updateQuickDare,
  deleteQuickDare,
  reorderQuickDares,
  type AdminQuickDare,
} from "@/lib/admin-quick-dares.functions";
import {
  QUICK_DARE_ICONS,
  QUICK_DARE_ICON_KEYS,
  quickDareIcon,
  formatDarePrice,
} from "@/lib/quick-dares-icons";

const daresQuery = () =>
  queryOptions({
    queryKey: ["admin", "quick-dares"],
    queryFn: () => listQuickDaresForAdmin(),
    staleTime: 15_000,
  });

export const Route = createFileRoute("/admin/quick-dares")({
  head: () => ({
    meta: [
      { title: "Quick Dares — Admin" },
      {
        name: "description",
        content: "Manage the Quick Dares list shown on the homepage.",
      },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(daresQuery()),
  component: AdminQuickDaresPage,
  errorComponent: ({ error, reset }) => (
    <div className="rounded-2xl border border-rose-500/40 bg-rose-500/5 p-6 text-sm text-rose-300">
      Failed to load Quick Dares: {error.message}
      <button className="ml-3 underline" onClick={reset}>
        Retry
      </button>
    </div>
  ),
  notFoundComponent: () => <div className="p-6 text-sm">Not found.</div>,
});

function AdminQuickDaresPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listQuickDaresForAdmin);
  const q = useSuspenseQuery({ ...daresQuery(), queryFn: () => listFn() });
  const dares = q.data;

  const [editing, setEditing] = useState<AdminQuickDare | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "hidden">(
    "all",
  );

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "quick-dares"] });
    void qc.invalidateQueries({ queryKey: ["public", "quick-dares"] });
  };

  const normalizedSearch = search.trim().toLowerCase();
  const filteredDares = dares.filter((d) => {
    if (statusFilter === "active" && !d.is_active) return false;
    if (statusFilter === "hidden" && d.is_active) return false;
    if (
      normalizedSearch &&
      !d.label.toLowerCase().includes(normalizedSearch) &&
      !d.icon.toLowerCase().includes(normalizedSearch)
    )
      return false;
    return true;
  });
  const isFiltering = normalizedSearch !== "" || statusFilter !== "all";

  return (
    <div className="space-y-6">
      <div className="arena-card rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-arena-violet">
              PGX Homepage
            </div>
            <h2 className="mt-1 flex items-center gap-2 font-display text-2xl font-extrabold uppercase tracking-tight text-arena-gradient">
              <Flame className="h-5 w-5" /> Quick Dares
            </h2>
            <p className="mt-2 max-w-2xl text-xs uppercase tracking-wider text-muted-foreground">
              Manage the dares list shown in the "Quick Dares" card on the
              homepage. Reorder, edit, hide, or add new dares — changes go
              live immediately.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="arenaOutline"
              size="sm"
              onClick={() => invalidate()}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> New Dare
            </Button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Total" value={String(dares.length)} />
          <Stat
            label="Active"
            value={String(dares.filter((d) => d.is_active).length)}
            accent
          />
          <Stat
            label="Hidden"
            value={String(dares.filter((d) => !d.is_active).length)}
          />
          <Stat
            label="Avg price"
            value={
              dares.length
                ? formatDarePrice(
                    Math.round(
                      dares.reduce((s, d) => s + d.price_cents, 0) /
                        dares.length,
                    ),
                  )
                : "—"
            }
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-3">
          {dares.length > 0 && (
            <div className="arena-card flex flex-wrap items-center gap-3 rounded-2xl p-3 sm:p-4">
              <div className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by label or icon…"
                  aria-label="Search Quick Dares"
                  className="pl-9 pr-9"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-arena-panel-2/60 hover:text-white"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div
                role="tablist"
                aria-label="Filter by status"
                className="inline-flex rounded-lg border border-arena-border bg-arena-panel-2/40 p-0.5"
              >
                {(
                  [
                    { key: "all", label: "All", count: dares.length },
                    {
                      key: "active",
                      label: "Active",
                      count: dares.filter((d) => d.is_active).length,
                    },
                    {
                      key: "hidden",
                      label: "Hidden",
                      count: dares.filter((d) => !d.is_active).length,
                    },
                  ] as const
                ).map((opt) => {
                  const selected = statusFilter === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setStatusFilter(opt.key)}
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
                        selected
                          ? "bg-arena-panel text-white shadow-inner"
                          : "text-muted-foreground hover:text-white"
                      }`}
                    >
                      {opt.label}
                      <span className="ml-1.5 font-mono text-[10px] opacity-70">
                        {opt.count}
                      </span>
                    </button>
                  );
                })}
              </div>
              {isFiltering && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setStatusFilter("all");
                  }}
                  className="text-xs font-semibold uppercase tracking-wider text-arena-pink hover:text-arena-pink/80"
                >
                  Clear
                </button>
              )}
            </div>
          )}

          {dares.length === 0 ? (
            <div className="arena-card rounded-2xl p-10 text-center text-sm text-muted-foreground">
              No dares yet. Click <span className="text-white">New Dare</span> to
              add the first one.
            </div>
          ) : filteredDares.length === 0 ? (
            <div className="arena-card rounded-2xl p-10 text-center text-sm text-muted-foreground">
              No dares match your filters.
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("all");
                }}
                className="ml-2 text-arena-pink underline hover:no-underline"
              >
                Reset
              </button>
            </div>
          ) : (
            <>
              {isFiltering && (
                <div className="rounded-lg border border-dashed border-arena-border/60 bg-arena-bg/40 px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                  Showing {filteredDares.length} of {dares.length} · drag-to-reorder
                  is disabled while filtering
                </div>
              )}
              <SortableDaresList
                dares={filteredDares}
                dragDisabled={isFiltering}
                onEdit={(d) => setEditing(d)}
                onChanged={invalidate}
              />
            </>
          )}
        </div>
        <div className="lg:sticky lg:top-4 lg:self-start">
          <HomepagePreviewPanel dares={dares} />
        </div>
      </div>

      {(creating || editing) && (
        <DareDialog
          dare={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={invalidate}
        />
      )}
    </div>
  );
}

function SortableDaresList({
  dares,
  dragDisabled = false,
  onEdit,
  onChanged,
}: {
  dares: AdminQuickDare[];
  dragDisabled?: boolean;
  onEdit: (d: AdminQuickDare) => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const reorderFn = useServerFn(reorderQuickDares);
  const [savingIds, setSavingIds] = useState<string[] | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function handleDragEnd(e: DragEndEvent) {
    if (dragDisabled) return;
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = dares.findIndex((d) => d.id === active.id);
    const newIndex = dares.findIndex((d) => d.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(dares, oldIndex, newIndex).map((d, i) => ({
      ...d,
      sort_order: i,
    }));
    const ids = reordered.map((d) => d.id);

    // Optimistic update
    qc.setQueryData(["admin", "quick-dares"], reordered);
    setSavingIds(ids);
    try {
      await reorderFn({ data: { ids } });
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reorder");
      onChanged();
    } finally {
      setSavingIds(null);
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={dares.map((d) => d.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="arena-card divide-y divide-arena-border/60 rounded-2xl">
          {dares.map((d) => (
            <DareRow
              key={d.id}
              dare={d}
              busy={savingIds !== null || dragDisabled}
              onEdit={() => onEdit(d)}
              onChanged={onChanged}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function DareRow({
  dare,
  busy: parentBusy,
  onEdit,
  onChanged,
}: {
  dare: AdminQuickDare;
  busy: boolean;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const updateFn = useServerFn(updateQuickDare);
  const deleteFn = useServerFn(deleteQuickDare);
  const Icon = quickDareIcon(dare.icon);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: dare.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  const disabled = busy || parentBusy;

  async function toggleActive() {
    setBusy(true);
    try {
      await updateFn({ data: { id: dare.id, is_active: !dare.is_active } });
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${dare.label}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await deleteFn({ data: { id: dare.id } });
      toast.success("Dare deleted");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`grid grid-cols-[auto_auto_1fr_auto_auto] items-center gap-3 bg-arena-panel/40 px-4 py-3 sm:px-5 ${
        dare.is_active ? "" : "opacity-60"
      } ${isDragging ? "shadow-lg ring-1 ring-arena-pink/40" : ""}`}
    >
      <button
        type="button"
        className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-arena-panel-2/60 hover:text-white active:cursor-grabbing disabled:opacity-30"
        aria-label={`Drag to reorder ${dare.label}`}
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <span className="grid h-9 w-9 place-items-center rounded-full border border-arena-pink/40 bg-arena-panel/80 text-arena-pink">
        <Icon className="h-4 w-4" />
      </span>

      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-white">
          {dare.label}
        </div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          icon: {dare.icon} · sort {dare.sort_order}
        </div>
      </div>

      <div className="font-mono text-sm font-bold text-emerald-300">
        {formatDarePrice(dare.price_cents)}
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={disabled}
          onClick={toggleActive}
          className="rounded-md border border-arena-border p-1.5 text-muted-foreground hover:bg-arena-panel-2/60 hover:text-white disabled:opacity-40"
          aria-label={dare.is_active ? "Hide from homepage" : "Show on homepage"}
          title={dare.is_active ? "Hide from homepage" : "Show on homepage"}
        >
          {dare.is_active ? (
            <Eye className="h-3.5 w-3.5" />
          ) : (
            <EyeOff className="h-3.5 w-3.5" />
          )}
        </button>
        <Button
          variant="arenaOutline"
          size="sm"
          disabled={disabled}
          onClick={onEdit}
        >
          Edit
        </Button>
        <button
          type="button"
          disabled={disabled}
          onClick={remove}
          className="rounded-md border border-rose-500/40 p-1.5 text-rose-400 hover:bg-rose-500/10 disabled:opacity-40"
          aria-label="Delete"
          title="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function DareDialog({
  dare,
  onClose,
  onSaved,
}: {
  dare: AdminQuickDare | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const createFn = useServerFn(createQuickDare);
  const updateFn = useServerFn(updateQuickDare);

  const [label, setLabel] = useState(dare?.label ?? "");
  const [icon, setIcon] = useState(dare?.icon ?? "shield");
  const [priceDollars, setPriceDollars] = useState(
    dare ? (dare.price_cents / 100).toString() : "5",
  );
  const [isActive, setIsActive] = useState(dare?.is_active ?? true);
  const [saving, setSaving] = useState(false);

  const isEdit = !!dare;
  const IconPreview = quickDareIcon(icon);

  async function submit() {
    const trimmed = label.trim();
    if (!trimmed) {
      toast.error("Label is required");
      return;
    }
    const dollars = Number(priceDollars);
    if (!Number.isFinite(dollars) || dollars < 0) {
      toast.error("Price must be a positive number");
      return;
    }
    const price_cents = Math.round(dollars * 100);

    setSaving(true);
    try {
      if (isEdit && dare) {
        await updateFn({
          data: {
            id: dare.id,
            label: trimmed,
            icon,
            price_cents,
            is_active: isActive,
          },
        });
        toast.success("Dare updated");
      } else {
        await createFn({
          data: { label: trimmed, icon, price_cents, is_active: isActive },
        });
        toast.success("Dare created");
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Dare" : "New Dare"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="dare-label">Label</Label>
            <Input
              id="dare-label"
              value={label}
              maxLength={120}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Blow a kiss to the camera"
            />
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="dare-icon">Icon</Label>
              <Select value={icon} onValueChange={setIcon}>
                <SelectTrigger id="dare-icon">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUICK_DARE_ICON_KEYS.map((key) => {
                    const I = QUICK_DARE_ICONS[key]!;
                    return (
                      <SelectItem key={key} value={key}>
                        <span className="inline-flex items-center gap-2">
                          <I className="h-3.5 w-3.5" /> {key}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col items-center justify-end">
              <span className="grid h-10 w-10 place-items-center rounded-full border border-arena-pink/40 bg-arena-panel/80 text-arena-pink">
                <IconPreview className="h-5 w-5" />
              </span>
              <span className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                Preview
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dare-price">Price (USD)</Label>
            <Input
              id="dare-price"
              type="number"
              min={0}
              step="0.01"
              value={priceDollars}
              onChange={(e) => setPriceDollars(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-arena-border bg-arena-panel-2/40 px-3 py-2">
            <div>
              <div className="text-sm font-semibold text-white">Show on homepage</div>
              <div className="text-[11px] text-muted-foreground">
                Hidden dares stay in the admin but don't appear to visitors.
              </div>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="arenaOutline" onClick={onClose} disabled={saving}>
            <X className="mr-1.5 h-3.5 w-3.5" /> Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            <Save className="mr-1.5 h-3.5 w-3.5" />
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create dare"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-arena-border bg-arena-panel-2/40 p-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 truncate font-mono text-lg font-extrabold ${
          accent ? "text-emerald-300" : "text-white"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function HomepagePreviewPanel({ dares }: { dares: AdminQuickDare[] }) {
  const visible = dares.filter((d) => d.is_active);
  return (
    <div className="arena-card rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-arena-violet">
            Preview
          </div>
          <div className="text-sm font-semibold text-white">
            Homepage · Quick Dares
          </div>
        </div>
        <span className="rounded-full border border-arena-border bg-arena-panel-2/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          {visible.length} live
        </span>
      </div>

      {/* Mirror of QuickDaresCard on the homepage */}
      <div className="flex flex-col rounded-2xl border border-arena-border bg-arena-panel/50 p-5 backdrop-blur">
        <div className="mb-3 flex items-center gap-2">
          <Flame className="h-4 w-4 text-arena-pink" />
          <h3 className="font-display text-base font-extrabold uppercase tracking-tight text-white">
            Quick Dares
          </h3>
        </div>
        {visible.length === 0 ? (
          <div className="rounded-lg border border-dashed border-arena-border/60 bg-arena-bg/40 px-3 py-6 text-center text-xs uppercase tracking-wider text-muted-foreground">
            No dares available right now.
          </div>
        ) : (
          <ul className="space-y-2">
            {visible.map((d) => {
              const Icon = quickDareIcon(d.icon);
              return (
                <li
                  key={d.id}
                  className="flex items-center justify-between rounded-lg border border-arena-border/60 bg-arena-bg/50 px-3 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    <span className="grid h-8 w-8 place-items-center rounded-full border border-arena-pink/40 bg-arena-panel/80 text-arena-pink">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="text-sm text-white/90">{d.label}</span>
                  </div>
                  <span className="text-sm font-bold text-white">
                    {formatDarePrice(d.price_cents)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <button
          type="button"
          disabled
          aria-hidden
          tabIndex={-1}
          className="mt-4 inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-arena-pink via-arena-violet to-arena-cyan px-6 py-3 text-sm font-bold uppercase tracking-wider text-white shadow-[0_10px_30px_-10px_var(--arena-pink)]"
        >
          <span>Send a Dare</span>
          <Flame className="h-4 w-4" />
          <Zap className="h-4 w-4" />
        </button>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Live preview of what visitors see on the homepage. Only{" "}
        <span className="text-white">active</span> dares appear, in the current
        sort order. Edits update here instantly.
      </p>
    </div>
  );
}
