import { createFileRoute, Link } from "@tanstack/react-router";
import { withAuth } from "@/components/RequireAuth";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  MessageCircle,
  Search,
  MoreVertical,
  Send,
  Smile,
  Plus,
  Crown,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ArenaHeader } from "@/components/sports-arena/ArenaHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDirectMessages } from "@/hooks/useDirectMessages";
import { toast } from "sonner";

export const Route = createFileRoute("/friends")({
  head: () => ({
    meta: [
      { title: "Community — Friends | PGX Sports Arena" },
      {
        name: "description",
        content:
          "Message your crew, see who's live in which lounge, and drop into the room together inside PGX Sports Arena.",
      },
      { property: "og:title", content: "Community — Friends | PGX Sports Arena" },
      {
        property: "og:description",
        content: "Chat with your crew and see who's watching what across PGX lounges.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: withAuth(FriendsPage),
});

type Friend = {
  id: string;
  name: string;
  status: string;
  online: boolean;
  isHost?: boolean;
};

function avatarGradient(id: string) {
  const palette = [
    "from-[oklch(0.7_0.18_45)] to-[oklch(0.6_0.2_25)]",
    "from-[oklch(0.7_0.15_150)] to-[oklch(0.5_0.18_170)]",
    "from-[oklch(0.7_0.18_220)] to-[oklch(0.55_0.2_260)]",
    "from-[oklch(0.75_0.15_85)] to-[oklch(0.6_0.18_50)]",
    "from-[oklch(0.7_0.2_320)] to-[oklch(0.55_0.22_290)]",
  ];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % palette.length;
  return palette[h];
}

function initials(name: string | null | undefined) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase() || "?";
}


function timeLabel(iso: string) {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

function useFriends(userId: string | null) {
  return useQuery({
    queryKey: ["friends", userId],
    enabled: !!userId,
    queryFn: async (): Promise<Friend[]> => {
      if (!userId) return [];
      const { data: fs } = await supabase
        .from("friendships")
        .select("requester_id,addressee_id,status")
        .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
        .eq("status", "accepted");
      const peerIds = Array.from(
        new Set(
          (fs ?? [])
            .map((r) => (r.requester_id === userId ? r.addressee_id : r.requester_id))
            .filter(Boolean),
        ),
      );
      if (peerIds.length === 0) return [];
      const { data: profs } = await supabase
        .from("profiles")
        .select("id,display_name")
        .in("id", peerIds);
      return (profs ?? []).map((p) => ({
        id: p.id,
        name: p.display_name ?? p.id.slice(0, 6),
        status: "Online",
        online: true,
      }));
    },
  });
}

function FriendsPage() {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const { data: friends = [], isLoading: friendsLoading } = useFriends(userId);

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && friends.length > 0) setSelectedId(friends[0].id);
  }, [friends, selectedId]);

  const selected = useMemo(
    () => friends.find((f) => f.id === selectedId) ?? null,
    [friends, selectedId],
  );

  const {
    messages,
    loading: messagesLoading,
    send,
  } = useDirectMessages(selectedId);

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, selectedId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter((f) => f.name.toLowerCase().includes(q));
  }, [query, friends]);

  const onlineCount = friends.filter((f) => f.online).length;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !userId) return;
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    try {
      await send(selectedId, body);
      setDraft("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setBusy(false);
    }
  }

  const signedOut = !authLoading && !userId;

  return (
    <AppShell>
      <div className="relative min-h-[calc(100vh-64px)] bg-arena-bg">
        <div className="mx-auto max-w-7xl px-4 pb-16 pt-4 sm:px-6 sm:pt-6">
          <ArenaHeader liveGames={onlineCount} viewers={friends.length} />

          <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
            {/* Friends list — arena-card */}
            <aside className="arena-card flex h-[560px] min-w-0 flex-col rounded-2xl lg:h-[720px]">
              <div className="flex items-start justify-between gap-3 border-b border-arena-border px-4 py-3 sm:px-5 sm:py-4">
                <div>
                  <h2 className="font-display text-sm font-bold uppercase tracking-wider text-white">
                    <span className="inline-flex items-center gap-2">
                      <Users className="h-4 w-4 text-arena-violet" /> Friends
                    </span>
                  </h2>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-success">
                    <span className="h-2 w-2 rounded-full bg-success shadow-[0_0_6px_var(--success)]" />
                    <span className="text-white/90">{onlineCount}</span>
                    <span className="text-success">ONLINE</span>
                  </div>
                </div>
                <button
                  className="text-muted-foreground transition hover:text-white"
                  aria-label="More"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
              </div>

              <div className="border-b border-arena-border px-3 py-2 sm:px-4">
                <div className="flex items-center gap-2 rounded-lg border border-arena-border bg-arena-panel-2/60 px-3 py-1.5">
                  <Search className="h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search friends..."
                    className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-white placeholder:text-muted-foreground focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex-1 space-y-1 overflow-y-auto p-2">
                {signedOut && (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                    Sign in to see your friends and start a chat.
                  </div>
                )}
                {!signedOut && friendsLoading && (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                    Loading friends…
                  </div>
                )}
                {!signedOut && !friendsLoading && filtered.length === 0 && (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                    {friends.length === 0
                      ? "No friends yet. Add some to start chatting."
                      : `No friends match "${query}".`}
                  </div>
                )}
                {filtered.map((f) => {
                  const active = f.id === selectedId;
                  return (
                    <button
                      key={f.id}
                      onClick={() => setSelectedId(f.id)}
                      className={
                        "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition " +
                        (active
                          ? "border-arena-violet/50 bg-arena-violet/15 shadow-[0_0_18px_-8px_var(--arena-violet)]"
                          : "border-transparent hover:border-arena-border hover:bg-arena-panel-2/60")
                      }
                    >
                      <div className="relative shrink-0">
                        <div
                          className={`flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br text-[11px] font-bold uppercase tracking-wider text-white/90 shadow-inner ${avatarGradient(f.id)}`}
                          aria-label={`${f.name} avatar`}
                        >
                          {initials(f.name)}
                        </div>
                        <span
                          className={
                            "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-arena-panel " +
                            (f.online ? "bg-success" : "bg-muted-foreground")
                          }
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`truncate text-[13px] font-semibold ${f.isHost ? "text-arena-violet" : "text-white"}`}
                          >
                            {f.name}
                          </span>
                          {f.isHost && (
                            <span className="inline-flex items-center gap-1 rounded-sm bg-arena-violet/20 px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-wider text-arena-violet">
                              <Crown className="h-2.5 w-2.5" /> Host
                            </span>
                          )}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">{f.status}</div>
                      </div>
                      <Link
                        to="/messages"
                        search={{ peer: f.id }}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Open messages with ${f.name}`}
                        className="ml-2 inline-flex shrink-0 items-center gap-1 rounded-md border border-arena-border bg-arena-panel-2/60 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-arena-cyan transition hover:border-arena-cyan/50 hover:text-white"
                      >
                        <MessageCircle className="h-3 w-3" /> Message
                      </Link>
                    </button>
                  );
                })}
              </div>
            </aside>

            {/* Chat panel — mirrors ArenaChatPanel */}
            <section className="arena-card flex h-[560px] min-h-[420px] min-w-0 flex-col rounded-2xl lg:h-[720px]">
              <div className="flex items-start justify-between gap-3 border-b border-arena-border px-4 py-3 sm:px-5 sm:py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="relative shrink-0">
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br text-[10px] font-bold uppercase tracking-wider text-white/90 shadow-inner ${avatarGradient(selected?.id ?? "empty")}`}
                      aria-label={selected ? `${selected.name} avatar` : "No conversation selected"}
                    >
                      {selected ? initials(selected.name) : <Users className="h-4 w-4 opacity-80" />}
                    </div>
                    {selected && (
                      <span
                        className={
                          "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-arena-panel " +
                          (selected.online ? "bg-success" : "bg-muted-foreground")
                        }
                      />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate font-display text-sm font-bold uppercase tracking-wider text-white">
                      {selected?.name ?? "Direct Messages"}
                    </h3>
                    <div className="mt-0.5 truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                      {selected?.status ?? "Pick a friend to start chatting"}
                    </div>
                  </div>
                </div>
                <button
                  className="shrink-0 text-muted-foreground transition hover:text-white"
                  aria-label="More"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
              </div>

              <div
                ref={scrollRef}
                className="flex-1 space-y-3 overflow-y-auto px-4 py-3 sm:space-y-3.5 sm:px-5 sm:py-4"
              >
                {signedOut && (
                  <div className="text-xs text-muted-foreground">
                    Sign in to send direct messages.
                  </div>
                )}
                {!signedOut && !selected && (
                  <div className="text-xs text-muted-foreground">
                    Select a friend on the left to open your chat.
                  </div>
                )}
                {!signedOut && selected && messagesLoading && (
                  <div className="text-xs text-muted-foreground">Loading messages…</div>
                )}
                {!signedOut && selected && !messagesLoading && messages.length === 0 && (
                  <div className="text-xs text-muted-foreground">
                    No messages yet with {selected.name}. Say hi 👋
                  </div>
                )}
                {selected &&
                  messages.map((m) => {
                    const mine = m.sender_id === userId;
                    const name = mine ? "You" : selected.name;
                    return (
                      <div key={m.id} className="flex items-start gap-2.5">
                        <div
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[10px] font-bold uppercase tracking-wider text-white/90 shadow-inner ${avatarGradient(m.sender_id)}`}
                          aria-label={`${name} avatar`}
                        >
                          {initials(name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`text-[13px] font-semibold ${mine ? "text-arena-cyan" : selected.isHost ? "text-arena-violet" : "text-white"}`}
                            >
                              {name}
                            </span>
                            <span className="ml-auto text-[10px] text-muted-foreground">
                              {timeLabel(m.created_at)}
                            </span>
                          </div>
                          <div className="mt-0.5 break-words text-[13px] text-white/90">{m.body}</div>
                        </div>
                      </div>
                    );
                  })}
              </div>

              <form onSubmit={submit} className="border-t border-arena-border p-3">
                <div className="flex items-center gap-2 rounded-xl border border-arena-border bg-arena-panel-2/60 px-3 py-1.5">
                  <input
                    disabled={!selected || !userId || busy}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={
                      signedOut
                        ? "Sign in to send a message"
                        : selected
                          ? `Message ${selected.name}...`
                          : "Select a friend to message"
                    }
                    maxLength={500}
                    className="min-w-0 flex-1 bg-transparent py-2 text-sm text-white placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
                  />
                  <button
                    type="button"
                    className="text-muted-foreground transition hover:text-white"
                    aria-label="Emoji"
                  >
                    <Smile className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground transition hover:text-white"
                    aria-label="Attach"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  <button
                    type="submit"
                    disabled={!draft.trim() || !selected || !userId || busy}
                    className="inline-flex items-center gap-1.5 rounded-md bg-arena-violet px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white shadow-[0_1px_0_0_rgba(0,0,0,0.25)] transition-[background-color,transform,box-shadow] duration-150 hover:bg-arena-violet active:bg-arena-violet/85 active:translate-y-px active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-arena-violet/60 focus-visible:ring-offset-2 focus-visible:ring-offset-arena-panel disabled:translate-y-0 disabled:opacity-50 disabled:shadow-none"
                  >
                    <Send className="h-3.5 w-3.5" strokeWidth={2.25} />
                    Send
                  </button>
                </div>
              </form>
            </section>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
