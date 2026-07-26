import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn as useSF } from "@tanstack/react-start";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Shield,
  User as UserIcon,
  Loader2,
  KeyRound,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  CircleDollarSign,
} from "lucide-react";
import { AdminCreditWalletDialog } from "@/components/admin/AdminCreditWalletDialog";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  listAdminUsers,
  updateUserRole,
  adminSendPasswordReset,
  updateUserMetadata,
  type AdminUserRow,
  type AppRole,
} from "@/lib/admin-users.functions";
import { useAuth } from "@/hooks/useAuth";
import { AdminEmptyRow, AdminLoadingBlock, AdminErrorBlock } from "@/components/admin/AdminStates";

type SortKey = "email" | "display_name" | "last_sign_in_at";
type SortDir = "asc" | "desc";

const usersSearchSchema = z.object({
  q: fallback(z.string(), "").default(""),
  sort: fallback(z.enum(["email", "display_name", "last_sign_in_at"]), "last_sign_in_at").default(
    "last_sign_in_at",
  ),
  dir: fallback(z.enum(["asc", "desc"]), "desc").default("desc"),
});

export const Route = createFileRoute("/admin/users")({
  validateSearch: zodValidator(usersSearchSchema),
  component: AdminUsersPage,
});

const ROLES: AppRole[] = ["admin", "moderator", "user"];

function roleBadge(role: AppRole) {
  if (role === "admin")
    return (
      <Badge key={role} className="gap-1">
        <ShieldCheck className="h-3 w-3" /> admin
      </Badge>
    );
  if (role === "moderator")
    return (
      <Badge key={role} variant="secondary" className="gap-1">
        <Shield className="h-3 w-3" /> moderator
      </Badge>
    );
  return (
    <Badge key={role} variant="outline" className="gap-1">
      <UserIcon className="h-3 w-3" /> user
    </Badge>
  );
}

function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const qc = useQueryClient();
  const listFn = useSF(listAdminUsers);
  const updateFn = useSF(updateUserRole);
  const resetFn = useSF(adminSendPasswordReset);
  const updateMetaFn = useSF(updateUserMetadata);

  const { q, sort, dir } = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/users" });

  const setQ = (value: string) =>
    navigate({
      search: (prev: { q: string; sort: SortKey; dir: SortDir }) => ({ ...prev, q: value }),
      replace: true,
    });
  const toggleSort = (key: SortKey) =>
    navigate({
      search: (prev: { q: string; sort: SortKey; dir: SortDir }) => ({
        ...prev,
        sort: key,
        dir: prev.sort === key && prev.dir === "asc" ? "desc" : "asc",
      }),
      replace: true,
    });

  const {
    data: users = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => listFn(),
  });

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? users.filter(
          (u) =>
            (u.email ?? "").toLowerCase().includes(needle) ||
            (u.display_name ?? "").toLowerCase().includes(needle),
        )
      : users.slice();
    return filtered.sort((a, b) => compareUsers(a, b, sort, dir));
  }, [users, q, sort, dir]);

  const mutation = useMutation({
    mutationFn: (vars: { userId: string; role: AppRole; action: "grant" | "revoke" }) =>
      updateFn({ data: vars }),
    onSuccess: (_d, vars) => {
      toast.success(vars.action === "grant" ? `Granted ${vars.role}` : `Revoked ${vars.role}`);
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to update role";
      toast.error(msg);
    },
  });

  const updateMetaMutation = useMutation({
    mutationFn: (vars: { userId: string; field: "is_creator" | "is_vip"; value: boolean }) =>
      updateMetaFn({ data: vars }),
    onSuccess: (_d, vars) => {
      toast.success(
        vars.value
          ? `Granted ${vars.field === "is_creator" ? "Creator" : "VIP"} status`
          : `Revoked ${vars.field === "is_creator" ? "Creator" : "VIP"} status`,
      );
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to update metadata";
      toast.error(msg);
    },
  });

  const resetMutation = useMutation({
    mutationFn: (email: string) =>
      resetFn({
        data: {
          email,
          redirectTo:
            typeof window !== "undefined" ? `${window.location.origin}/reset-password` : undefined,
        },
      }),
    onSuccess: (_d, email) => toast.success(`Password reset email sent to ${email}`),
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Failed to send reset email"),
  });

  return (
    <div className="space-y-4">
      <div className="arena-card relative overflow-hidden rounded-xl p-6">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[image:var(--gradient-arena-glow)] opacity-60" />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="arena-eyebrow">PGX Control Room</div>
            <h2 className="mt-1 font-display text-3xl font-black uppercase tracking-tight text-arena-gradient">
              Users
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage roles and see email verification status.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search by email or name…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-64"
            />
            <SortControl sort={sort} dir={dir} onSort={toggleSort} />
          </div>
        </div>
      </div>

      <div className="arena-card overflow-hidden rounded-xl">
        {isLoading ? (
          <AdminLoadingBlock label="Loading users…" />
        ) : error ? (
          <AdminErrorBlock
            message={error instanceof Error ? error.message : "Failed to load users"}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-arena-border hover:bg-transparent">
                <TableHead className="arena-th">User</TableHead>
                <TableHead className="arena-th">Email verified</TableHead>
                <TableHead className="arena-th">Last sign-in</TableHead>
                <TableHead className="arena-th">Roles</TableHead>
                <TableHead className="arena-th text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  isSelf={currentUser?.id === u.id}
                  pending={
                    mutation.isPending && mutation.variables?.userId === u.id
                      ? mutation.variables.role
                      : null
                  }
                  resetPending={resetMutation.isPending && resetMutation.variables === u.email}
                  onToggle={(role, action) => mutation.mutate({ userId: u.id, role, action })}
                  onToggleMeta={(field, value) =>
                    updateMetaMutation.mutate({ userId: u.id, field, value })
                  }
                  onReset={() => u.email && resetMutation.mutate(u.email)}
                />
              ))}
              {visible.length === 0 && (
                <AdminEmptyRow
                  colSpan={5}
                  title="No users match"
                  description="Try adjusting your search or clearing filters."
                />
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function UserRow({
  user,
  isSelf,
  pending,
  resetPending,
  onToggle,
  onToggleMeta,
  onReset,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  pending: AppRole | null;
  resetPending: boolean;
  onToggle: (role: AppRole, action: "grant" | "revoke") => void;
  onToggleMeta: (field: "is_creator" | "is_vip", value: boolean) => void;
  onReset: () => void;
}) {
  const verified = !!user.email_confirmed_at;
  const [creditOpen, setCreditOpen] = useState(false);
  const label = user.display_name ?? user.email ?? "this user";
  return (
    <TableRow className="arena-tr border-arena-border/60">
      <TableCell>
        <div className="font-semibold text-white">{user.display_name ?? "—"}</div>
        <div className="text-xs text-muted-foreground">{user.email ?? "no email"}</div>
        {isSelf && (
          <Badge variant="outline" className="mt-1">
            you
          </Badge>
        )}
      </TableCell>
      <TableCell>
        {verified ? (
          <span className="inline-flex items-center gap-1 text-sm text-emerald-500">
            <CheckCircle2 className="h-4 w-4" /> Verified
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
            <XCircle className="h-4 w-4" /> Unverified
          </span>
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : "Never"}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1.5 items-center">
          {user.is_creator && (
            <Badge className="bg-pink-600 hover:bg-pink-500 border-none text-[10px] font-black tracking-wide uppercase text-white shadow-md">
              👑 Creator
            </Badge>
          )}
          {user.is_vip && (
            <Badge className="bg-purple-600 hover:bg-purple-500 border-none text-[10px] font-black tracking-wide uppercase text-white shadow-md">
              💎 VIP
            </Badge>
          )}
          {user.roles.length === 0 && !user.is_creator && !user.is_vip ? (
            <span className="text-xs text-muted-foreground">none</span>
          ) : (
            user.roles.map((r) => roleBadge(r))
          )}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap justify-end gap-1.5">
          {ROLES.map((role) => {
            const has = user.roles.includes(role);
            const isPending = pending === role;
            return (
              <Button
                key={role}
                size="sm"
                variant={has ? "arena" : "arenaOutline"}
                disabled={isPending}
                onClick={() => onToggle(role, has ? "revoke" : "grant")}
              >
                {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                {has ? `Revoke ${role}` : `Grant ${role}`}
              </Button>
            );
          })}

          {/* Creator Toggle Button */}
          <Button
            size="sm"
            variant={user.is_creator ? "arena" : "arenaOutline"}
            onClick={() => onToggleMeta("is_creator", !user.is_creator)}
            className={
              user.is_creator
                ? "bg-pink-600 hover:bg-pink-500 border-none text-white font-extrabold"
                : "text-slate-300 font-extrabold"
            }
          >
            {user.is_creator ? "Revoke Creator" : "Grant Creator"}
          </Button>

          {/* VIP Toggle Button */}
          <Button
            size="sm"
            variant={user.is_vip ? "arena" : "arenaOutline"}
            onClick={() => onToggleMeta("is_vip", !user.is_vip)}
            className={
              user.is_vip
                ? "bg-purple-600 hover:bg-purple-500 border-none text-white font-extrabold"
                : "text-slate-300 font-extrabold"
            }
          >
            {user.is_vip ? "Revoke VIP" : "Grant VIP"}
          </Button>

          <Button
            size="sm"
            variant="arenaOutline"
            onClick={() => setCreditOpen(true)}
            title={`Credit ${label}'s wallet`}
          >
            <CircleDollarSign className="h-3 w-3" />
            Credit wallet
          </Button>
          <Button
            size="sm"
            variant="arenaOutline"
            disabled={resetPending || !user.email}
            onClick={onReset}
            title={user.email ? "Send password reset email" : "No email on file"}
          >
            {resetPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <KeyRound className="h-3 w-3" />
            )}
            Reset password
          </Button>
        </div>
        <AdminCreditWalletDialog
          open={creditOpen}
          onOpenChange={setCreditOpen}
          userId={user.id}
          userLabel={label}
        />
      </TableCell>
    </TableRow>
  );
}

const SORT_LABELS: Record<SortKey, string> = {
  email: "Email",
  display_name: "Display name",
  last_sign_in_at: "Last sign-in",
};

function SortControl({
  sort,
  dir,
  onSort,
}: {
  sort: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-arena-border bg-arena-panel-2/40 p-1">
      <span className="px-2 text-xs uppercase tracking-widest text-muted-foreground">Sort</span>
      {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => {
        const active = sort === key;
        return (
          <Button
            key={key}
            size="sm"
            variant={active ? "secondary" : "ghost"}
            className={cn("h-7 px-2 text-xs", active && "font-semibold")}
            onClick={() => onSort(key)}
          >
            {SORT_LABELS[key]}
            {active ? (
              dir === "asc" ? (
                <ArrowUp className="h-3 w-3" />
              ) : (
                <ArrowDown className="h-3 w-3" />
              )
            ) : (
              <ArrowUpDown className="h-3 w-3 opacity-40" />
            )}
          </Button>
        );
      })}
    </div>
  );
}

function compareUsers(a: AdminUserRow, b: AdminUserRow, key: SortKey, dir: SortDir): number {
  const mult = dir === "asc" ? 1 : -1;
  if (key === "last_sign_in_at") {
    const av = a.last_sign_in_at ? Date.parse(a.last_sign_in_at) : -Infinity;
    const bv = b.last_sign_in_at ? Date.parse(b.last_sign_in_at) : -Infinity;
    if (av === bv) return 0;
    return av < bv ? -1 * mult : 1 * mult;
  }
  const av = (a[key] ?? "").toString().toLowerCase();
  const bv = (b[key] ?? "").toString().toLowerCase();
  if (av === bv) return 0;
  return av < bv ? -1 * mult : 1 * mult;
}
