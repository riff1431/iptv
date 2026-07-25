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
  ShieldAlert,
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
  queryIptvRejections,
  getIptvRejectionFacets,
  type IptvRejectionRow,
} from "@/lib/iptv-rejections.functions";

const searchSchema = z.object({
  q: fallback(z.string(), "").default(""),
  request_id: fallback(z.string(), "").default(""),
  reason: fallback(z.string(), "").default(""),
  host: fallback(z.string(), "").default(""),
  from: fallback(z.string(), "").default(""),
  to: fallback(z.string(), "").default(""),
  page: fallback(z.number().int().min(1), 1).default(1),
  pageSize: fallback(z.number().int().min(5).max(100), 25).default(25),
});

export const Route = createFileRoute("/admin/iptv-rejections")({
  validateSearch: zodValidator(searchSchema),
  component: AdminIptvRejectionsPage,
});

type SearchState = z.infer<typeof searchSchema>;

function toIsoStart(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
function toIsoEnd(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return undefined;
  if (local.length === 10) d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

function AdminIptvRejectionsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/iptv-rejections" });

  const queryFn = useServerFn(queryIptvRejections);
  const facetsFn = useServerFn(getIptvRejectionFacets);

  const facets = useQuery({
    queryKey: ["admin", "iptv_rejection_facets"],
    queryFn: () => facetsFn(),
    staleTime: 60_000,
  });

  const filters = useMemo(
    () => ({
      q: search.q || undefined,
      request_id: search.request_id || undefined,
      reason: search.reason || undefined,
      host: search.host || undefined,
      from: toIsoStart(search.from),
      to: toIsoEnd(search.to),
      page: search.page,
      pageSize: search.pageSize,
    }),
    [search],
  );

  const logs = useQuery({
    queryKey: ["admin", "iptv_rejections", filters],
    queryFn: () => queryFn({ data: filters }),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });

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

  const [reqDraft, setReqDraft] = useState(search.request_id);
  useEffect(() => setReqDraft(search.request_id), [search.request_id]);
  useEffect(() => {
    const h = setTimeout(() => {
      if (reqDraft !== search.request_id) {
        navigate({
          search: (prev: SearchState) => ({ ...prev, request_id: reqDraft, page: 1 }),
          replace: true,
        });
      }
    }, 300);
    return () => clearTimeout(h);
  }, [reqDraft, search.request_id, navigate]);

  const [hostDraft, setHostDraft] = useState(search.host);
  useEffect(() => setHostDraft(search.host), [search.host]);
  useEffect(() => {
    const h = setTimeout(() => {
      if (hostDraft !== search.host) {
        navigate({
          search: (prev: SearchState) => ({ ...prev, host: hostDraft, page: 1 }),
          replace: true,
        });
      }
    }, 300);
    return () => clearTimeout(h);
  }, [hostDraft, search.host, navigate]);

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
        request_id: "",
        reason: "",
        host: "",
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
    search.request_id,
    search.reason,
    search.host,
    search.from,
    search.to,
  ].filter(Boolean).length;

  const gotoPage = (p: number) =>
    navigate({
      search: (prev: SearchState) => ({
        ...prev,
        page: Math.max(1, Math.min(pageCount, p)),
      }),
      replace: true,
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-xl font-bold">
            <ShieldAlert className="h-5 w-5 text-primary" />
            IPTV proxy rejections
          </h2>
          <p className="text-sm text-muted-foreground">
            Audit playlist proxy requests refused by the SSRF guard.
          </p>
        </div>
        <div className="text-xs text-muted-foreground">
          {total.toLocaleString()} entr{total === 1 ? "y" : "ies"}
          {activeFilterCount > 0 &&
            ` · ${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} active`}
        </div>
      </div>

      <section className="arena-card space-y-4 rounded-xl p-4 sm:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
              placeholder="Search request id, reason, host, or ip…"
              className="pl-9"
              aria-label="Search rejections"
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

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <FilterField label="Request ID">
            <Input
              value={reqDraft}
              onChange={(e) => setReqDraft(e.target.value)}
              placeholder="cf-ray or uuid…"
            />
          </FilterField>

          <FilterField label="Reason">
            <Select
              value={search.reason || "__all"}
              onValueChange={(v) => setFilter("reason", v === "__all" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Any reason" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="__all">Any reason</SelectItem>
                {(facets.data?.reasons ?? []).map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Host">
            <Input
              value={hostDraft}
              onChange={(e) => setHostDraft(e.target.value)}
              placeholder="example.com"
              list="iptv-reject-hosts"
            />
            <datalist id="iptv-reject-hosts">
              {(facets.data?.hosts ?? []).map((h) => (
                <option key={h} value={h} />
              ))}
            </datalist>
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
            {search.q && (
              <ActiveChip label={`search: ${search.q}`} onClear={() => setFilter("q", "")} />
            )}
            {search.request_id && (
              <ActiveChip
                label={`req: ${search.request_id}`}
                onClear={() => setFilter("request_id", "")}
              />
            )}
            {search.reason && (
              <ActiveChip
                label={`reason: ${search.reason}`}
                onClear={() => setFilter("reason", "")}
              />
            )}
            {search.host && (
              <ActiveChip
                label={`host: ${search.host}`}
                onClear={() => setFilter("host", "")}
              />
            )}
            {search.from && (
              <ActiveChip
                label={`from: ${search.from}`}
                onClear={() => setFilter("from", "")}
              />
            )}
            {search.to && (
              <ActiveChip label={`to: ${search.to}`} onClear={() => setFilter("to", "")} />
            )}
          </div>
        )}
      </section>

      <section className="arena-card overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px]">When</TableHead>
                <TableHead className="w-[80px]">Status</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Host</TableHead>
                <TableHead>Request ID</TableHead>
                <TableHead>IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.isLoading && !logs.data ? (
                <tr>
                  <td colSpan={6}>
                    <AdminLoadingBlock label="Loading rejections…" />
                  </td>
                </tr>
              ) : logs.error ? (
                <tr>
                  <td colSpan={6} className="p-5">
                    <AdminErrorBlock
                      message={
                        logs.error instanceof Error
                          ? logs.error.message
                          : "Failed to load rejections"
                      }
                    />
                  </td>
                </tr>
              ) : (logs.data?.rows.length ?? 0) === 0 ? (
                <AdminEmptyRow
                  colSpan={6}
                  icon={ShieldAlert}
                  title="No rejections match"
                  description="Adjust filters or wait for new blocked requests."
                />
              ) : (
                logs.data!.rows.map((row) => <RejectionRow key={row.id} row={row} />)
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

function ActiveChip({ label, onClear }: { label: string; onClear: () => void }) {
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

function RejectionRow({ row }: { row: IptvRejectionRow }) {
  const statusVariant: "destructive" | "outline" | "secondary" =
    row.status >= 500 ? "destructive" : row.status >= 400 ? "outline" : "secondary";
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
        {new Date(row.created_at).toLocaleString()}
      </TableCell>
      <TableCell>
        <Badge variant={statusVariant}>{row.status}</Badge>
      </TableCell>
      <TableCell className="max-w-[360px]">
        <span className="line-clamp-2 text-sm">{row.reason}</span>
      </TableCell>
      <TableCell className="font-mono text-xs">{row.host ?? "—"}</TableCell>
      <TableCell className="font-mono text-[11px] text-muted-foreground">
        {row.request_id}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {row.ip ?? "—"}
      </TableCell>
    </TableRow>
  );
}
