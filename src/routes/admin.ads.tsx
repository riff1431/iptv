import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Film, Clock, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  useAds,
  useUpsertAd,
  useDeleteAd,
  useAdSchedules,
  useUpsertAdSchedule,
  useDeleteAdSchedule,
  useLounges,
} from "@/lib/admin-queries";
import {
  AdminEmptyBlock,
  AdminLoadingBlock,
} from "@/components/admin/AdminStates";

export const Route = createFileRoute("/admin/ads")({
  component: AdminAdsPage,
});

function AdminAdsPage() {
  const { data: ads = [], isLoading: adsLoading } = useAds();
  const { data: lounges = [] } = useLounges();
  const { data: schedules = [] } = useAdSchedules();
  const upsertAd = useUpsertAd();
  const delAd = useDeleteAd();
  const upsertSched = useUpsertAdSchedule();
  const delSched = useDeleteAdSchedule();

  const [newAd, setNewAd] = useState({ title: "", storage_path: "", duration_sec: 15 });
  const [newSched, setNewSched] = useState<{
    lounge_id: string | null;
    ad_ids: string[];
    interval_minutes: number;
  }>({ lounge_id: null, ad_ids: [], interval_minutes: 30 });

  async function addAd() {
    if (!newAd.title.trim() || !newAd.storage_path.trim()) {
      toast.error("Title and URL/path are required");
      return;
    }
    try {
      await upsertAd.mutateAsync({
        title: newAd.title.trim(),
        storage_path: newAd.storage_path.trim(),
        duration_sec: Number(newAd.duration_sec) || 15,
        is_active: true,
      });
      setNewAd({ title: "", storage_path: "", duration_sec: 15 });
      toast.success("Ad added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add ad");
    }
  }

  async function toggleActive(id: string, current: boolean) {
    const ad = ads.find((a) => a.id === id);
    if (!ad) return;
    try {
      await upsertAd.mutateAsync({ ...ad, is_active: !current });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function removeAd(id: string) {
    if (!confirm("Delete this ad?")) return;
    try {
      await delAd.mutateAsync(id);
      toast.success("Ad deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function saveSchedule() {
    if (newSched.ad_ids.length === 0) {
      toast.error("Pick at least one ad");
      return;
    }
    try {
      await upsertSched.mutateAsync({
        lounge_id: newSched.lounge_id,
        ad_ids: newSched.ad_ids,
        interval_minutes: Number(newSched.interval_minutes) || 30,
        is_active: true,
      });
      setNewSched({ lounge_id: null, ad_ids: [], interval_minutes: 30 });
      toast.success("Schedule saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold">Ad Breaks</h2>
        <p className="text-xs text-muted-foreground">
          Add MP4 URLs today; direct upload lands with the storage bucket in a later phase.
        </p>
      </div>

      <div className="arena-card rounded-xl">
        <div className="grid gap-3 border-b border-arena-border p-4 sm:grid-cols-[1fr_1fr_120px_auto]">
          <input
            className="rounded-md border border-arena-border bg-arena-panel-2/60 px-3 py-2 text-sm"
            placeholder="Title (e.g. PGX Promo 15s)"
            value={newAd.title}
            onChange={(e) => setNewAd({ ...newAd, title: e.target.value })}
          />
          <input
            className="rounded-md border border-arena-border bg-arena-panel-2/60 px-3 py-2 text-sm"
            placeholder="MP4 URL or storage path"
            value={newAd.storage_path}
            onChange={(e) => setNewAd({ ...newAd, storage_path: e.target.value })}
          />
          <input
            type="number"
            min={1}
            className="rounded-md border border-arena-border bg-arena-panel-2/60 px-3 py-2 text-sm"
            placeholder="Duration (s)"
            value={newAd.duration_sec}
            onChange={(e) => setNewAd({ ...newAd, duration_sec: Number(e.target.value) })}
          />
          <Button variant="arena" onClick={addAd} disabled={upsertAd.isPending} className="gap-2">
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>

        <div className="divide-y divide-arena-border/60">
          {adsLoading && <AdminLoadingBlock label="Loading ads…" />}
          {!adsLoading && ads.length === 0 && (
            <AdminEmptyBlock
              icon={Film}
              title="No ads yet"
              description="Upload a clip above to build your ad rotation."
            />
          )}
          {ads.map((a) => (
            <div key={a.id} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/15 text-primary">
                  <Film className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold">{a.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {a.duration_sec}s · {a.storage_path}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleActive(a.id, a.is_active)}
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                    a.is_active
                      ? "bg-success/15 text-success"
                      : "bg-arena-panel-2 text-muted-foreground"
                  }`}
                >
                  ● {a.is_active ? "Active" : "Paused"}
                </button>
                <Button size="sm" variant="arenaOutline" onClick={() => removeAd(a.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="arena-card rounded-xl p-5">
        <div className="mb-4 flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">New Schedule</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          During each break, all TVs in the lounge pause the live stream and play the selected
          ads in order.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_140px_auto]">
          <select
            className="rounded-md border border-arena-border bg-arena-panel-2/60 px-3 py-2 text-sm"
            value={newSched.lounge_id ?? ""}
            onChange={(e) =>
              setNewSched({ ...newSched, lounge_id: e.target.value || null })
            }
          >
            <option value="">All lounges</option>
            {lounges.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <select
            multiple
            className="min-h-20 rounded-md border border-arena-border bg-arena-panel-2/60 px-3 py-2 text-sm"
            value={newSched.ad_ids}
            onChange={(e) =>
              setNewSched({
                ...newSched,
                ad_ids: Array.from(e.target.selectedOptions).map((o) => o.value),
              })
            }
          >
            {ads.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            className="rounded-md border border-arena-border bg-arena-panel-2/60 px-3 py-2 text-sm"
            placeholder="Interval (min)"
            value={newSched.interval_minutes}
            onChange={(e) =>
              setNewSched({ ...newSched, interval_minutes: Number(e.target.value) })
            }
          />
          <Button variant="arena" onClick={saveSchedule} disabled={upsertSched.isPending}>
            Save
          </Button>
        </div>
      </div>

      <div className="arena-card rounded-xl">
        <div className="border-b border-arena-border p-4">
          <h3 className="font-semibold">Active Schedules</h3>
        </div>
        <div className="divide-y divide-arena-border/60">
          {schedules.length === 0 && (
            <AdminEmptyBlock
              icon={Clock}
              title="No schedules yet"
              description="Assign ads to lounges below to schedule playback."
            />
          )}
          {schedules.map((s) => {
            const lounge = lounges.find((l) => l.id === s.lounge_id);
            return (
              <div key={s.id} className="flex items-center justify-between p-4">
                <div className="text-sm">
                  <div className="font-semibold">{lounge?.name ?? "All lounges"}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.ad_ids.length} ad{s.ad_ids.length === 1 ? "" : "s"} · every{" "}
                    {s.interval_minutes} min
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="arenaOutline"
                  onClick={() => delSched.mutate(s.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
