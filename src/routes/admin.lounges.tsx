import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Pencil, Trash2, Save, X, Building2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  useLounges,
  useUpsertLounge,
  useDeleteLounge,
  type Lounge,
} from "@/lib/admin-queries";
import {
  AdminEmptyRow,
  AdminLoadingRow,
} from "@/components/admin/AdminStates";

export const Route = createFileRoute("/admin/lounges")({
  component: AdminLoungesPage,
});

type Draft = Partial<Lounge> & { id?: string };

function slugify(v: string) {
  return v
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function AdminLoungesPage() {
  const { data: lounges = [], isLoading, error } = useLounges();
  const upsert = useUpsertLounge();
  const del = useDeleteLounge();
  const [editing, setEditing] = useState<Draft | null>(null);

  async function save() {
    if (!editing) return;
    const name = (editing.name ?? "").trim();
    if (!name) {
      toast.error("Name is required");
      return;
    }
    const slug = (editing.slug ?? "").trim() || slugify(name);
    try {
      await upsert.mutateAsync({
        id: editing.id,
        name,
        slug,
        tagline: editing.tagline ?? null,
        vibe: editing.vibe ?? "Themed",
        entry_fee_cents: Number(editing.entry_fee_cents ?? 500),
        free_preview_seconds: Number(editing.free_preview_seconds ?? 120),
        is_active: editing.is_active ?? true,
        is_private: editing.is_private ?? false,
        sort_order: Number(editing.sort_order ?? 0),
      });
      toast.success(editing.id ? "Lounge updated" : "Lounge created");
      setEditing(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function remove(l: Lounge) {
    if (!confirm(`Delete lounge "${l.name}"? This removes all TVs and schedules.`)) return;
    try {
      await del.mutateAsync(l.id);
      toast.success("Lounge deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-bold">Lounges</h2>
        <Button size="sm" variant="arena" className="gap-2" onClick={() => setEditing({})}>
          <Plus className="h-4 w-4" />
          New Lounge
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error.message}
        </div>
      )}

      <div className="overflow-hidden arena-card rounded-xl">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="arena-th px-4 py-3 text-left">Name</th>
              <th className="arena-th px-4 py-3 text-left">Slug</th>
              <th className="arena-th px-4 py-3 text-left">Entry</th>
              <th className="arena-th px-4 py-3 text-left">Preview</th>
              <th className="arena-th px-4 py-3 text-left">Status</th>
              <th className="arena-th px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <AdminLoadingRow colSpan={6} label="Loading lounges…" />}
            {!isLoading && lounges.length === 0 && (
              <AdminEmptyRow
                colSpan={6}
                icon={Building2}
                title="No lounges yet"
                description="Create your first lounge to start streaming games."
              />
            )}
            {lounges.map((l) => (
              <tr key={l.id} className="border-b border-arena-border/60 last:border-0">
                <td className="px-4 py-3 font-medium">{l.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{l.slug}</td>
                <td className="px-4 py-3">
                  {l.entry_fee_cents === 0
                    ? "Free"
                    : `$${(l.entry_fee_cents / 100).toFixed(2)}`}
                </td>
                <td className="px-4 py-3">{l.free_preview_seconds}s</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                      l.is_active
                        ? "bg-success/15 text-success"
                        : "bg-arena-panel-2 text-muted-foreground"
                    }`}
                  >
                    ● {l.is_active ? "Active" : "Paused"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="arenaOutline" onClick={() => setEditing(l)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="arenaOutline" onClick={() => remove(l)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl arena-card rounded-xl p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">
                {editing.id ? "Edit lounge" : "New lounge"}
              </h3>
              <button
                onClick={() => setEditing(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name">
                <input
                  className="input"
                  value={editing.name ?? ""}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </Field>
              <Field label="Slug (URL)">
                <input
                  className="input"
                  placeholder={editing.name ? slugify(editing.name) : "auto"}
                  value={editing.slug ?? ""}
                  onChange={(e) => setEditing({ ...editing, slug: e.target.value })}
                />
              </Field>
              <Field label="Tagline" span2>
                <input
                  className="input"
                  value={editing.tagline ?? ""}
                  onChange={(e) => setEditing({ ...editing, tagline: e.target.value })}
                />
              </Field>
              <Field label="Vibe">
                <input
                  className="input"
                  value={editing.vibe ?? ""}
                  onChange={(e) => setEditing({ ...editing, vibe: e.target.value })}
                />
              </Field>
              <Field label="Sort order">
                <input
                  type="number"
                  className="input"
                  value={editing.sort_order ?? 0}
                  onChange={(e) =>
                    setEditing({ ...editing, sort_order: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Entry fee (cents)">
                <input
                  type="number"
                  className="input"
                  value={editing.entry_fee_cents ?? 500}
                  onChange={(e) =>
                    setEditing({ ...editing, entry_fee_cents: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Free preview (seconds)">
                <input
                  type="number"
                  className="input"
                  value={editing.free_preview_seconds ?? 120}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      free_preview_seconds: Number(e.target.value),
                    })
                  }
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editing.is_active ?? true}
                  onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })}
                />
                Active
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editing.is_private ?? false}
                  onChange={(e) => setEditing({ ...editing, is_private: e.target.checked })}
                />
                Private
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="arenaOutline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button variant="arena" onClick={save} disabled={upsert.isPending} className="gap-2">
                <Save className="h-4 w-4" />
                {upsert.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <style>{`.input { width:100%; border:1px solid var(--border); background:var(--background); border-radius:6px; padding:8px 12px; font-size:14px; }`}</style>
    </div>
  );
}

function Field({
  label,
  children,
  span2,
}: {
  label: string;
  children: React.ReactNode;
  span2?: boolean;
}) {
  return (
    <label className={`block ${span2 ? "sm:col-span-2" : ""}`}>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
