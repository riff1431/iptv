import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import {
  Search,
  Filter,
  X,
  ScrollText,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AdminEmptyRow,
  AdminLoadingBlock,
  AdminErrorBlock,
} from "@/components/admin/AdminStates";
import {
  queryAdminAuditLog,
  getAdminAuditFacets,
  type AuditLogRow,
} from "@/lib/admin-audit-log.functions";

const auditSearchSchema = z.object({
  q: fallback(z.string(), "").default(""),
  action: fallback(z.string(), "").default(""),
  target_table: fallback(z.string(), "").default(""),
  user: fallback(z.string(), "").default(""),
  path: fallback(z.string(), "").default(""),
  from: fallback(z.string(), "").default(""),
  to: fallback(z.string(), "").default(""),
  page: fallback(z.number().int().min(1), 1).default(1),
  pageSize: fallback(z.number().int().min(5).max(100), 25).default(25),
});

export const Route = createFileRoute("/admin/audit")({
  validateSearch: zodValidator(auditSearchSchema),
  component: AdminAuditPage,
});

type SearchState = z.infer<typeof auditSearchSchema>;

function toIsoStart(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}
function toIsoEnd(local: string): string | undefined {
  if (!local) return undefined;
  // Treat `to` as end-of-day if only a date was provided.
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return undefined;
  if (local.length === 10) d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

function AdminAuditPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/audit" });

  const queryFn = useServerFn(queryAdminAuditLog);
  const facetsFn = useServerFn(getAdminAuditFacets);

  const facets = useQuery({
    queryKey: ["admin", "audit_facets"],
    queryFn: () => facetsFn(),
    staleTime: 60_000,
  });

  const filters = useMemo(
    () => ({
      q: search.q || undefined,
      action: search.action || undefined,
      target_table: search.target_table || undefined,
      user: search.user || undefined,
      path: search.path || undefined,
      from: toIsoStart(search.from),
      to: toIsoEnd(search.to),
      page: search.page,
      pageSize: search.pageSize,
    }),
    [search],
  );

  const logs = useQuery({
    queryKey: ["admin", "audit_log", "query", filters],
    queryFn: () => queryFn({ data: filters }),
    placeholderData: keepPreviousData,
  });

  // Local search input debounced into URL state.
  const [qDraft, setQDraft] = useState(search.q);
  useEffect(() => setQDraft(search.q), [search.q]);
  useEffect(() => {
    const h = setTimeout(() => {
      if (qDraft !== search.q) {
        navigate({
          search: (prev: SearchState) => ({ ...prev, q: qDraft, page: 1 }),
          replace: true,
        });
      }
    }, 300);
    return () => clearTimeout(h);
  }, [qDraft, search.q, navigate]);

  const [userDraft, setUserDraft] = useState(search.user);
  useEffect(() => setUserDraft(search.user), [search.user]);
  useEffect(() => {
    const h = setTimeout(() => {
      if (userDraft !== search.user) {
        navigate({
          search: (prev: SearchState) => ({ ...prev, user: userDraft, page: 1 }),
          replace: true,
        });
      }
    }, 300);
    return () => clearTimeout(h);
  }, [userDraft, search.user, navigate]);

  const [pathDraft, setPathDraft] = useState(search.path);
  useEffect(() => setPathDraft(search.path), [search.path]);
  useEffect(() => {
    const h = setTimeout(() => {
      if (pathDraft !== search.path) {
        navigate({
          search: (prev: SearchState) => ({ ...prev, path: pathDraft, page: 1 }),
          replace: true,
        });
      }
    }, 300);
    return () => clearTimeout(h);
  }, [pathDraft, search.path, navigate]);

  const setFilter = <K extends keyof SearchState>(
    key: K,
    value: SearchState[K],
  ) =>
    navigate({
      search: (prev: SearchState) => ({ ...prev, [key]: value, page: 1 }),
      replace: true,
    });

  const clearAll = () =>
    navigate({
      search: () => ({
        q: "",
        action: "",
        target_table: "",
        user: "",
        path: "",
        from: "",
        to: "",
        page: 1,
        pageSize: search.pageSize,
      }),
      replace: true,
    });

  const total = logs.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / search.pageSize));
  const currentPage = Math.min(search.page, pageCount);
  const firstIdx = total === 0 ? 0 : (currentPage - 1) * search.pageSize + 1;
  const lastIdx = Math.min(currentPage * search.pageSize, total);

  const activeFilterCount = [
    search.q,
    search.action,
    search.target_table,
    search.user,
    search.path,
    search.from,
    search.to,
  ].filter(Boolean).length;

  const gotoPage = (p: number) =>
    navigate({
      search: (prev: SearchState) => ({ ...prev, page: Math.max(1, Math.min(pageCount, p)) }),
      replace: true,
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-xl font-bold">
            <ScrollText className="h-5 w-5 text-primary" />
            Audit log
          </h2>
          <p className="text-sm text-muted-foreground">
            Search and filter every admin action recorded on this project.
          </p>
        </div>
        <div className="text-xs text-muted-foreground">
          {total.toLocaleString()} entr{total === 1 ? "y" : "ies"}
          {activeFilterCount > 0 && ` · ${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} active`}
        </div>
      </div>

      <section className="arena-card space-y-4 rounded-xl p-4 sm:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
              placeholder="Search email, action, table, or target…"
              className="pl-9"
              aria-label="Search audit log"
            />
          </div>
          <Button
            variant="arenaOutline"
            onClick={clearAll}
            disabled={activeFilterCount === 0}
          >
            <X className="h-4 w-4" /> Clear filters
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <FilterField label="Action">
            <Select
              value={search.action || "__all"}
              onValueChange={(v) => setFilter("action", v === "__all" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Any action" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="__all">Any action</SelectItem>
                {(facets.data?.actions ?? []).map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Target table">
            <Select
              value={search.target_table || "__all"}
              onValueChange={(v) =>
                setFilter("target_table", v === "__all" ? "" : v)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Any table" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="__all">Any table</SelectItem>
                {(facets.data?.targetTables ?? []).map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Route / target">
            <Input
              value={pathDraft}
              onChange={(e) => setPathDraft(e.target.value)}
              placeholder="/admin/users"
            />
          </FilterField>

          <FilterField label="User (email or id)">
            <Input
              value={userDraft}
              onChange={(e) => setUserDraft(e.target.value)}
              placeholder="alice@…"
            />
          </FilterField>

          <FilterField label="From">
            <Input
              type="datetime-local"
              value={search.from}
              onChange={(e) => setFilter("from", e.target.value)}
            />
          </FilterField>

          <FilterField label="To">
            <Input
              type="datetime-local"
              value={search.to}
              onChange={(e) => setFilter("to", e.target.value)}
            />
          </FilterField>
        </div>

        {activeFilterCount > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            {search.q && <ActiveChip label={`search: ${search.q}`} onClear={() => setFilter("q", "")} />}
            {search.action && <ActiveChip label={`action: ${search.action}`} onClear={() => setFilter("action", "")} />}
            {search.target_table && <ActiveChip label={`table: ${search.target_table}`} onClear={() => setFilter("target_table", "")} />}
            {search.path && <ActiveChip label={`target: ${search.path}`} onClear={() => setFilter("path", "")} />}
            {search.user && <ActiveChip label={`user: ${search.user}`} onClear={() => setFilter("user", "")} />}
            {search.from && <ActiveChip label={`from: ${search.from}`} onClear={() => setFilter("from", "")} />}
            {search.to && <ActiveChip label={`to: ${search.to}`} onClear={() => setFilter("to", "")} />}
          </div>
        )}
      </section>

      <section className="arena-card overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px]">When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Target table</TableHead>
                <TableHead>Target / route</TableHead>
                <TableHead className="w-[120px] text-right">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.isLoading && !logs.data ? (
                <tr>
                  <td colSpan={6}>
                    <AdminLoadingBlock label="Loading audit entries…" />
                  </td>
                </tr>
              ) : logs.error ? (
                <tr>
                  <td colSpan={6} className="p-5">
                    <AdminErrorBlock
                      message={
                        logs.error instanceof Error
                          ? logs.error.message
                          : "Failed to load audit log"
                      }
                    />
                  </td>
                </tr>
              ) : (logs.data?.rows.length ?? 0) === 0 ? (
                <AdminEmptyRow
                  colSpan={6}
                  icon={ScrollText}
                  title="No audit entries match"
                  description="Adjust filters or clear them to see more results."
                />
              ) : (
                logs.data!.rows.map((row) => <AuditRow key={row.id} row={row} />)
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-col items-center justify-between gap-3 border-t border-arena-border px-4 py-3 sm:flex-row">
          <div className="text-xs text-muted-foreground">
            {total === 0
              ? "No entries"
              : `Showing ${firstIdx.toLocaleString()}–${lastIdx.toLocaleString()} of ${total.toLocaleString()}`}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Rows</span>
            <Select
              value={String(search.pageSize)}
              onValueChange={(v) =>
                navigate({
                  search: (prev: SearchState) => ({
                    ...prev,
                    pageSize: Number(v),
                    page: 1,
                  }),
                  replace: true,
                })
              }
            >
              <SelectTrigger className="h-8 w-[80px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50, 100].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="ml-2 flex items-center gap-1">
              <Button
                size="icon"
                variant="arenaGhost"
                onClick={() => gotoPage(1)}
                disabled={currentPage <= 1}
                aria-label="First page"
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="arenaGhost"
                onClick={() => gotoPage(currentPage - 1)}
                disabled={currentPage <= 1}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[80px] text-center text-xs text-muted-foreground">
                Page {currentPage} / {pageCount}
              </span>
              <Button
                size="icon"
                variant="arenaGhost"
                onClick={() => gotoPage(currentPage + 1)}
                disabled={currentPage >= pageCount}
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="arenaGhost"
                onClick={() => gotoPage(pageCount)}
                disabled={currentPage >= pageCount}
                aria-label="Last page"
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
      {label}
      <div className="font-normal normal-case tracking-normal text-foreground">
        {children}
      </div>
    </label>
  );
}

function ActiveChip({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <Badge variant="secondary" className="gap-1">
      {label}
      <button
        type="button"
        onClick={onClear}
        className="rounded hover:text-destructive"
        aria-label={`Remove ${label}`}
      >
        <X className="h-3 w-3" />
      </button>
    </Badge>
  );
}

function actionVariant(
  action: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (action === "admin_denied") return "destructive";
  if (action === "admin_access") return "outline";
  return "secondary";
}

function AuditRow({ row }: { row: AuditLogRow }) {
  const [open, setOpen] = useState(false);
  const created = new Date(row.created_at);
  const hasDetails =
    (row.before && Object.keys(row.before as object).length > 0) ||
    (row.after && Object.keys(row.after as object).length > 0);
  return (
    <>
      <TableRow>
        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
          <div>{created.toLocaleDateString()}</div>
          <div>{created.toLocaleTimeString()}</div>
        </TableCell>
        <TableCell className="text-sm">
          <div className="font-medium">{row.actor_email ?? "—"}</div>
          {row.actor_id && (
            <div className="font-mono text-[10px] text-muted-foreground">
              {row.actor_id.slice(0, 8)}…
            </div>
          )}
        </TableCell>
        <TableCell>
          <Badge variant={actionVariant(row.action)}>{row.action}</Badge>
        </TableCell>
        <TableCell className="text-sm">{row.target_table}</TableCell>
        <TableCell className="max-w-[280px] truncate text-sm" title={row.target_id ?? ""}>
          {row.target_id ?? "—"}
        </TableCell>
        <TableCell className="text-right">
          <Button
            size="sm"
            variant="arenaGhost"
            disabled={!hasDetails}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide" : "View"}
          </Button>
        </TableCell>
      </TableRow>
      {open && hasDetails && (
        <TableRow>
          <TableCell colSpan={6} className="bg-arena-panel-2/40 p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <DetailBlock title="Before" value={row.before} />
              <DetailBlock title="After" value={row.after} />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function DetailBlock({ title, value }: { title: string; value: unknown }) {
  const isEmpty =
    value == null ||
    (typeof value === "object" && Object.keys(value as object).length === 0);
  return (
    <div>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </div>
      <pre className="max-h-64 overflow-auto rounded-md border border-arena-border bg-arena-panel p-2 text-[11px] leading-relaxed text-foreground">
        {isEmpty ? "—" : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
