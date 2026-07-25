import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Search,
  ShieldOff,
  ShieldCheck,
  RefreshCw,
  Ban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  AdminEmptyRow,
  AdminLoadingBlock,
  AdminErrorBlock,
} from "@/components/admin/AdminStates";
import {
  listIptvIpBlocks,
  unblockIptvIp,
  type IptvIpBlockRow,
} from "@/lib/iptv-ip-blocks.functions";

export const Route = createFileRoute("/admin/iptv-blocks")({
  component: AdminIptvBlocksPage,
});

function AdminIptvBlocksPage() {
  const listFn = useServerFn(listIptvIpBlocks);
  const unblockFn = useServerFn(unblockIptvIp);
  const qc = useQueryClient();

  const [qDraft, setQDraft] = useState("");
  const [q, setQ] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);

  useEffect(() => {
    const h = setTimeout(() => setQ(qDraft.trim()), 300);
    return () => clearTimeout(h);
  }, [qDraft]);

  const filters = useMemo(
    () => ({ q: q || undefined, activeOnly }),
    [q, activeOnly],
  );

  const blocks = useQuery({
    queryKey: ["admin", "iptv_ip_blocks", filters],
    queryFn: () => listFn({ data: filters }),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });

  const unblock = useMutation({
    mutationFn: (ip: string) => unblockFn({ data: { ip } }),
    onSuccess: (_res, ip) => {
      toast.success(`Unblocked ${ip}`);
      qc.invalidateQueries({ queryKey: ["admin", "iptv_ip_blocks"] });
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to unblock IP",
      );
    },
  });

  const rows = blocks.data?.rows ?? [];
  const activeCount = blocks.data?.activeCount ?? 0;
  const total = blocks.data?.total ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-xl font-bold">
            <ShieldOff className="h-5 w-5 text-primary" />
            IPTV throttled IPs
          </h2>
          <p className="text-sm text-muted-foreground">
            Temporarily blocked clients from repeated SSRF-triggered proxy
            rejections. Unblock to restore playlist access immediately.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Badge variant="destructive" className="gap-1">
            <Ban className="h-3 w-3" /> {activeCount} active
          </Badge>
          <span>{total.toLocaleString()} total</span>
          <Button
            size="sm"
            variant="arenaGhost"
            onClick={() => blocks.refetch()}
            aria-label="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <section className="arena-card space-y-4 rounded-xl p-4 sm:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
              placeholder="Search by IP or reason…"
              className="pl-9"
              aria-label="Search blocks"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
            <Switch
              checked={activeOnly}
              onCheckedChange={setActiveOnly}
              aria-label="Show active blocks only"
            />
            Active only
          </label>
        </div>
      </section>

      <section className="arena-card overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px]">Status</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="w-[80px]">Hits</TableHead>
                <TableHead className="w-[200px]">Blocked until</TableHead>
                <TableHead className="w-[200px]">First seen</TableHead>
                <TableHead className="w-[140px] text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {blocks.isLoading && !blocks.data ? (
                <tr>
                  <td colSpan={7}>
                    <AdminLoadingBlock label="Loading blocks…" />
                  </td>
                </tr>
              ) : blocks.error ? (
                <tr>
                  <td colSpan={7} className="p-5">
                    <AdminErrorBlock
                      message={
                        blocks.error instanceof Error
                          ? blocks.error.message
                          : "Failed to load IP blocks"
                      }
                    />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <AdminEmptyRow
                  colSpan={7}
                  icon={ShieldCheck}
                  title="No blocked IPs"
                  description={
                    activeOnly
                      ? "No clients are currently throttled."
                      : "No throttle events recorded yet."
                  }
                />
              ) : (
                rows.map((row) => (
                  <BlockRow
                    key={row.ip}
                    row={row}
                    onUnblock={(ip) => unblock.mutate(ip)}
                    pending={unblock.isPending && unblock.variables === row.ip}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function BlockRow({
  row,
  onUnblock,
  pending,
}: {
  row: IptvIpBlockRow;
  onUnblock: (ip: string) => void;
  pending: boolean;
}) {
  const blockedUntil = new Date(row.blocked_until);
  const remainingMs = blockedUntil.getTime() - Date.now();
  const remainingLabel =
    remainingMs > 0 ? formatRemaining(remainingMs) : "expired";

  return (
    <TableRow>
      <TableCell>
        {row.active ? (
          <Badge variant="destructive">Blocked</Badge>
        ) : (
          <Badge variant="secondary">Expired</Badge>
        )}
      </TableCell>
      <TableCell className="font-mono text-xs">{row.ip}</TableCell>
      <TableCell className="max-w-[280px] truncate text-sm" title={row.reason}>
        {row.reason}
      </TableCell>
      <TableCell className="text-sm">{row.hits}</TableCell>
      <TableCell className="text-xs text-muted-foreground">
        <div>{blockedUntil.toLocaleString()}</div>
        <div className="text-[10px] uppercase tracking-wider">
          {remainingLabel}
        </div>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {new Date(row.created_at).toLocaleString()}
      </TableCell>
      <TableCell className="text-right">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="arenaOutline"
              disabled={pending || !row.active}
            >
              <ShieldCheck className="h-4 w-4" />
              {pending ? "Unblocking…" : "Unblock"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Unblock {row.ip}?</AlertDialogTitle>
              <AlertDialogDescription>
                This clears the throttle immediately. If the client continues to
                trigger SSRF rejections, they will be re-throttled automatically.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => onUnblock(row.ip)}>
                Unblock
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  );
}

function formatRemaining(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m left`;
  }
  if (m > 0) return `${m}m ${s}s left`;
  return `${s}s left`;
}
