import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Radio, Save, KeyRound, Trash2, ShieldCheck, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  getIptvProviderAdmin,
  updateIptvProviderAdmin,
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
    onSuccess: () => {
      toast.success("IPTV provider settings saved");
      setForm((f) => ({ ...f, xtream_password: "" }));
      qc.invalidateQueries({ queryKey: ["admin", "iptv-provider"] });
      qc.invalidateQueries({ queryKey: ["iptv-provider", "public"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const hasPw = query.data?.has_xtream_password ?? false;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl font-bold">IPTV Provider</h2>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          One shared source used by every match. Update here and all matches switch automatically.
        </p>
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
                    onChange={(e) =>
                      setForm((f) => ({ ...f, xtream_server_url: e.target.value }))
                    }
                    placeholder="http://provider.example.com:8080"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="xt-user">Username</Label>
                  <Input
                    id="xt-user"
                    value={form.xtream_username}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, xtream_username: e.target.value }))
                    }
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
                      onChange={(e) =>
                        setForm((f) => ({ ...f, xtream_password: e.target.value }))
                      }
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

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-arena-border pt-4">
            <div className="text-xs text-muted-foreground">
              {query.data?.updated_at ? (
                <>Last updated {new Date(query.data.updated_at).toLocaleString()}</>
              ) : (
                <>Not yet configured — using demo playlist.</>
              )}
            </div>
            <div className="flex items-center gap-2">
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
    </div>
  );
}
