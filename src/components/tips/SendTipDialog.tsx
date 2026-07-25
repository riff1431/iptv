import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Search, Users, UserPlus, Loader2, Coins } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { TipComposerDialog } from "./TipComposerDialog";

type FriendRow = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : ""))
    .toUpperCase() || "?";
}

export function SendTipDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [picked, setPicked] = useState<FriendRow | null>(null);

  // Debounce the search input so filtering doesn't thrash on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setDebouncedQuery("");
      setPicked(null);
    }
  }, [open]);

  const friendsQ = useQuery({
    queryKey: ["tip-recipients", "friends", userId],
    enabled: Boolean(userId) && open,
    staleTime: 30_000,
    queryFn: async (): Promise<FriendRow[]> => {
      if (!userId) return [];
      const { data: fs, error: fsErr } = await supabase
        .from("friendships")
        .select("requester_id,addressee_id,status")
        .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
        .eq("status", "accepted");
      if (fsErr) throw fsErr;
      const peerIds = Array.from(
        new Set(
          (fs ?? [])
            .map((r) => (r.requester_id === userId ? r.addressee_id : r.requester_id))
            .filter((v): v is string => Boolean(v)),
        ),
      );
      if (peerIds.length === 0) return [];
      const { data: profs, error: pErr } = await supabase
        .from("profiles")
        .select("id,display_name,avatar_url")
        .in("id", peerIds);
      if (pErr) throw pErr;
      return (profs ?? [])
        .filter((p) => p.id !== userId)
        .map((p) => ({
          id: p.id,
          name: (p.display_name ?? "").trim() || `User ${p.id.slice(0, 6)}`,
          avatarUrl: (p as { avatar_url?: string | null }).avatar_url ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  const friends = friendsQ.data ?? [];

  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLocaleLowerCase();
    if (!q) return friends;
    return friends.filter(
      (f) => f.name.toLocaleLowerCase().includes(q) || f.id.toLowerCase().startsWith(q),
    );
  }, [debouncedQuery, friends]);

  const hasQuery = query.trim().length > 0;

  return (
    <>
      <Dialog open={open && !picked} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Coins className="h-4 w-4 text-amber-400" /> Send a tip
            </DialogTitle>
            <DialogDescription>
              Pick a friend to tip. Only accepted friends appear here.
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search friends by name…"
              className="pl-9"
              aria-label="Search friends"
            />
          </div>

          <div className="max-h-80 overflow-y-auto rounded-md border border-arena-border">
            {friendsQ.isLoading ? (
              <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading friends…
              </div>
            ) : friendsQ.error ? (
              <div className="p-5 text-sm text-rose-400">
                {friendsQ.error instanceof Error
                  ? friendsQ.error.message
                  : "Failed to load friends."}
              </div>
            ) : friends.length === 0 ? (
              <EmptyState
                icon={<UserPlus className="h-6 w-6 text-arena-violet/80" />}
                title="No friends yet"
                body="Tips can only be sent to accepted friends. Add someone from the Community page, then come back here to tip them."
                cta={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button asChild size="sm" onClick={() => onOpenChange(false)}>
                      <Link to="/friends">
                        <UserPlus className="mr-1.5 h-4 w-4" /> Add friends
                      </Link>
                    </Button>
                    <Button
                      asChild
                      size="sm"
                      variant="arenaOutline"
                      onClick={() => onOpenChange(false)}
                    >
                      <Link to="/friends">
                        <Users className="mr-1.5 h-4 w-4" /> Browse community
                      </Link>
                    </Button>
                  </div>
                }
              />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={<Search className="h-6 w-6 text-muted-foreground" />}
                title={`No friends match “${query.trim()}”`}
                body="Broaden your search, clear it to see everyone, or add more friends from the Community page."
                cta={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        // Broaden: keep the first letter so results widen instead of resetting entirely.
                        const first = query.trim().slice(0, 1);
                        setQuery(first);
                      }}
                      disabled={!hasQuery || query.trim().length <= 1}
                    >
                      <Search className="mr-1.5 h-4 w-4" /> Broaden search
                    </Button>
                    <Button size="sm" variant="arenaOutline" onClick={() => setQuery("")}>
                      Clear search
                    </Button>
                    <Button
                      asChild
                      size="sm"
                      variant="arenaGhost"
                      onClick={() => onOpenChange(false)}
                    >
                      <Link to="/friends">
                        <UserPlus className="mr-1.5 h-4 w-4" /> Add friends
                      </Link>
                    </Button>
                  </div>
                }
              />
            ) : (
              <ul className="divide-y divide-arena-border/60">
                {filtered.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (!f.id || f.id === userId) {
                          toast.error("Invalid recipient", {
                            description: "You cannot tip yourself. Pick another friend.",
                          });
                          return;
                        }
                        setPicked(f);
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-arena-panel-2/60"
                    >
                      <Avatar className="h-9 w-9 border border-arena-border">
                        {f.avatarUrl && <AvatarImage src={f.avatarUrl} alt="" />}
                        <AvatarFallback className="bg-gradient-to-br from-arena-violet/40 to-arena-cyan/30 text-[10px] font-bold uppercase tracking-wider text-white/90">
                          {initials(f.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-white">{f.name}</div>
                        <div className="truncate font-mono text-[10px] text-muted-foreground">
                          {f.id.slice(0, 8)}
                        </div>
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-arena-violet">
                        Tip →
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="text-[11px] text-muted-foreground">
            {friends.length > 0 && (
              <>
                Showing {filtered.length} of {friends.length} friend
                {friends.length === 1 ? "" : "s"}.
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {picked && (
        <TipComposerDialog
          open={Boolean(picked)}
          onOpenChange={(v) => {
            if (!v) {
              setPicked(null);
              onOpenChange(false);
            }
          }}
          recipientUserId={picked.id}
          recipientName={picked.name}
        />
      )}
    </>
  );
}

function EmptyState({
  icon,
  title,
  body,
  cta,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  cta?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 p-6 text-center">
      <div className="rounded-full border border-arena-border bg-arena-panel-2/60 p-2">{icon}</div>
      <div className="text-sm font-semibold text-white">{title}</div>
      <p className="max-w-xs text-xs text-muted-foreground">{body}</p>
      {cta && <div className="mt-2">{cta}</div>}
    </div>
  );
}
