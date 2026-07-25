import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  Save,
  X,
  CreditCard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listAllPaymentMethods,
  upsertPaymentMethod,
  deletePaymentMethod,
  type PaymentMethod,
  type TopupMethodKind,
} from "@/lib/payment-methods.functions";

export const Route = createFileRoute("/admin/payments")({
  component: AdminPaymentsPage,
});

type ConfigField = { key: string; value: string };

type FormState = {
  id?: string;
  code: string;
  label: string;
  description: string;
  instructions: string;
  kind: TopupMethodKind;
  icon: string;
  reference_placeholder: string;
  enabled: boolean;
  sort_order: number;
  config: ConfigField[];
};

const KIND_LABELS: Record<TopupMethodKind, string> = {
  bank_transfer: "Bank transfer",
  mobile_money: "Mobile money",
  cash: "Cash",
  other: "Other",
};

function emptyForm(): FormState {
  return {
    code: "",
    label: "",
    description: "",
    instructions: "",
    kind: "other",
    icon: "",
    reference_placeholder: "",
    enabled: true,
    sort_order: 100,
    config: [],
  };
}

function toForm(m: PaymentMethod): FormState {
  const entries = Object.entries(m.config ?? {}).map(([key, v]) => ({
    key,
    value: typeof v === "string" ? v : JSON.stringify(v),
  }));
  return {
    id: m.id,
    code: m.code,
    label: m.label,
    description: m.description ?? "",
    instructions: m.instructions ?? "",
    kind: m.kind,
    icon: m.icon ?? "",
    reference_placeholder: m.reference_placeholder ?? "",
    enabled: m.enabled,
    sort_order: m.sort_order,
    config: entries,
  };
}

function AdminPaymentsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listAllPaymentMethods);
  const upsertFn = useServerFn(upsertPaymentMethod);
  const deleteFn = useServerFn(deletePaymentMethod);

  const listQuery = useQuery({
    queryKey: ["admin", "payment_methods"],
    queryFn: () => listFn(),
    staleTime: 5_000,
  });

  const [editing, setEditing] = useState<FormState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PaymentMethod | null>(null);

  const upsertMutation = useMutation({
    mutationFn: async (f: FormState) => {
      const config: Record<string, unknown> = {};
      for (const { key, value } of f.config) {
        const k = key.trim();
        if (!k) continue;
        config[k] = value;
      }
      return upsertFn({
        data: {
          id: f.id,
          code: f.code.trim(),
          label: f.label.trim(),
          description: f.description.trim() || null,
          instructions: f.instructions.trim() || null,
          kind: f.kind,
          icon: f.icon.trim() || null,
          reference_placeholder: f.reference_placeholder.trim() || null,
          enabled: f.enabled,
          sort_order: f.sort_order,
          config,
        },
      });
    },
    onSuccess: () => {
      toast.success("Payment method saved");
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ["admin", "payment_methods"] });
      void qc.invalidateQueries({ queryKey: ["wallet", "payment_methods"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Payment method removed");
      setConfirmDelete(null);
      void qc.invalidateQueries({ queryKey: ["admin", "payment_methods"] });
      void qc.invalidateQueries({ queryKey: ["wallet", "payment_methods"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  const toggleMutation = useMutation({
    mutationFn: (m: PaymentMethod) =>
      upsertFn({
        data: {
          id: m.id,
          code: m.code,
          label: m.label,
          description: m.description,
          instructions: m.instructions,
          kind: m.kind,
          icon: m.icon,
          reference_placeholder: m.reference_placeholder,
          config: (m.config ?? {}) as Record<string, unknown>,
          sort_order: m.sort_order,
          enabled: !m.enabled,
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "payment_methods"] });
      void qc.invalidateQueries({ queryKey: ["wallet", "payment_methods"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const methods = listQuery.data ?? [];

  return (
    <section className="arena-card space-y-4 rounded-2xl p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Payment configuration
          </div>
          <h2 className="mt-1 font-display text-xl font-extrabold uppercase tracking-tight text-white">
            Payment methods
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Define which channels users can pick when requesting a manual top-up.
            Add, edit, disable, or reorder methods — changes appear instantly on the
            wallet page.
          </p>
        </div>
        <Button className="gap-2" onClick={() => setEditing(emptyForm())}>
          <Plus className="h-4 w-4" /> New method
        </Button>
      </header>

      {listQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : methods.length === 0 ? (
        <div className="rounded-md border border-dashed border-arena-border px-4 py-8 text-center text-sm text-muted-foreground">
          No payment methods configured. Add one to let users request top-ups.
        </div>
      ) : (
        <ul className="divide-y divide-arena-border/60 rounded-lg border border-arena-border">
          {methods.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-start gap-3 px-4 py-3"
            >
              <div className="mt-0.5">
                <div className="rounded-md border border-arena-border bg-arena-surface/40 p-2">
                  <CreditCard className="h-4 w-4 text-arena-violet" />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-white">{m.label}</span>
                  <Badge
                    variant="outline"
                    className="border-arena-border/60 text-[10px] uppercase tracking-wider text-muted-foreground"
                  >
                    {m.code}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="border-arena-border/60 text-[10px] uppercase tracking-wider text-muted-foreground"
                  >
                    {KIND_LABELS[m.kind]}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">
                    order {m.sort_order}
                  </span>
                  {m.enabled ? (
                    <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-300">
                      Enabled
                    </Badge>
                  ) : (
                    <Badge className="border-muted bg-muted text-muted-foreground">
                      Disabled
                    </Badge>
                  )}
                </div>
                {m.description && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {m.description}
                  </p>
                )}
                {Object.keys(m.config ?? {}).length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {Object.entries(m.config).map(([k, v]) => (
                      <span
                        key={k}
                        className="rounded border border-arena-border/60 bg-arena-surface/40 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      >
                        <span className="text-white/80">{k}:</span>{" "}
                        {String(v).slice(0, 40)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="arenaOutline"
                  size="sm"
                  className="gap-1"
                  disabled={toggleMutation.isPending}
                  onClick={() => toggleMutation.mutate(m)}
                >
                  {m.enabled ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                  {m.enabled ? "Disable" : "Enable"}
                </Button>
                <Button
                  variant="arenaOutline"
                  size="sm"
                  className="gap-1"
                  onClick={() => setEditing(toForm(m))}
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
                <Button
                  variant="arenaOutline"
                  size="sm"
                  className="gap-1 text-rose-300 hover:text-rose-200"
                  onClick={() => setConfirmDelete(m)}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <MethodEditorDialog
        state={editing}
        onChange={setEditing}
        onSave={(f) => upsertMutation.mutate(f)}
        saving={upsertMutation.isPending}
      />

      <Dialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete payment method?</DialogTitle>
            <DialogDescription>
              "{confirmDelete?.label}" will be removed. Past top-up requests keep
              their reference to it as null.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="arenaOutline"
              onClick={() => setConfirmDelete(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() =>
                confirmDelete && deleteMutation.mutate(confirmDelete.id)
              }
            >
              {deleteMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function MethodEditorDialog({
  state,
  onChange,
  onSave,
  saving,
}: {
  state: FormState | null;
  onChange: (s: FormState | null) => void;
  onSave: (f: FormState) => void;
  saving: boolean;
}) {
  const open = !!state;
  const isNew = !state?.id;

  const disabled = useMemo(() => {
    if (!state) return true;
    return !state.code.trim() || !state.label.trim();
  }, [state]);

  if (!state) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && onChange(null)}>
        <DialogContent />
      </Dialog>
    );
  }

  const patch = (p: Partial<FormState>) => onChange({ ...state, ...p });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onChange(null)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? "New payment method" : "Edit payment method"}</DialogTitle>
          <DialogDescription>
            These fields shape the tile users see on the top-up page.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pm-code">Code</Label>
              <Input
                id="pm-code"
                value={state.code}
                onChange={(e) => patch({ code: e.target.value })}
                placeholder="bkash"
                disabled={!isNew}
              />
              <p className="text-[10px] text-muted-foreground">
                Stable identifier, lowercase.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pm-label">Label</Label>
              <Input
                id="pm-label"
                value={state.label}
                onChange={(e) => patch({ label: e.target.value })}
                placeholder="bKash"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pm-kind">Kind</Label>
              <Select
                value={state.kind}
                onValueChange={(v) => patch({ kind: v as TopupMethodKind })}
              >
                <SelectTrigger id="pm-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(KIND_LABELS) as TopupMethodKind[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pm-icon">Icon (Lucide name)</Label>
              <Input
                id="pm-icon"
                value={state.icon}
                onChange={(e) => patch({ icon: e.target.value })}
                placeholder="Smartphone"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pm-desc">Short description</Label>
            <Textarea
              id="pm-desc"
              rows={2}
              value={state.description}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder="Shown under the tile on the top-up page."
              maxLength={300}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pm-instr">Instructions</Label>
            <Textarea
              id="pm-instr"
              rows={3}
              value={state.instructions}
              onChange={(e) => patch({ instructions: e.target.value })}
              placeholder="Longer guidance shown once the user selects this method."
              maxLength={2000}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pm-ref">Reference placeholder</Label>
              <Input
                id="pm-ref"
                value={state.reference_placeholder}
                onChange={(e) => patch({ reference_placeholder: e.target.value })}
                placeholder="Transaction ID"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pm-order">Sort order</Label>
              <Input
                id="pm-order"
                type="number"
                min={0}
                max={9999}
                value={state.sort_order}
                onChange={(e) =>
                  patch({ sort_order: Number.parseInt(e.target.value || "0", 10) })
                }
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-arena-border px-3 py-2">
            <div>
              <div className="text-sm font-semibold text-white">Enabled</div>
              <div className="text-[11px] text-muted-foreground">
                Disabled methods stay in history but don't appear on the top-up form.
              </div>
            </div>
            <Switch
              checked={state.enabled}
              onCheckedChange={(v) => patch({ enabled: v })}
            />
          </div>

          <ConfigEditor
            fields={state.config}
            onChange={(config) => patch({ config })}
          />
        </div>

        <DialogFooter>
          <Button variant="arenaOutline" onClick={() => onChange(null)}>
            Cancel
          </Button>
          <Button
            className="gap-2"
            disabled={disabled || saving}
            onClick={() => onSave(state)}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConfigEditor({
  fields,
  onChange,
}: {
  fields: ConfigField[];
  onChange: (f: ConfigField[]) => void;
}) {
  const add = () => onChange([...fields, { key: "", value: "" }]);
  const update = (i: number, patch: Partial<ConfigField>) =>
    onChange(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const remove = (i: number) => onChange(fields.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2 rounded-md border border-arena-border p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-white">
            Custom fields
          </div>
          <div className="text-[11px] text-muted-foreground">
            Extra details shown to users (e.g. bank account, wallet number).
          </div>
        </div>
        <Button
          type="button"
          variant="arenaOutline"
          size="sm"
          onClick={add}
          className="gap-1"
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>
      {fields.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No custom fields.</p>
      ) : (
        <ul className="space-y-1.5">
          {fields.map((f, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <Input
                value={f.key}
                onChange={(e) => update(i, { key: e.target.value })}
                placeholder="Label (e.g. Account #)"
                className="h-8 text-xs"
              />
              <Input
                value={f.value}
                onChange={(e) => update(i, { value: e.target.value })}
                placeholder="Value"
                className="h-8 text-xs"
              />
              <Button
                type="button"
                variant="arenaOutline"
                size="sm"
                onClick={() => remove(i)}
                className="h-8 px-2"
                aria-label="Remove field"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
