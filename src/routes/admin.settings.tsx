import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Plus, ShieldCheck, Trash2, Save, Mail, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  getAdminAllowlist,
  updateAdminAllowlist,
  listAdminAuditLog,
  type AuditLogEntry,
} from "@/lib/admin-settings.functions";
import {
  AdminEmptyBlock,
  AdminErrorBlock,
  AdminLoadingBlock,
} from "@/components/admin/AdminStates";

// Access control: the parent `/admin` route's `beforeLoad` guard runs before
// every /admin/* child, so this page inherits admin-only access automatically.
export const Route = createFileRoute("/admin/settings")({
  component: AdminSettingsPage,
});

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function AdminSettingsPage() {
  const qc = useQueryClient();
  const getFn = useServerFn(getAdminAllowlist);
  const saveFn = useServerFn(updateAdminAllowlist);
  const auditFn = useServerFn(listAdminAuditLog);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "allowlist"],
    queryFn: () => getFn(),
  });

  const auditQuery = useQuery({
    queryKey: ["admin", "audit_log", "app_settings"],
    queryFn: () => auditFn({ data: { target_table: "app_settings", limit: 50 } }),
  });

  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (data) setEmails(data.emails);
  }, [data]);

  const normalized = useMemo(
    () => emails.map((e) => e.trim().toLowerCase()).filter(Boolean),
    [emails],
  );
  const dirty = useMemo(() => {
    const original = (data?.emails ?? []).slice().sort().join(",");
    const next = normalized.slice().sort().join(",");
    return original !== next;
  }, [data, normalized]);

  const addEmail = () => {
    const value = draft.trim().toLowerCase();
    if (!value) return;
    if (!emailPattern.test(value)) {
      toast.error("Enter a valid email address");
      return;
    }
    if (normalized.includes(value)) {
      toast.info("Already on the allowlist");
      setDraft("");
      return;
    }
    setEmails((prev) => [...prev, value]);
    setDraft("");
  };

  const removeEmail = (email: string) => {
    setEmails((prev) => prev.filter((e) => e !== email));
  };

  const saveMutation = useMutation({
    mutationFn: () => saveFn({ data: { emails: normalized } }),
    onSuccess: (result) => {
      toast.success("Allowlist saved");
      qc.setQueryData(["admin", "allowlist"], result);
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      qc.invalidateQueries({ queryKey: ["admin", "audit_log", "app_settings"] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Manage backend configuration for the admin console.
        </p>
      </div>

      <section className="arena-card rounded-xl">
        <header className="flex items-start justify-between gap-4 border-b border-arena-border p-5">
          <div>
            <h3 className="flex items-center gap-2 font-display text-base font-bold">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Admin bootstrap allowlist
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Any user who signs up (or verifies) with one of these emails is
              automatically granted the <code className="rounded bg-arena-panel-2 px-1">admin</code> role.
              The very first sign-up always becomes admin regardless of this list.
            </p>
          </div>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!dirty || saveMutation.isPending || isLoading}
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save changes
          </Button>
        </header>

        <div className="space-y-4 p-5">
          {isLoading ? (
            <AdminLoadingBlock label="Loading settings…" />
          ) : error ? (
            <AdminErrorBlock
              message={error instanceof Error ? error.message : "Failed to load settings"}
            />
          ) : (
            <>
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="name@company.com"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addEmail();
                    }
                  }}
                  className="max-w-sm"
                />
                <Button variant="arenaOutline" onClick={addEmail}>
                  <Plus className="h-4 w-4" /> Add
                </Button>
              </div>

              {normalized.length === 0 ? (
                <AdminEmptyBlock
                  icon={Mail}
                  title="No emails in the allowlist"
                  description="Anyone signing up with a listed email is auto-granted admin."
                />
              ) : (
                <ul className="divide-y divide-arena-border rounded-md border border-arena-border">
                  {normalized.map((email) => (
                    <li
                      key={email}
                      className="flex items-center justify-between gap-3 px-4 py-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">admin</Badge>
                        <span className="text-sm">{email}</span>
                      </div>
                      <Button
                        size="sm"
                        variant="arenaGhost"
                        onClick={() => removeEmail(email)}
                        aria-label={`Remove ${email}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              {data?.updated_at && (
                <p className="text-xs text-muted-foreground">
                  Last updated {new Date(data.updated_at).toLocaleString()}
                </p>
              )}
            </>
          )}
        </div>
      </section>

      <AuditLogSection
        entries={auditQuery.data ?? []}
        isLoading={auditQuery.isLoading}
        error={auditQuery.error}
      />
    </div>
  );
}

function AuditLogSection({
  entries,
  isLoading,
  error,
}: {
  entries: AuditLogEntry[];
  isLoading: boolean;
  error: unknown;
}) {
  return (
    <section className="arena-card rounded-xl">
      <header className="border-b border-arena-border p-5">
        <h3 className="font-display text-base font-bold">Audit log</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Recent admin changes to backend settings. Most recent 50 entries.
        </p>
      </header>
      <div className="p-5">
        {isLoading ? (
          <AdminLoadingBlock label="Loading audit log…" />
        ) : error ? (
          <AdminErrorBlock
            message={error instanceof Error ? error.message : "Failed to load audit log"}
          />
        ) : entries.length === 0 ? (
          <AdminEmptyBlock
            icon={ScrollText}
            title="No admin changes recorded"
            description="Grants, revokes, and setting edits will appear here."
          />
        ) : (
          <ul className="divide-y divide-arena-border rounded-md border border-arena-border">
            {entries.map((e) => {
              const after = (e.after ?? {}) as {
                added?: string[];
                removed?: string[];
              };
              return (
                <li key={e.id} className="space-y-1 px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{e.action}</Badge>
                      <span className="font-medium">
                        {e.actor_email ?? e.actor_id ?? "unknown admin"}
                      </span>
                    </div>
                    <time className="text-xs text-muted-foreground">
                      {new Date(e.created_at).toLocaleString()}
                    </time>
                  </div>
                  {(after.added?.length || after.removed?.length) ? (
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {after.added?.length ? (
                        <span>
                          <span className="text-emerald-500">+</span> {after.added.join(", ")}
                        </span>
                      ) : null}
                      {after.removed?.length ? (
                        <span>
                          <span className="text-destructive">−</span> {after.removed.join(", ")}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
