import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Eye,
  Clock,
  BadgeCheck,
  Ban,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  adminListTopups,
  adminApproveTopup,
  adminRejectTopup,
  adminGetTopupProofUrl,
  type AdminTopupRow,
} from "@/lib/admin-topups.functions";
import type { TopupStatus } from "@/lib/topups.functions";

export const Route = createFileRoute("/admin/topups")({
  component: AdminTopupsPage,
});

type FilterStatus = TopupStatus | "all";

const STATUS_META: Record<
  TopupStatus,
  { label: string; tone: string; icon: React.ComponentType<{ className?: string }> }
> = {
  pending: {
    label: "Pending",
    tone: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    icon: Clock,
  },
  approved: {
    label: "Approved",
    tone: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    icon: BadgeCheck,
  },
  rejected: {
    label: "Rejected",
    tone: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    icon: XCircle,
  },
  cancelled: {
    label: "Cancelled",
    tone: "bg-muted text-muted-foreground border-arena-border",
    icon: Ban,
  },
};

function fmt(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function AdminTopupsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(adminListTopups);
  const approveFn = useServerFn(adminApproveTopup);
  const rejectFn = useServerFn(adminRejectTopup);
  const proofFn = useServerFn(adminGetTopupProofUrl);

  const [status, setStatus] = useState<FilterStatus>("pending");
  const [decision, setDecision] = useState<{
    row: AdminTopupRow;
    action: "approve" | "reject";
  } | null>(null);
  const [adminNote, setAdminNote] = useState("");
  const [proofOpen, setProofOpen] = useState<AdminTopupRow | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofLoading, setProofLoading] = useState(false);

  const listQuery = useQuery({
    queryKey: ["admin", "topups", status],
    queryFn: () => listFn({ data: { status } }),
    staleTime: 5_000,
    refetchInterval: 15_000,
  });

  const approveMutation = useMutation({
    mutationFn: (v: { id: string; adminNote?: string }) =>
      approveFn({ data: { id: v.id, adminNote: v.adminNote } }),
    onSuccess: () => {
      toast.success("Top-up approved and credited");
      setDecision(null);
      setAdminNote("");
      void qc.invalidateQueries({ queryKey: ["admin", "topups"] });
      void qc.invalidateQueries({ queryKey: ["wallet"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Approval failed"),
  });

  const rejectMutation = useMutation({
    mutationFn: (v: { id: string; adminNote?: string }) =>
      rejectFn({ data: { id: v.id, adminNote: v.adminNote } }),
    onSuccess: () => {
      toast.success("Top-up rejected");
      setDecision(null);
      setAdminNote("");
      void qc.invalidateQueries({ queryKey: ["admin", "topups"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Reject failed"),
  });

  const openProof = async (row: AdminTopupRow) => {
    setProofOpen(row);
    setProofUrl(null);
    if (!row.proof_path) return;
    setProofLoading(true);
    try {
      const { url } = await proofFn({ data: { id: row.id } });
      setProofUrl(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load proof");
    } finally {
      setProofLoading(false);
    }
  };

  const rows = listQuery.data ?? [];
  const pending = approveMutation.isPending || rejectMutation.isPending;

  return (
    <section className="arena-card space-y-4 rounded-2xl p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Wallet operations
          </div>
          <h2 className="mt-1 font-display text-xl font-extrabold uppercase tracking-tight text-white">
            Payment requests
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Review, approve, or reject user top-up requests. Approving credits the
            user's wallet instantly and notifies them.
          </p>
        </div>
        <Button
          variant="arenaOutline"
          size="sm"
          className="gap-2"
          onClick={() => listQuery.refetch()}
          disabled={listQuery.isFetching}
        >
          <RefreshCw
            className={"h-3.5 w-3.5 " + (listQuery.isFetching ? "animate-spin" : "")}
          />
          Refresh
        </Button>
      </header>

      <Tabs value={status} onValueChange={(v) => setStatus(v as FilterStatus)}>
        <TabsList className="flex flex-wrap gap-1">
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
          <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      {listQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : listQuery.isError ? (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {listQuery.error instanceof Error
            ? listQuery.error.message
            : "Failed to load top-up requests"}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-arena-border px-4 py-10 text-center text-sm text-muted-foreground">
          No {status === "all" ? "" : status} top-up requests.
        </div>
      ) : (
        <ul className="divide-y divide-arena-border/60 rounded-lg border border-arena-border">
          {rows.map((r) => {
            const meta = STATUS_META[r.status];
            const Icon = meta.icon;
            return (
              <li key={r.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-lg font-extrabold text-white">
                      {fmt(r.amount_cents)}
                    </span>
                    <Badge className={"gap-1 " + meta.tone}>
                      <Icon className="h-3 w-3" />
                      {meta.label}
                    </Badge>
                    {r.payment_method_label && (
                      <Badge
                        variant="outline"
                        className="border-arena-border/60 text-[10px] uppercase tracking-wider text-muted-foreground"
                      >
                        {r.payment_method_label}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span className="text-white/90">
                      {r.user_display_name ?? r.user_email ?? r.user_id.slice(0, 8)}
                    </span>
                    {r.user_email && r.user_display_name && (
                      <span> · {r.user_email}</span>
                    )}
                    <span> · {fmtDate(r.created_at)}</span>
                  </div>
                  {r.reference && (
                    <div className="text-[11px] text-muted-foreground">
                      Ref: <span className="text-white/80">{r.reference}</span>
                    </div>
                  )}
                  {r.user_note && (
                    <div className="text-[11px] text-muted-foreground">
                      Note: <span className="text-white/80">{r.user_note}</span>
                    </div>
                  )}
                  {r.admin_note && (
                    <div className="text-[11px] text-muted-foreground">
                      Admin: <span className="text-white/80">{r.admin_note}</span>
                    </div>
                  )}
                  {r.processed_at && r.status !== "pending" && (
                    <div className="text-[11px] text-muted-foreground">
                      Processed: {fmtDate(r.processed_at)}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {r.proof_path && (
                    <Button
                      variant="arenaOutline"
                      size="sm"
                      className="gap-1"
                      onClick={() => openProof(r)}
                    >
                      <Eye className="h-3.5 w-3.5" /> Proof
                    </Button>
                  )}
                  {r.status === "pending" && (
                    <>
                      <Button
                        size="sm"
                        className="gap-1 bg-emerald-600 text-white hover:bg-emerald-500"
                        onClick={() => {
                          setAdminNote("");
                          setDecision({ row: r, action: "approve" });
                        }}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="gap-1"
                        onClick={() => {
                          setAdminNote("");
                          setDecision({ row: r, action: "reject" });
                        }}
                      >
                        <XCircle className="h-3.5 w-3.5" /> Reject
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={!!decision}
        onOpenChange={(o) => {
          if (!o) setDecision(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {decision?.action === "approve" ? "Approve top-up" : "Reject top-up"}
            </DialogTitle>
            <DialogDescription>
              {decision?.action === "approve" ? (
                <>
                  Credit <b>{decision ? fmt(decision.row.amount_cents) : ""}</b> to{" "}
                  <b>
                    {decision?.row.user_display_name ??
                      decision?.row.user_email ??
                      "user"}
                  </b>
                  . This action is logged and notifies the user.
                </>
              ) : (
                <>
                  Reject this request. The user is notified with your note. No funds
                  are moved.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="admin-note">
              Admin note {decision?.action === "reject" ? "(shown to user)" : "(optional)"}
            </Label>
            <Textarea
              id="admin-note"
              rows={3}
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
              placeholder={
                decision?.action === "approve"
                  ? "Confirmed via bank transaction #…"
                  : "Explain why this request is being rejected."
              }
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button variant="arenaOutline" onClick={() => setDecision(null)}>
              Cancel
            </Button>
            {decision?.action === "approve" ? (
              <Button
                className="gap-2 bg-emerald-600 text-white hover:bg-emerald-500"
                disabled={pending}
                onClick={() =>
                  decision &&
                  approveMutation.mutate({
                    id: decision.row.id,
                    adminNote: adminNote.trim() || undefined,
                  })
                }
              >
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                <Wallet className="h-4 w-4" /> Approve & credit
              </Button>
            ) : (
              <Button
                variant="destructive"
                className="gap-2"
                disabled={pending}
                onClick={() =>
                  decision &&
                  rejectMutation.mutate({
                    id: decision.row.id,
                    adminNote: adminNote.trim() || undefined,
                  })
                }
              >
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                <XCircle className="h-4 w-4" /> Reject
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!proofOpen}
        onOpenChange={(o) => {
          if (!o) {
            setProofOpen(null);
            setProofUrl(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Payment proof</DialogTitle>
            <DialogDescription>
              {proofOpen ? fmt(proofOpen.amount_cents) : ""} ·{" "}
              {proofOpen?.user_display_name ?? proofOpen?.user_email ?? ""}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-[200px]">
            {proofLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading proof…
              </div>
            ) : proofUrl ? (
              proofUrl.toLowerCase().includes(".pdf") ? (
                <iframe
                  src={proofUrl}
                  title="Payment proof"
                  className="h-[60vh] w-full rounded-md border border-arena-border"
                />
              ) : (
                <img
                  src={proofUrl}
                  alt="Payment proof"
                  className="max-h-[60vh] w-full rounded-md border border-arena-border object-contain"
                />
              )
            ) : (
              <div className="text-sm text-muted-foreground">No proof attached.</div>
            )}
          </div>
          <DialogFooter>
            {proofUrl && (
              <a
                href={proofUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-arena-violet hover:underline"
              >
                Open in new tab
              </a>
            )}
            <Button variant="arenaOutline" onClick={() => setProofOpen(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
