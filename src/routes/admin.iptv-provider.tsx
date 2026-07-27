import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Loader2,
  Radio,
  Save,
  KeyRound,
  Trash2,
  ShieldCheck,
  ExternalLink,
  Zap,
  Tv,
  Search,
  CheckCircle2,
  XCircle,
  ListFilter,
  Plus,
  ChevronDown,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  getIptvProviderAdmin,
  updateIptvProviderAdmin,
  testIptvProviderAdmin,
  previewIptvChannelsAdmin,
  getIptvCatalogStatusAdmin,
  syncIptvCatalogAdmin,
  type IptvProviderType,
} from "@/lib/iptv-provider.functions";

export const Route = createFileRoute("/admin/iptv-provider")({
  component: AdminIptvProviderPage,
});

type FormState = {
  provider_type: IptvProviderType;
  m3u_url: string;
  xtream_server_url: string;
  xtream_username: string;
  xtream_password: string; // "" = leave unchanged (keeps saved value)
  epg_url: string;
};

function AdminIptvProviderPage() {
  const qc = useQueryClient();
  const getFn = useServerFn(getIptvProviderAdmin);
  const updateFn = useServerFn(updateIptvProviderAdmin);
  const testFn = useServerFn(testIptvProviderAdmin);
  const previewFn = useServerFn(previewIptvChannelsAdmin);
  const getCatalogStatusFn = useServerFn(getIptvCatalogStatusAdmin);
  const syncCatalogFn = useServerFn(syncIptvCatalogAdmin);

  const query = useQuery({
    queryKey: ["admin", "iptv-provider"],
    queryFn: () => getFn(),
  });

  const [form, setForm] = useState<FormState>({
    provider_type: "m3u",
    m3u_url: "",
    xtream_server_url: "",
    xtream_username: "",
    xtream_password: "",
    epg_url: "",
  });
  const [confirmClearPw, setConfirmClearPw] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    channelCount?: number;
  } | null>(null);

  // Preview Modal state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSearch, setPreviewSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [visibleCount, setVisibleCount] = useState(100);

  const previewQuery = useQuery({
    queryKey: ["admin", "iptv-provider-preview"],
    queryFn: () => previewFn(),
    enabled: previewOpen,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (query.data) {
      setForm({
        provider_type: query.data.provider_type,
        m3u_url: query.data.m3u_url,
        xtream_server_url: query.data.xtream_server_url,
        xtream_username: query.data.xtream_username,
        xtream_password: "",
        epg_url: query.data.epg_url,
      });
    }
  }, [query.data]);

  // Reset pagination when search query or category changes
  useEffect(() => {
    setVisibleCount(100);
  }, [previewSearch, selectedCategory]);

  const catalogStatusQuery = useQuery({
    queryKey: ["admin", "iptv-catalog-status"],
    queryFn: () => getCatalogStatusFn(),
    refetchInterval: (query) => (query.state.data?.refreshing ? 3_000 : 60_000),
  });

  const syncCatalog = useMutation({
    mutationFn: () => syncCatalogFn(),
    onSuccess: (result) => {
      if (result.refreshed) {
        toast.success(`Channel catalog synced: ${result.channelCount.toLocaleString()} channels`);
      } else if (result.refreshing) {
        toast.info("A channel sync is already running");
      } else {
        toast.success("Channel catalog is already fresh");
      }
      qc.invalidateQueries({ queryKey: ["admin", "iptv-catalog-status"] });
      qc.invalidateQueries({ queryKey: ["admin", "iptv-provider-preview"] });
      qc.invalidateQueries({ queryKey: ["iptv", "playlist"] });
    },
    onError: (error: Error) => {
      toast.error(`Channel sync failed: ${error.message}`);
      qc.invalidateQueries({ queryKey: ["admin", "iptv-catalog-status"] });
    },
  });

  const save = useMutation({
    mutationFn: (opts?: { clearPassword?: boolean }) =>
      updateFn({
        data: {
          provider_type: form.provider_type,
          m3u_url: form.m3u_url.trim(),
          xtream_server_url: form.xtream_server_url.trim(),
          xtream_username: form.xtream_username.trim(),
          xtream_password: opts?.clearPassword
            ? null
            : form.xtream_password.length > 0
              ? form.xtream_password
              : undefined,
          epg_url: form.epg_url.trim(),
        },
      }),
    onSuccess: (saved) => {
      toast.success("IPTV provider settings saved");
      setForm((f) => ({ ...f, xtream_password: "" }));
      qc.invalidateQueries({ queryKey: ["admin", "iptv-provider"] });
      qc.invalidateQueries({ queryKey: ["admin", "iptv-provider-preview"] });
      qc.invalidateQueries({ queryKey: ["admin", "iptv-catalog-status"] });
      qc.invalidateQueries({ queryKey: ["iptv-provider", "public"] });
      const canSync =
        (saved.provider_type === "m3u" && Boolean(saved.m3u_url)) ||
        (saved.provider_type === "xtream" &&
          Boolean(saved.xtream_server_url) &&
          saved.has_xtream_password);
      if (canSync) syncCatalog.mutate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const testConn = useMutation({
    mutationFn: () =>
      testFn({
        data: {
          provider_type: form.provider_type,
          m3u_url: form.m3u_url.trim(),
          xtream_server_url: form.xtream_server_url.trim(),
          xtream_username: form.xtream_username.trim(),
          xtream_password: form.xtream_password.length > 0 ? form.xtream_password : undefined,
          epg_url: form.epg_url.trim(),
        },
      }),
    onSuccess: (res) => {
      setTestResult(res);
      if (res.ok) {
        toast.success(res.message);
      } else {
        toast.error(res.message);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const hasPw = query.data?.has_xtream_password ?? false;

  // Filtered channels across all items
  const filteredChannels = useMemo(() => {
    if (!previewQuery.data?.channels) return [];
    let list = previewQuery.data.channels;
    if (selectedCategory !== "ALL") {
      list = list.filter((c) => c.group === selectedCategory);
    }
    if (previewSearch.trim()) {
      const q = previewSearch.toLowerCase();
      list = list.filter(
        (c) => c.name.toLowerCase().includes(q) || (c.group && c.group.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [previewQuery.data, selectedCategory, previewSearch]);

  const visibleChannels = useMemo(() => {
    return filteredChannels.slice(0, visibleCount);
  }, [filteredChannels, visibleCount]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold">IPTV Provider</h2>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            One shared source used by every match. Update here and all matches switch automatically.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPreviewOpen(true)}
            className="gap-2 border-arena-violet/50 bg-arena-violet/10 text-arena-violet hover:bg-arena-violet/20"
          >
            <Tv className="h-4 w-4" /> Preview Live Channels
          </Button>
        </div>
      </div>

      <div className="arena-card flex flex-wrap items-center justify-between gap-4 rounded-xl p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">Channel catalog cache</p>
            {catalogStatusQuery.isLoading ? (
              <Badge variant="outline">Checking...</Badge>
            ) : catalogStatusQuery.data?.refreshing ? (
              <Badge className="border-amber-500/40 bg-amber-500/10 text-amber-300">Syncing</Badge>
            ) : catalogStatusQuery.data?.providerMatches && !catalogStatusQuery.data.stale ? (
              <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
                Fresh
              </Badge>
            ) : (
              <Badge className="border-rose-500/40 bg-rose-500/10 text-rose-300">
                Sync required
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {catalogStatusQuery.data?.providerMatches
              ? `${catalogStatusQuery.data.channelCount.toLocaleString()} channels · Last synced ${
                  catalogStatusQuery.data.fetchedAt
                    ? new Date(catalogStatusQuery.data.fetchedAt).toLocaleString()
                    : "never"
                }`
              : "The saved provider does not have a matching channel snapshot yet."}
          </p>
          {catalogStatusQuery.data?.lastError && (
            <p
              className="mt-1 max-w-3xl truncate text-xs text-rose-300"
              title={catalogStatusQuery.data.lastError}
            >
              Last sync error: {catalogStatusQuery.data.lastError}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => syncCatalog.mutate()}
          disabled={syncCatalog.isPending || catalogStatusQuery.data?.refreshing}
        >
          <RefreshCw
            className={`h-4 w-4 ${syncCatalog.isPending || catalogStatusQuery.data?.refreshing ? "animate-spin" : ""}`}
          />
          Sync Channels Now
        </Button>
      </div>

      {query.isLoading ? (
        <div className="arena-card flex items-center gap-2 rounded-xl p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading current settings…
        </div>
      ) : (
        <div className="arena-card space-y-5 rounded-xl p-5">
          {/* Provider type selector */}
          <div className="flex flex-col gap-2">
            <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Provider type
            </Label>
            <div className="flex gap-2">
              {(["m3u", "xtream"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, provider_type: t }))}
                  className={`flex-1 rounded-lg border px-4 py-3 text-sm font-semibold uppercase tracking-wider transition ${
                    form.provider_type === t
                      ? "border-arena-violet bg-arena-violet/15 text-white"
                      : "border-arena-border bg-arena-panel-2/40 text-muted-foreground hover:text-white"
                  }`}
                >
                  <Radio className="mr-2 inline h-4 w-4" />
                  {t === "m3u" ? "M3U Playlist URL" : "Xtream Codes"}
                </button>
              ))}
            </div>
          </div>

          {/* M3U section */}
          {form.provider_type === "m3u" && (
            <div className="space-y-3 rounded-lg border border-arena-border bg-arena-panel-2/30 p-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="m3u">Playlist URL (.m3u / .m3u8)</Label>
                <Input
                  id="m3u"
                  value={form.m3u_url}
                  onChange={(e) => setForm((f) => ({ ...f, m3u_url: e.target.value }))}
                  placeholder="https://provider.example.com/playlist.m3u"
                />
                <p className="text-xs text-muted-foreground">
                  All matches will resolve channels from this playlist. Leave blank to fall back to
                  the public iptv-org demo.
                </p>
              </div>
            </div>
          )}

          {/* Xtream section */}
          {form.provider_type === "xtream" && (
            <div className="space-y-3 rounded-lg border border-arena-border bg-arena-panel-2/30 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <Label htmlFor="xt-url">Server URL</Label>
                  <Input
                    id="xt-url"
                    value={form.xtream_server_url}
                    onChange={(e) => setForm((f) => ({ ...f, xtream_server_url: e.target.value }))}
                    placeholder="http://provider.example.com:8080"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="xt-user">Username</Label>
                  <Input
                    id="xt-user"
                    value={form.xtream_username}
                    onChange={(e) => setForm((f) => ({ ...f, xtream_username: e.target.value }))}
                    placeholder="username"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="xt-pw" className="flex items-center gap-2">
                    Password
                    {hasPw && (
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-400">
                        <ShieldCheck className="h-3 w-3" /> Saved
                      </span>
                    )}
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="xt-pw"
                      type="password"
                      value={form.xtream_password}
                      onChange={(e) => setForm((f) => ({ ...f, xtream_password: e.target.value }))}
                      placeholder={hasPw ? "•••••••• (leave blank to keep)" : "password"}
                      autoComplete="new-password"
                    />
                    {hasPw && (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        title="Clear saved password"
                        onClick={() => setConfirmClearPw(true)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <KeyRound className="h-3 w-3" />
                    Encrypted at rest. Blank = keep the current value.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Shared EPG */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="epg">EPG / XMLTV URL (optional)</Label>
            <Input
              id="epg"
              value={form.epg_url}
              onChange={(e) => setForm((f) => ({ ...f, epg_url: e.target.value }))}
              placeholder="https://provider.example.com/xmltv.php"
            />
          </div>

          {/* Test Status Badge */}
          {testResult && (
            <div
              className={`flex items-center gap-2 rounded-lg border p-3 text-xs font-medium ${
                testResult.ok
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-300"
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              ) : (
                <XCircle className="h-4 w-4 shrink-0 text-rose-400" />
              )}
              <span className="flex-1">{testResult.message}</span>
              {testResult.channelCount != null && (
                <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">
                  {testResult.channelCount.toLocaleString()} Live Channels
                </Badge>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-arena-border pt-4">
            <div className="text-xs text-muted-foreground">
              {query.data?.updated_at ? (
                <>Last updated {new Date(query.data.updated_at).toLocaleString()}</>
              ) : (
                <>Not yet configured — using demo playlist.</>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => testConn.mutate()}
                disabled={testConn.isPending}
                className="gap-2"
              >
                {testConn.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Zap className="h-3.5 w-3.5 text-amber-400" />
                )}
                Test Connection
              </Button>
              <Button asChild variant="ghost" size="sm">
                <a href="/iptv" target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-2 h-3.5 w-3.5" /> Preview /iptv
                </a>
              </Button>
              <Button
                onClick={() => save.mutate(undefined)}
                disabled={save.isPending}
                className="gap-2"
              >
                {save.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save settings
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Password Confirmation */}
      <AlertDialog open={confirmClearPw} onOpenChange={setConfirmClearPw}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear the saved Xtream password?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the encrypted password from the database. You'll need to enter it again
              before Xtream requests can authenticate.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmClearPw(false);
                save.mutate({ clearPassword: true });
              }}
            >
              Clear password
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Interactive Full Channel List Preview Modal */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col bg-arena-panel border-arena-border p-6">
          <DialogHeader className="pb-2 border-b border-arena-border">
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <Tv className="h-5 w-5 text-arena-violet" />
              Full Live Channels Preview
              {previewQuery.data && (
                <Badge
                  variant="secondary"
                  className="ml-auto font-mono text-xs bg-arena-violet/20 text-arena-violet"
                >
                  {previewQuery.data.totalChannels.toLocaleString()} Total Channels Loaded
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              All live channels fetched directly from your active IPTV provider (
              {query.data?.provider_type.toUpperCase()}).
            </DialogDescription>
          </DialogHeader>

          {previewQuery.isLoading ? (
            <div className="flex h-72 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-7 w-7 animate-spin text-arena-violet" />
              <p>Fetching full channel list from provider server…</p>
              <span className="text-xs text-muted-foreground/60">
                Parsing streams and categories
              </span>
            </div>
          ) : previewQuery.isError ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 p-6 text-center text-rose-400">
              <XCircle className="h-8 w-8" />
              <p className="text-sm font-semibold">Failed to fetch live channels</p>
              <p className="text-xs text-muted-foreground">
                {(previewQuery.error as Error)?.message ||
                  "Check your provider settings and test connection."}
              </p>
            </div>
          ) : (
            <div className="flex flex-1 flex-col gap-3 overflow-hidden pt-3">
              {/* Search & Category Filter */}
              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search all 18,000+ channels by name or category…"
                    value={previewSearch}
                    onChange={(e) => setPreviewSearch(e.target.value)}
                    className="pl-9 bg-arena-panel-2/50"
                  />
                </div>
                {previewQuery.data?.categories && previewQuery.data.categories.length > 0 && (
                  <div className="flex items-center gap-2 sm:w-72">
                    <ListFilter className="h-4 w-4 text-muted-foreground shrink-0" />
                    <select
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                      className="w-full rounded-md border border-arena-border bg-arena-panel-2 px-3 py-2 text-xs text-white outline-none focus:border-arena-violet"
                    >
                      <option value="ALL">
                        All Categories ({previewQuery.data.categories.length})
                      </option>
                      {previewQuery.data.categories.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Channel Count Bar */}
              <div className="flex items-center justify-between text-xs text-muted-foreground px-1 py-1 bg-arena-panel-2/30 rounded px-2">
                <span>
                  Showing <strong className="text-white">{visibleChannels.length}</strong> of{" "}
                  <strong className="text-white">{filteredChannels.length.toLocaleString()}</strong>{" "}
                  matching channels
                  {filteredChannels.length !== previewQuery.data?.totalChannels && (
                    <span className="text-muted-foreground/60 ml-1">
                      (filtered from {previewQuery.data?.totalChannels.toLocaleString()})
                    </span>
                  )}
                </span>
                {selectedCategory !== "ALL" && (
                  <Badge
                    variant="outline"
                    className="text-[10px] border-arena-violet/40 text-arena-violet"
                  >
                    Category: {selectedCategory}
                  </Badge>
                )}
              </div>

              {/* Channel Grid */}
              <div className="grid flex-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3 max-h-[55vh]">
                {filteredChannels.length === 0 ? (
                  <div className="col-span-full py-16 text-center text-xs text-muted-foreground">
                    No channels match your search filter "{previewSearch}".
                  </div>
                ) : (
                  visibleChannels.map((ch) => (
                    <div
                      key={ch.id}
                      className="flex items-center gap-3 rounded-lg border border-arena-border bg-arena-panel-2/40 p-2.5 transition hover:border-arena-violet/50 hover:bg-arena-panel-2/80"
                    >
                      {ch.logo ? (
                        <img
                          src={ch.logo}
                          alt={ch.name}
                          className="h-9 w-9 rounded object-contain bg-black/40 p-0.5"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = "none";
                          }}
                        />
                      ) : (
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-arena-violet/20 text-arena-violet">
                          <Tv className="h-4 w-4" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-white" title={ch.name}>
                          {ch.name}
                        </p>
                        {ch.group && (
                          <p className="truncate text-[10px] text-muted-foreground">{ch.group}</p>
                        )}
                        <span className="font-mono text-[9px] text-muted-foreground/60">
                          ID: {ch.id}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Load More Pagination Bar */}
              {filteredChannels.length > visibleCount && (
                <div className="flex items-center justify-center gap-3 border-t border-arena-border pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setVisibleCount((prev) => prev + 100)}
                    className="gap-2 border-arena-violet/40 text-xs"
                  >
                    <ChevronDown className="h-4 w-4" />
                    Load More Channels (+100)
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setVisibleCount(filteredChannels.length)}
                    className="text-xs text-muted-foreground hover:text-white"
                  >
                    Show All ({filteredChannels.length.toLocaleString()})
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
