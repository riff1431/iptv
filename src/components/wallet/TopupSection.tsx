import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Loader2,
  Landmark,
  Smartphone,
  Coins,
  MoreHorizontal,
  CreditCard,
  Clock,
  XCircle,
  BadgeCheck,
  Ban,
  Plus,
  Paperclip,
  X,
  FileText,
  Eye,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThumbHeader } from "@/components/ThumbFallback";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAutoMarkReadOnDeepLink } from "@/lib/wallet-preferences";
import { trackEvent } from "@/lib/analytics";
import {
  createTopup,
  cancelTopup,
  listOwnTopups,
  getTopupProofUrl,
  TOPUP_MIN_CENTS,
  TOPUP_MAX_CENTS,
  TOPUP_PROOF_BUCKET,
  TOPUP_PROOF_MAX_BYTES,
  type TopupMethod,
  type TopupRequest,
  type TopupStatus,
} from "@/lib/topups.functions";
import {
  listEnabledPaymentMethods,
  type PaymentMethod,
} from "@/lib/payment-methods.functions";

function fmt(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

const KIND_FALLBACK_ICON: Record<TopupMethod, LucideIcon> = {
  bank_transfer: Landmark,
  mobile_money: Smartphone,
  cash: Coins,
  other: MoreHorizontal,
};

const PAYMENT_ICONS: Record<string, LucideIcon> = {
  Landmark,
  Smartphone,
  Coins,
  MoreHorizontal,
  CreditCard,
};

function resolveIcon(m: Pick<PaymentMethod, "icon" | "kind">): LucideIcon {
  if (m.icon) {
    const found = PAYMENT_ICONS[m.icon];
    if (found) return found;
  }
  return KIND_FALLBACK_ICON[m.kind] ?? CreditCard;
}

const STATUS_META: Record<
  TopupStatus,
  { label: string; tone: string; icon: React.ComponentType<{ className?: string }> }
> = {
  pending: {
    label: "Pending review",
    tone: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    icon: Clock,
  },
  approved: {
    label: "Approved · credited",
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

export function TopupSection() {
  const qc = useQueryClient();
  const listFn = useServerFn(listOwnTopups);
  const createFn = useServerFn(createTopup);
  const cancelFn = useServerFn(cancelTopup);
  const methodsFn = useServerFn(listEnabledPaymentMethods);

  const listQuery = useQuery({
    queryKey: ["wallet", "topups"],
    queryFn: () => listFn(),
    staleTime: 5_000,
  });

  const methodsQuery = useQuery({
    queryKey: ["wallet", "payment_methods"],
    queryFn: () => methodsFn(),
    staleTime: 30_000,
  });

  const methods = methodsQuery.data ?? [];
  const methodsById = new Map(methods.map((m) => [m.id, m]));

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("25.00");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Default the selection to the first enabled method as they load.
  useEffect(() => {
    if (!selectedId && methods.length > 0) setSelectedId(methods[0].id);
    if (selectedId && !methodsById.has(selectedId) && methods.length > 0) {
      setSelectedId(methods[0].id);
    }
  }, [methods, selectedId, methodsById]);

  // Deep-link support: /wallet?topup=<id> scrolls to and highlights the row.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [deepLinkId, setDeepLinkId] = useState<string | null>(null);
  const scrolledForRef = useRef<string | null>(null);
  const markedForRef = useRef<string | null>(null);
  const [autoMarkRead] = useAutoMarkReadOnDeepLink();
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = new URLSearchParams(window.location.search).get("topup");
    setDeepLinkId(id);
  }, []);
  const deepLinkPending =
    !!deepLinkId &&
    scrolledForRef.current !== deepLinkId &&
    (listQuery.isLoading || listQuery.isFetching);

  // Scroll + highlight (runs once per deep-link id).
  useEffect(() => {
    if (!deepLinkId) return;
    if (listQuery.isLoading || listQuery.isFetching) return;
    if (scrolledForRef.current === deepLinkId) return;
    const rows = listQuery.data ?? [];
    const match = rows.find((r) => r.id === deepLinkId);
    if (!match) {
      scrolledForRef.current = deepLinkId;
      toast.info("That top-up request couldn't be found", {
        description: "It may have been removed, or the link is for a different account.",
      });
      return;
    }
    scrolledForRef.current = deepLinkId;
    setHighlightId(deepLinkId);
    requestAnimationFrame(() => {
      const el = document.getElementById(`topup-${deepLinkId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const t = window.setTimeout(() => setHighlightId(null), 3200);
    return () => window.clearTimeout(t);
  }, [deepLinkId, listQuery.data, listQuery.isLoading, listQuery.isFetching]);

  // Mark related notifications as read. Re-runs when the toggle flips on,
  // so the change takes effect immediately without needing a page refresh.
  useEffect(() => {
    if (!deepLinkId) return;
    if (!autoMarkRead) {
      // Reset so re-enabling the toggle will mark them again.
      markedForRef.current = null;
      return;
    }
    if (listQuery.isLoading || listQuery.isFetching) return;
    const rows = listQuery.data ?? [];
    const match = rows.find((r) => r.id === deepLinkId);
    if (!match) return;
    if (markedForRef.current === deepLinkId) return;
    markedForRef.current = deepLinkId;
    void (async () => {
      const { data: sess } = await supabase.auth.getUser();
      const uid = sess.user?.id;
      if (!uid) return;
      const { data: updated, error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("user_id", uid)
        .eq("kind", "wallet")
        .is("read_at", null)
        .like("link", `%topup=${deepLinkId}%`)
        .select("id, title");
      if (!error && updated && updated.length > 0) {
        const shortId = deepLinkId.slice(0, 8);
        const titles = updated
          .map((u) => (u as { title?: string | null }).title)
          .filter((t): t is string => !!t);
        const uniqueTitles = Array.from(new Set(titles));
        const description =
          uniqueTitles.length > 0
            ? `${uniqueTitles.slice(0, 2).join(" · ")}${uniqueTitles.length > 2 ? ` +${uniqueTitles.length - 2} more` : ""} · Top-up ${fmt(match.amount_cents)} (#${shortId})`
            : `Top-up ${fmt(match.amount_cents)} (#${shortId})`;
        trackEvent("wallet.deep_link.auto_mark_read", {
          topup_id: deepLinkId,
          count: updated.length,
          amount_cents: match.amount_cents,
        });
        toast.success(
          updated.length === 1
            ? "1 notification marked as read"
            : `${updated.length} notifications marked as read`,
          { description },
        );
      }
    })();
  }, [
    deepLinkId,
    autoMarkRead,
    listQuery.data,
    listQuery.isLoading,
    listQuery.isFetching,
  ]);

  const selected = selectedId ? methodsById.get(selectedId) ?? null : null;


  const ALLOWED_PROOF_EXT = new Set([
    "jpg",
    "jpeg",
    "png",
    "webp",
    "gif",
    "heic",
    "heif",
    "pdf",
  ]);
  const ALLOWED_PROOF_MIME = /^(image\/(jpe?g|png|webp|gif|heic|heif)|application\/pdf)$/i;

  const handlePickProof = (file: File | null) => {
    setProofError(null);
    if (!file) {
      setProofFile(null);
      return;
    }
    if (file.size === 0) {
      setProofError("File is empty. Pick another file.");
      return;
    }
    if (file.size > TOPUP_PROOF_MAX_BYTES) {
      const mb = (TOPUP_PROOF_MAX_BYTES / (1024 * 1024)).toFixed(0);
      setProofError(
        `File is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Max ${mb} MB.`,
      );
      return;
    }
    if (file.name.length > 200) {
      setProofError("Filename is too long. Rename it and try again.");
      return;
    }
    const ext = file.name.includes(".")
      ? file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase()
      : "";
    const mimeOk = file.type ? ALLOWED_PROOF_MIME.test(file.type) : false;
    const extOk = ext ? ALLOWED_PROOF_EXT.has(ext) : false;
    if (!mimeOk && !extOk) {
      setProofError("Only image files (JPG, PNG, WEBP, GIF, HEIC) or PDFs are allowed.");
      return;
    }
    setProofFile(file);
  };

  const resetForm = () => {
    setReference("");
    setNote("");
    setProofFile(null);
    setProofError(null);
  };

  // Upload with retry: retries transient failures up to 2 times with backoff.
  const uploadProofWithRetry = async (uid: string, file: File): Promise<string> => {
    const ext = file.name.includes(".")
      ? file.name.slice(file.name.lastIndexOf("."))
      : "";
    const path = `${uid}/${Date.now()}-${crypto.randomUUID()}${ext}`;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error: upErr } = await supabase.storage
        .from(TOPUP_PROOF_BUCKET)
        .upload(path, file, {
          contentType: file.type || undefined,
          upsert: false,
        });
      if (!upErr) return path;
      lastErr = upErr;
      const msg = String(upErr.message ?? "").toLowerCase();
      // Non-retryable: auth/permission/policy/duplicate/quota problems.
      if (
        msg.includes("row-level security") ||
        msg.includes("unauthorized") ||
        msg.includes("permission") ||
        msg.includes("duplicate") ||
        msg.includes("already exists") ||
        msg.includes("payload too large") ||
        msg.includes("quota")
      ) {
        break;
      }
      // Transient (network/5xx): back off and retry.
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
    const message =
      lastErr && typeof lastErr === "object" && "message" in lastErr
        ? String((lastErr as { message: unknown }).message)
        : "Unknown upload error";
    throw new Error(message);
  };

  const runCreate = async () => {
    if (!selected) throw new Error("Choose a payment method");
    const dollars = Number.parseFloat(amount);
    if (!Number.isFinite(dollars) || dollars <= 0) throw new Error("Enter a valid amount");
    const cents = Math.round(dollars * 100);
    if (cents < TOPUP_MIN_CENTS)
      throw new Error(`Minimum top-up is ${fmt(TOPUP_MIN_CENTS)}`);
    if (cents > TOPUP_MAX_CENTS)
      throw new Error(`Maximum top-up is ${fmt(TOPUP_MAX_CENTS)}`);

    let proofPath: string | undefined;
    if (proofFile) {
      setUploading(true);
      try {
        const { data: sess } = await supabase.auth.getUser();
        const uid = sess.user?.id;
        if (!uid) throw new Error("You must be signed in");
        try {
          proofPath = await uploadProofWithRetry(uid, proofFile);
        } catch (e) {
          const raw = e instanceof Error ? e.message : String(e);
          const lower = raw.toLowerCase();
          if (lower.includes("row-level security") || lower.includes("permission")) {
            throw new Error("You don't have permission to upload this file.");
          }
          if (lower.includes("payload too large") || lower.includes("quota")) {
            throw new Error("File exceeds the server upload limit.");
          }
          if (lower.includes("failed to fetch") || lower.includes("network")) {
            throw new Error("Network error while uploading proof. Check your connection.");
          }
          throw new Error(`Proof upload failed: ${raw}`);
        }
      } finally {
        setUploading(false);
      }
    }

    return createFn({
      data: {
        amountCents: cents,
        paymentMethodId: selected.id,
        reference: reference.trim() || undefined,
        userNote: note.trim() || undefined,
        proofPath,
      },
    });
  };

  const createMutation = useMutation({
    mutationFn: runCreate,
    onSuccess: () => {
      toast.success("Top-up request submitted", {
        description: "A reviewer will credit your wallet once payment is verified.",
      });
      setOpen(false);
      resetForm();
      void qc.invalidateQueries({ queryKey: ["wallet"] });
    },
    onError: (err) => {
      const raw = err instanceof Error ? err.message : "Top-up request failed";
      const lower = raw.toLowerCase();
      const isValidation =
        lower.includes("minimum") ||
        lower.includes("maximum") ||
        lower.includes("valid amount") ||
        lower.includes("choose a payment") ||
        lower.includes("signed in");
      const isUpload = lower.includes("upload") || lower.includes("proof");
      const title = isValidation
        ? raw
        : isUpload
          ? "Couldn't upload proof"
          : "Top-up request failed";
      const description = isValidation
        ? undefined
        : isUpload
          ? raw
          : `${raw}. Please try again in a moment.`;
      toast.error(title, {
        description,
        action: isValidation
          ? undefined
          : {
              label: "Retry",
              onClick: () => createMutation.mutate(),
            },
      });
    },
  });


  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Top-up request cancelled");
      void qc.invalidateQueries({ queryKey: ["wallet", "topups"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not cancel"),
  });

  const dollars = Number.parseFloat(amount);
  const centsPreview = Number.isFinite(dollars) ? Math.round(dollars * 100) : 0;
  const outOfRange = centsPreview < TOPUP_MIN_CENTS || centsPreview > TOPUP_MAX_CENTS;
  const noMethods = !methodsQuery.isLoading && methods.length === 0;

  return (
    <section className="arena-card space-y-4 rounded-xl p-4 sm:p-5">
      <ThumbHeader icon={CreditCard} label="Top up wallet" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Top up wallet (manual)
          </div>
          <p className="text-xs text-muted-foreground">
            Pick a payment method configured by the operators, send the funds, then
            file a request. A reviewer credits your wallet once payment is confirmed.
          </p>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" disabled={noMethods}>
              <Plus className="h-4 w-4" /> Request top-up
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Request a top-up</DialogTitle>
              <DialogDescription>
                Minimum {fmt(TOPUP_MIN_CENTS)}, maximum {fmt(TOPUP_MAX_CENTS)} per request. Your
                wallet is credited only after a reviewer approves the request.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="tu-amount">Amount (USD)</Label>
                <Input
                  id="tu-amount"
                  type="number"
                  step="0.01"
                  min={(TOPUP_MIN_CENTS / 100).toString()}
                  max={(TOPUP_MAX_CENTS / 100).toString()}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <div className="flex items-center justify-between text-[11px]">
                  <span className={outOfRange ? "text-rose-400" : "text-muted-foreground"}>
                    {outOfRange
                      ? `Enter ${fmt(TOPUP_MIN_CENTS)} – ${fmt(TOPUP_MAX_CENTS)}`
                      : `You'll request ${fmt(centsPreview)}`}
                  </span>
                  <div className="flex gap-1">
                    {[10, 25, 50, 100].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setAmount(v.toFixed(2))}
                        className="rounded border border-arena-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground hover:text-white"
                      >
                        ${v}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Payment method</Label>
                {methodsQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading methods…
                  </div>
                ) : methods.length === 0 ? (
                  <div className="rounded-md border border-dashed border-arena-border px-3 py-4 text-center text-xs text-muted-foreground">
                    No payment methods are enabled. Ask an admin to enable one under
                    Admin › Payments.
                  </div>
                ) : (
                  <div
                    role="radiogroup"
                    aria-label="Payment method"
                    className="grid grid-cols-2 gap-2"
                  >
                    {methods.map((m) => {
                      const Icon = resolveIcon(m);
                      const isSel = selectedId === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          role="radio"
                          aria-checked={isSel}
                          onClick={() => setSelectedId(m.id)}
                          className={`flex items-start gap-2 rounded-md border px-3 py-2.5 text-left transition ${
                            isSel
                              ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                              : "border-arena-border hover:border-arena-border/80 hover:bg-arena-surface/40"
                          }`}
                        >
                          <Icon
                            className={`mt-0.5 h-4 w-4 shrink-0 ${
                              isSel ? "text-primary" : "text-muted-foreground"
                            }`}
                          />
                          <span className="min-w-0">
                            <span
                              className={`block text-sm font-semibold ${
                                isSel ? "text-white" : "text-white/90"
                              }`}
                            >
                              {m.label}
                            </span>
                            {m.description && (
                              <span className="block text-[11px] leading-tight text-muted-foreground">
                                {m.description}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {selected && (
                <>
                  {selected.instructions && (
                    <div className="rounded-md border border-arena-border/60 bg-arena-surface/40 px-3 py-2 text-[11px] text-muted-foreground">
                      {selected.instructions}
                    </div>
                  )}
                  {Object.keys(selected.config).length > 0 && (
                    <div className="rounded-md border border-arena-border/60 bg-arena-surface/40 px-3 py-2 text-[11px]">
                      <div className="mb-1 font-semibold uppercase tracking-wider text-white/80">
                        Payment details
                      </div>
                      <ul className="space-y-0.5">
                        {Object.entries(selected.config).map(([k, v]) => (
                          <li key={k} className="text-muted-foreground">
                            <span className="text-white/80">{k}:</span> {v}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="tu-ref">Payment reference</Label>
                <Input
                  id="tu-ref"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder={selected?.reference_placeholder ?? "Reference"}
                  maxLength={200}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tu-note">Note (optional)</Label>
                <Textarea
                  id="tu-note"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Anything the reviewer should know"
                  maxLength={500}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tu-proof">Proof of payment (optional)</Label>
                {proofFile ? (
                  <div className="flex items-center gap-2 rounded-md border border-arena-border bg-arena-surface/40 px-2.5 py-2 text-xs">
                    <FileText className="h-4 w-4 shrink-0 text-arena-violet" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-white" title={proofFile.name}>
                        {proofFile.name}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {(proofFile.size / 1024).toFixed(0)} KB · {proofFile.type || "file"}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="arenaOutline"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => handlePickProof(null)}
                      aria-label="Remove attachment"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <label
                    htmlFor="tu-proof"
                    className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-arena-border bg-arena-surface/20 px-3 py-3 text-xs text-muted-foreground transition hover:border-arena-border/80 hover:text-white"
                  >
                    <Paperclip className="h-4 w-4" />
                    <span>Attach screenshot, receipt, or PDF</span>
                  </label>
                )}
                <input
                  id="tu-proof"
                  type="file"
                  accept="image/*,application/pdf"
                  className="sr-only"
                  onChange={(e) => handlePickProof(e.target.files?.[0] ?? null)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Recommended for bank transfer or cash drops. Images or PDF, up to{" "}
                  {(TOPUP_PROOF_MAX_BYTES / (1024 * 1024)).toFixed(0)} MB. Only you and
                  reviewers can see it.
                </p>
                {proofError && (
                  <p className="text-[11px] text-rose-400">{proofError}</p>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button variant="arenaOutline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={
                  createMutation.isPending ||
                  uploading ||
                  outOfRange ||
                  !selected ||
                  noMethods ||
                  !!proofError
                }
                className="gap-2"
              >
                {(createMutation.isPending || uploading) && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {uploading ? "Uploading…" : "Submit request"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {noMethods && (
        <div className="rounded-md border border-dashed border-arena-border px-3 py-3 text-center text-xs text-muted-foreground">
          No payment methods are currently enabled. Manual top-ups are paused until
          an admin enables at least one method.
        </div>
      )}

      <div className="space-y-2">
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Recent top-up requests
        </div>
        {deepLinkPending && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            <span>Looking up your top-up request…</span>
          </div>
        )}
        {listQuery.isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading requests…
          </div>
        ) : (listQuery.data ?? []).length === 0 ? (
          <div className="rounded-md border border-dashed border-arena-border px-3 py-4 text-center text-xs text-muted-foreground">
            No top-up requests yet.
          </div>
        ) : (
          <ul className="divide-y divide-arena-border/60 rounded-md border border-arena-border">
            {listQuery.data!.map((r) => (
              <TopupRow
                key={r.id}
                r={r}
                highlighted={highlightId === r.id}
                methodLabel={
                  (r.payment_method_id && methodsById.get(r.payment_method_id)?.label) ||
                  r.method.replace("_", " ")
                }
                methodIcon={
                  (r.payment_method_id && methodsById.get(r.payment_method_id)
                    ? resolveIcon(methodsById.get(r.payment_method_id)!)
                    : KIND_FALLBACK_ICON[r.method]) ?? CreditCard
                }
                onCancel={() => cancelMutation.mutate(r.id)}
                cancelling={cancelMutation.isPending && cancelMutation.variables === r.id}
              />
            ))}

          </ul>
        )}
      </div>
    </section>
  );
}

function TopupRow({
  r,
  methodLabel,
  methodIcon: MethodIcon,
  onCancel,
  cancelling,
  highlighted,
}: {
  r: TopupRequest;
  methodLabel: string;
  methodIcon: LucideIcon;
  onCancel: () => void;
  cancelling: boolean;
  highlighted?: boolean;
}) {
  const status = STATUS_META[r.status];
  const StatusIcon = status.icon;
  const created = new Date(r.created_at);
  const processed = r.processed_at ? new Date(r.processed_at) : null;

  return (
    <li
      id={`topup-${r.id}`}
      className={`flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm transition-colors ${
        highlighted
          ? "bg-primary/15 ring-1 ring-inset ring-primary/50"
          : ""
      }`}
    >

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display text-base font-bold tabular-nums text-white">
            {fmt(r.amount_cents)}
          </span>
          <Badge variant="outline" className={`gap-1 border ${status.tone}`}>
            <StatusIcon className="h-3 w-3" /> {status.label}
          </Badge>
          <span className="inline-flex items-center gap-1 text-xs capitalize text-muted-foreground">
            <MethodIcon className="h-3 w-3" /> {methodLabel}
          </span>
        </div>
        {r.reference && (
          <div className="mt-0.5 truncate text-xs text-muted-foreground" title={r.reference}>
            Ref: {r.reference}
          </div>
        )}
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          Requested {created.toLocaleString()}
          {processed && ` · Processed ${processed.toLocaleString()}`}
        </div>
        {r.admin_note && (
          <div className="mt-1 rounded border border-arena-border/60 bg-arena-surface/40 px-2 py-1 text-[11px] text-muted-foreground">
            <span className="font-semibold text-white">Reviewer note:</span> {r.admin_note}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {r.proof_path && <ProofButton id={r.id} />}
        {r.status === "pending" && (
          <Button
            variant="arenaOutline"
            size="sm"
            onClick={onCancel}
            disabled={cancelling}
            className="gap-1"
          >
            {cancelling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Ban className="h-3.5 w-3.5" />
            )}
            Cancel
          </Button>
        )}
      </div>
    </li>
  );
}

function ProofButton({ id }: { id: string }) {
  const getUrlFn = useServerFn(getTopupProofUrl);
  const [loading, setLoading] = useState(false);

  const open = async () => {
    setLoading(true);
    try {
      const { url } = await getUrlFn({ data: { id } });
      if (!url) {
        toast.error("Proof file not found");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open proof");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="arenaOutline"
      size="sm"
      className="gap-1"
      onClick={open}
      disabled={loading}
      aria-label="View proof of payment"
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Eye className="h-3.5 w-3.5" />
      )}
      Proof
    </Button>
  );
}
