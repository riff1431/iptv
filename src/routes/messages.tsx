import { createFileRoute, Link } from "@tanstack/react-router";
import { withAuth } from "@/components/RequireAuth";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  Inbox,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  Loader2,
  Users,
  Reply,
  X,
  CornerDownRight,
  Paperclip,
  FileText,
  Download,
  Image as ImageIcon,
  MoreVertical,
  Coins,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { z } from "zod";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { getMessageAttachmentUrl } from "@/lib/message-attachments.functions";
import { useServerFn } from "@tanstack/react-start";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TipComposerDialog } from "@/components/tips/TipComposerDialog";

const ATTACHMENT_BUCKET = "message-attachments";
const MAX_ATTACHMENT_SIZE = 15 * 1024 * 1024; // 15 MB
const MAX_ATTACHMENTS_PER_MESSAGE = 4;

type Attachment = {
  path: string;
  name: string;
  type: string;
  size: number;
};

type PendingUpload = {
  id: string;
  name: string;
  size: number;
  type: string;
  progress: "uploading" | "done" | "error";
  path?: string;
  error?: string;
};

function isImageAttachment(a: { type?: string; name?: string }) {
  if (a.type?.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(a.name ?? "");
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const searchSchema = z.object({
  peer: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/messages")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "Messages — PGX Sports Arena" },
      {
        name: "description",
        content:
          "Your direct message inbox. Reply to conversations across PGX Sports Arena.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: withAuth(MessagesPage),
});

type Conversation = {
  peerId: string;
  peerName: string;
  peerAvatar: string | null;
  lastBody: string;
  lastAt: string;
  lastFromMe: boolean;
  unread: number;
};

type ThreadMsg = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
  reply_to_id: string | null;
  attachments: Attachment[];
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

function timeLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    let h = d.getHours();
    const m = d.getMinutes().toString().padStart(2, "0");
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${m} ${ap}`;
  }
  return d.toLocaleDateString();
}

function MessagesPage() {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const qc = useQueryClient();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const [selectedId, setSelectedId] = useState<string | null>(search.peer || null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<ThreadMsg | null>(null);
  const [tipTarget, setTipTarget] = useState<{ messageId: string; body: string } | null>(null);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (search.peer && search.peer !== selectedId) setSelectedId(search.peer);
  }, [search.peer, selectedId]);

  // Conversations — group all DMs by peer, newest first
  const convosQuery = useQuery({
    queryKey: ["messages", "conversations", userId],
    enabled: !!userId,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async (): Promise<Conversation[]> => {
      if (!userId) return [];
      const { data: rows, error } = await supabase
        .from("direct_messages")
        .select("id, sender_id, recipient_id, body, created_at, read_at")
        .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;

      const map = new Map<string, Conversation>();
      for (const m of rows ?? []) {
        const peerId = m.sender_id === userId ? m.recipient_id : m.sender_id;
        const existing = map.get(peerId);
        const fromMe = m.sender_id === userId;
        const isUnread = !fromMe && !m.read_at;
        if (!existing) {
          map.set(peerId, {
            peerId,
            peerName: peerId.slice(0, 6),
            peerAvatar: null,
            lastBody: m.body,
            lastAt: m.created_at,
            lastFromMe: fromMe,
            unread: isUnread ? 1 : 0,
          });
        } else if (isUnread) {
          existing.unread += 1;
        }
      }

      const peerIds = Array.from(map.keys());
      if (peerIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", peerIds);
        for (const p of profs ?? []) {
          const c = map.get(p.id);
          if (c) {
            c.peerName = p.display_name ?? c.peerName;
            c.peerAvatar = p.avatar_url ?? null;
          }
        }
      }

      return Array.from(map.values()).sort(
        (a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime(),
      );
    },
  });

  // Selected thread — paginated backwards (newest first, load older on scroll up)
  const PAGE_SIZE = 40;
  const threadQuery = useInfiniteQuery({
    queryKey: ["messages", "thread", userId, selectedId],
    enabled: !!userId && !!selectedId,
    staleTime: Number.POSITIVE_INFINITY,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<ThreadMsg[]> => {
      if (!userId || !selectedId) return [];
      let q = supabase
        .from("direct_messages")
        .select("id, sender_id, recipient_id, body, created_at, read_at, reply_to_id, attachments")
        .or(
          `and(sender_id.eq.${userId},recipient_id.eq.${selectedId}),and(sender_id.eq.${selectedId},recipient_id.eq.${userId})`,
        )
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (pageParam) q = q.lt("created_at", pageParam);
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as unknown[]).map((row): ThreadMsg => {
        const r = row as Record<string, unknown>;
        const raw = Array.isArray(r.attachments) ? (r.attachments as unknown[]) : [];
        const atts: Attachment[] = raw
          .filter(
            (a): a is Record<string, unknown> =>
              typeof a === "object" && a !== null && "path" in a,
          )
          .map((a) => ({
            path: String(a.path ?? ""),
            name: String(a.name ?? "file"),
            type: String(a.type ?? "application/octet-stream"),
            size: Number(a.size ?? 0),
          }));
        return {
          id: String(r.id),
          sender_id: String(r.sender_id),
          recipient_id: String(r.recipient_id),
          body: String(r.body ?? ""),
          created_at: String(r.created_at),
          read_at: (r.read_at as string | null) ?? null,
          reply_to_id: (r.reply_to_id as string | null) ?? null,
          attachments: atts,
        };
      });
    },
    getNextPageParam: (lastPage) =>
      lastPage.length < PAGE_SIZE ? undefined : lastPage[lastPage.length - 1].created_at,
  });

  const threadMessages = useMemo<ThreadMsg[]>(() => {
    const pages = threadQuery.data?.pages ?? [];
    const map = new Map<string, ThreadMsg>();
    for (const p of pages) for (const m of p) map.set(m.id, m);
    return Array.from(map.values()).sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }, [threadQuery.data]);

  const totalLoaded = threadMessages.length;

  // Mark peer's messages as read when a thread opens
  useEffect(() => {
    if (!userId || !selectedId) return;
    (async () => {
      const { error } = await supabase
        .from("direct_messages")
        .update({ read_at: new Date().toISOString() })
        .eq("recipient_id", userId)
        .eq("sender_id", selectedId)
        .is("read_at", null);
      if (!error) {
        void qc.invalidateQueries({ queryKey: ["messages", "conversations", userId] });
      }
    })();
  }, [userId, selectedId, qc]);

  // Track scroll position so we can restore after prepending older messages,
  // and only auto-scroll to bottom on initial thread load or new outgoing/incoming
  // messages (not when loading older history).
  const prevScrollHeightRef = useRef<number>(0);
  const loadingOlderRef = useRef(false);
  const prevTotalRef = useRef(0);
  const prevSelectedRef = useRef<string | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Thread changed → jump to bottom
    if (prevSelectedRef.current !== selectedId) {
      prevSelectedRef.current = selectedId;
      prevTotalRef.current = totalLoaded;
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
      return;
    }
    if (loadingOlderRef.current) {
      // Preserve visual position after older messages prepended
      const delta = el.scrollHeight - prevScrollHeightRef.current;
      el.scrollTop = delta;
      loadingOlderRef.current = false;
    } else if (totalLoaded > prevTotalRef.current) {
      // New tail message (sent or received via refresh) — stick to bottom
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
      if (nearBottom) {
        el.scrollTop = el.scrollHeight;
      }
    }
    prevTotalRef.current = totalLoaded;
  }, [totalLoaded, selectedId]);

  const onThreadScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (
      el.scrollTop < 80 &&
      threadQuery.hasNextPage &&
      !threadQuery.isFetchingNextPage &&
      !loadingOlderRef.current
    ) {
      loadingOlderRef.current = true;
      prevScrollHeightRef.current = el.scrollHeight;
      void threadQuery.fetchNextPage();
    }
  };

  // Persist selected peer in URL
  useEffect(() => {
    if (selectedId && selectedId !== search.peer) {
      void navigate({ search: { peer: selectedId }, replace: true });
    }
  }, [selectedId, search.peer, navigate]);

  const selectedConvo = useMemo(
    () => convosQuery.data?.find((c) => c.peerId === selectedId) ?? null,
    [convosQuery.data, selectedId],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = convosQuery.data ?? [];
    if (!q) return list;
    return list.filter(
      (c) => c.peerName.toLowerCase().includes(q) || c.lastBody.toLowerCase().includes(q),
    );
  }, [convosQuery.data, query]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["messages"] });
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !userId) return;
    const body = draft.trim();
    const readyAttachments: Attachment[] = pending
      .filter((p) => p.progress === "done" && p.path)
      .map((p) => ({ path: p.path!, name: p.name, size: p.size, type: p.type }));
    if (!body && readyAttachments.length === 0) return;
    if (pending.some((p) => p.progress === "uploading")) {
      toast.error("Wait for uploads to finish");
      return;
    }
    setSending(true);
    try {
      const { error } = await supabase.from("direct_messages").insert({
        sender_id: userId,
        recipient_id: selectedId,
        body,
        reply_to_id: replyTo?.id ?? null,
        attachments: readyAttachments,
      });
      if (error) throw error;
      setDraft("");
      setReplyTo(null);
      setPending([]);
      void qc.invalidateQueries({ queryKey: ["messages"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0 || !userId) return;
    const room = MAX_ATTACHMENTS_PER_MESSAGE - pending.length;
    if (room <= 0) {
      toast.error(`Up to ${MAX_ATTACHMENTS_PER_MESSAGE} attachments per message`);
      return;
    }
    const picked = Array.from(files).slice(0, room);

    for (const file of picked) {
      if (file.size > MAX_ATTACHMENT_SIZE) {
        toast.error(`"${file.name}" exceeds ${formatBytes(MAX_ATTACHMENT_SIZE)}`);
        continue;
      }
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;
      const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "file";
      const path = `${userId}/${id}-${safeName}`;

      setPending((prev) => [
        ...prev,
        {
          id,
          name: file.name,
          size: file.size,
          type: file.type || "application/octet-stream",
          progress: "uploading",
        },
      ]);

      const { error } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .upload(path, file, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });

      if (error) {
        setPending((prev) =>
          prev.map((p) =>
            p.id === id ? { ...p, progress: "error", error: error.message } : p,
          ),
        );
        toast.error(`Upload failed: ${file.name}`);
      } else {
        setPending((prev) =>
          prev.map((p) => (p.id === id ? { ...p, progress: "done", path } : p)),
        );
      }
    }
  }

  async function removePending(id: string) {
    const item = pending.find((p) => p.id === id);
    setPending((prev) => prev.filter((p) => p.id !== id));
    if (item?.path) {
      await supabase.storage.from(ATTACHMENT_BUCKET).remove([item.path]).catch(() => {});
    }
  }

  // Clear reply/attachment state when switching threads
  useEffect(() => {
    setReplyTo(null);
    setPending([]);
  }, [selectedId]);

  const messagesById = useMemo(() => {
    const m = new Map<string, ThreadMsg>();
    for (const t of threadMessages) m.set(t.id, t);
    return m;
  }, [threadMessages]);

  function startReply(msg: ThreadMsg) {
    setReplyTo(msg);
    // focus composer
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function scrollToMessage(id: string) {
    const el = document.getElementById(`msg-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-arena-violet/60");
      setTimeout(() => el.classList.remove("ring-2", "ring-arena-violet/60"), 1200);
    }
  }

  const signedOut = !authLoading && !userId;

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-4 pb-16 pt-4 sm:px-6 sm:pt-6">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-arena-violet">
              <Inbox className="h-4 w-4" /> Inbox
            </div>
            <h1 className="mt-1 font-display text-3xl font-extrabold uppercase tracking-tight text-arena-gradient sm:text-4xl">
              Messages
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/friends"
              className="inline-flex items-center gap-1.5 rounded-md border border-arena-border bg-arena-panel/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition hover:border-white/30 hover:text-white"
            >
              <Users className="h-3.5 w-3.5" /> Friends
            </Link>
            <button
              type="button"
              onClick={refresh}
              disabled={convosQuery.isFetching || threadQuery.isFetching}
              className="inline-flex items-center gap-1.5 rounded-md border border-arena-border bg-arena-panel/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-white transition hover:border-white/30 disabled:opacity-60"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${convosQuery.isFetching || threadQuery.isFetching ? "animate-spin" : ""}`}
              />
              Refresh
            </button>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          {/* Conversation list */}
          <aside className="arena-card flex h-[560px] min-w-0 flex-col rounded-2xl lg:h-[720px]">
            <div className="border-b border-arena-border px-3 py-2 sm:px-4">
              <div className="flex items-center gap-2 rounded-lg border border-arena-border bg-arena-panel-2/60 px-3 py-1.5">
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search conversations…"
                  className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-white placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
            </div>

            <div className="flex-1 space-y-1 overflow-y-auto p-2">
              {signedOut && (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  Sign in to see your messages.
                </div>
              )}
              {!signedOut && convosQuery.isLoading && (
                <div className="grid place-items-center gap-2 py-8 text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading conversations…
                </div>
              )}
              {!signedOut && convosQuery.error && (
                <div className="px-3 py-6 text-center text-xs text-destructive">
                  {convosQuery.error instanceof Error
                    ? convosQuery.error.message
                    : "Failed to load conversations"}
                </div>
              )}
              {!signedOut && !convosQuery.isLoading && filtered.length === 0 && (
                <div className="grid place-items-center gap-2 px-4 py-10 text-center">
                  <MessageCircle className="h-6 w-6 text-arena-violet" />
                  <div className="text-xs font-semibold text-white">
                    {(convosQuery.data ?? []).length === 0
                      ? "No conversations yet"
                      : `No results for "${query}"`}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Start one from{" "}
                    <Link to="/friends" className="text-arena-cyan hover:underline">
                      Friends
                    </Link>
                    .
                  </div>
                </div>
              )}
              {filtered.map((c) => {
                const active = c.peerId === selectedId;
                return (
                  <button
                    key={c.peerId}
                    onClick={() => setSelectedId(c.peerId)}
                    className={
                      "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition " +
                      (active
                        ? "border-arena-violet/50 bg-arena-violet/15 shadow-[0_0_18px_-8px_var(--arena-violet)]"
                        : "border-transparent hover:border-arena-border hover:bg-arena-panel-2/60")
                    }
                  >
                    <div className="shrink-0">
                      {c.peerAvatar ? (
                        <img
                          src={c.peerAvatar}
                          alt=""
                          className="h-10 w-10 rounded-full object-cover"
                        />
                      ) : (
                        <div
                          className={`h-10 w-10 rounded-full bg-gradient-to-br ${avatarGradient(c.peerId)}`}
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[13px] font-semibold text-white">
                          {c.peerName}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {timeLabel(c.lastAt)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            "truncate text-[11px] " +
                            (c.unread > 0 ? "font-semibold text-white/90" : "text-muted-foreground")
                          }
                        >
                          {c.lastFromMe && <span className="text-muted-foreground">You: </span>}
                          {c.lastBody}
                        </span>
                        {c.unread > 0 && (
                          <span className="ml-auto grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-live px-1 text-[10px] font-bold text-live-foreground">
                            {c.unread > 9 ? "9+" : c.unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Thread */}
          <section className="arena-card flex h-[560px] min-h-[420px] min-w-0 flex-col rounded-2xl lg:h-[720px]">
            <div className="flex items-start justify-between gap-3 border-b border-arena-border px-4 py-3 sm:px-5 sm:py-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="shrink-0">
                  {selectedConvo?.peerAvatar ? (
                    <img
                      src={selectedConvo.peerAvatar}
                      alt=""
                      className="h-9 w-9 rounded-full object-cover"
                    />
                  ) : (
                    <div
                      className={`h-9 w-9 rounded-full bg-gradient-to-br ${avatarGradient(selectedConvo?.peerId ?? selectedId ?? "empty")}`}
                    />
                  )}
                </div>
                <div className="min-w-0">
                  <h3 className="truncate font-display text-sm font-bold uppercase tracking-wider text-white">
                    {selectedConvo?.peerName ?? (selectedId ? selectedId.slice(0, 6) : "Direct Messages")}
                  </h3>
                  <div className="mt-0.5 truncate text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    {selectedId ? "Direct message" : "Pick a conversation to start"}
                  </div>
                </div>
              </div>
            </div>

            <div
              ref={scrollRef}
              onScroll={onThreadScroll}
              className="flex-1 space-y-3 overflow-y-auto px-4 py-3 sm:space-y-3.5 sm:px-5 sm:py-4"
            >
              {signedOut && (
                <div className="text-xs text-muted-foreground">
                  Sign in to view and send direct messages.
                </div>
              )}
              {!signedOut && !selectedId && (
                <div className="text-xs text-muted-foreground">
                  Select a conversation on the left to open it.
                </div>
              )}
              {!signedOut && selectedId && threadQuery.isLoading && (
                <div className="text-xs text-muted-foreground">Loading messages…</div>
              )}
              {!signedOut && selectedId && threadQuery.isFetchingNextPage && (
                <div className="flex items-center justify-center gap-2 py-2 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading older messages…
                </div>
              )}
              {!signedOut &&
                selectedId &&
                !threadQuery.isLoading &&
                threadMessages.length === 0 && (
                  <div className="text-xs text-muted-foreground">
                    No messages yet. Say hi 👋
                  </div>
                )}
              {!signedOut &&
                selectedId &&
                !threadQuery.hasNextPage &&
                threadMessages.length >= PAGE_SIZE && (
                  <div className="py-1 text-center text-[10px] uppercase tracking-wider text-muted-foreground">
                    Beginning of conversation
                  </div>
                )}
              {threadMessages.map((m) => {
                const mine = m.sender_id === userId;
                const parent = m.reply_to_id ? messagesById.get(m.reply_to_id) : null;
                const parentMine = parent ? parent.sender_id === userId : false;
                const parentName = parent
                  ? parentMine
                    ? "You"
                    : (selectedConvo?.peerName ?? parent.sender_id.slice(0, 6))
                  : null;
                return (
                  <div
                    key={m.id}
                    id={`msg-${m.id}`}
                    className="group flex items-start gap-2.5 rounded-md px-1 py-0.5 transition"
                  >
                    <div
                      className={`h-8 w-8 shrink-0 rounded-full bg-gradient-to-br ${avatarGradient(m.sender_id)}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={
                            "text-[13px] font-semibold " +
                            (mine ? "text-arena-cyan" : "text-white")
                          }
                        >
                          {mine ? "You" : (selectedConvo?.peerName ?? m.sender_id.slice(0, 6))}
                        </span>
                        <button
                          type="button"
                          onClick={() => startReply(m)}
                          className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground opacity-0 transition hover:bg-arena-panel-2/60 hover:text-white group-hover:opacity-100 focus:opacity-100"
                          aria-label="Reply to this message"
                        >
                          <Reply className="h-3 w-3" /> Reply
                        </button>
                        {!mine && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                aria-label="Message actions"
                                className="rounded p-0.5 text-muted-foreground opacity-0 transition hover:bg-arena-panel-2/60 hover:text-white focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-arena-violet/60 group-hover:opacity-100 data-[state=open]:opacity-100"
                              >
                                <MoreVertical className="h-3.5 w-3.5" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-[160px]">
                              <DropdownMenuItem
                                onSelect={(e) => {
                                  e.preventDefault();
                                  setTipTarget({ messageId: m.id, body: m.body ?? "" });
                                }}
                              >
                                <Coins className="mr-2 h-3.5 w-3.5 text-amber-400" />
                                Send tip
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          {timeLabel(m.created_at)}
                        </span>
                      </div>
                      {m.reply_to_id && (
                        <button
                          type="button"
                          onClick={() => parent && scrollToMessage(parent.id)}
                          className="mt-1 flex w-full min-w-0 items-start gap-1.5 rounded-md border-l-2 border-arena-violet/60 bg-arena-panel-2/40 px-2 py-1 text-left transition hover:bg-arena-panel-2/70"
                        >
                          <CornerDownRight className="mt-0.5 h-3 w-3 shrink-0 text-arena-violet" />
                          <div className="min-w-0 flex-1">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-arena-violet">
                              {parent ? `Replying to ${parentName}` : "Original message unavailable"}
                            </div>
                            {parent && (
                              <div className="truncate text-[11px] text-muted-foreground">
                                {parent.body}
                              </div>
                            )}
                          </div>
                        </button>
                      )}
                      {m.body && (
                        <div
                          onDoubleClick={() => startReply(m)}
                          className="mt-0.5 cursor-pointer break-words text-[13px] text-white/90"
                          title="Double-click to reply"
                        >
                          {m.body}
                        </div>
                      )}
                      {m.attachments.length > 0 && (
                        <MessageAttachments messageId={m.id} attachments={m.attachments} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <form onSubmit={submit} className="border-t border-arena-border p-3">
              {replyTo && (
                <div className="mb-2 flex items-start gap-2 rounded-lg border border-arena-violet/40 bg-arena-violet/10 px-3 py-2">
                  <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-arena-violet" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-arena-violet">
                      Replying to{" "}
                      {replyTo.sender_id === userId
                        ? "yourself"
                        : (selectedConvo?.peerName ?? replyTo.sender_id.slice(0, 6))}
                    </div>
                    <div className="truncate text-[12px] text-white/80">{replyTo.body}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReplyTo(null)}
                    aria-label="Cancel reply"
                    className="rounded p-1 text-muted-foreground transition hover:bg-arena-panel-2/60 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              {pending.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {pending.map((p) => (
                    <div
                      key={p.id}
                      className={
                        "flex items-center gap-2 rounded-lg border px-2 py-1.5 text-[11px] " +
                        (p.progress === "error"
                          ? "border-destructive/50 bg-destructive/10 text-destructive"
                          : "border-arena-border bg-arena-panel-2/60 text-white/90")
                      }
                    >
                      {p.progress === "uploading" ? (
                        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
                      ) : isImageAttachment(p) ? (
                        <ImageIcon className="h-3 w-3 shrink-0 text-arena-cyan" />
                      ) : (
                        <FileText className="h-3 w-3 shrink-0 text-arena-cyan" />
                      )}
                      <span className="max-w-[140px] truncate font-medium">{p.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatBytes(p.size)}
                      </span>
                      <button
                        type="button"
                        onClick={() => removePending(p.id)}
                        className="ml-0.5 rounded p-0.5 text-muted-foreground transition hover:bg-arena-panel/80 hover:text-white"
                        aria-label={`Remove ${p.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 rounded-xl border border-arena-border bg-arena-panel-2/60 px-3 py-1.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void handleFilesSelected(e.target.files);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={
                    !selectedId ||
                    !userId ||
                    sending ||
                    pending.length >= MAX_ATTACHMENTS_PER_MESSAGE
                  }
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-arena-panel/80 hover:text-white disabled:opacity-40"
                  aria-label="Attach files"
                  title="Attach files"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                <input
                  ref={inputRef}
                  disabled={!selectedId || !userId || sending}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={
                    signedOut
                      ? "Sign in to send a message"
                      : selectedId
                        ? `Message ${selectedConvo?.peerName ?? "…"}`
                        : "Select a conversation to reply"
                  }
                  maxLength={500}
                  className="min-w-0 flex-1 bg-transparent py-2 text-sm text-white placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={
                    (!draft.trim() &&
                      pending.filter((p) => p.progress === "done").length === 0) ||
                    !selectedId ||
                    !userId ||
                    sending ||
                    pending.some((p) => p.progress === "uploading")
                  }
                  className="inline-flex items-center gap-1.5 rounded-md bg-arena-violet px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white shadow-[0_1px_0_0_rgba(0,0,0,0.25)] transition hover:brightness-110 disabled:opacity-50"
                >
                  {sending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" strokeWidth={2.25} />
                  )}
                  Send
                </button>
              </div>
              <div className="mt-1 px-1 text-[10px] text-muted-foreground">
                Attach up to {MAX_ATTACHMENTS_PER_MESSAGE} files ({formatBytes(MAX_ATTACHMENT_SIZE)} each). New replies land when you press Refresh.
              </div>
            </form>
          </section>
        </div>
      </div>
      {tipTarget && selectedConvo && (
        <TipComposerDialog
          open={Boolean(tipTarget)}
          onOpenChange={(v) => !v && setTipTarget(null)}
          recipientUserId={selectedConvo.peerId}
          recipientName={selectedConvo.peerName ?? "this user"}
          directMessageId={tipTarget.messageId}
          messagePreview={tipTarget.body}
        />
      )}
    </AppShell>
  );
}

function MessageAttachments({
  messageId,
  attachments,
}: {
  messageId: string;
  attachments: Attachment[];
}) {
  const signFn = useServerFn(getMessageAttachmentUrl);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const requestedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    for (const a of attachments) {
      const key = a.path;
      if (urls[key] || errors[key] || requestedRef.current.has(key)) continue;
      requestedRef.current.add(key);
      signFn({ data: { messageId, path: a.path } })
        .then((res) => {
          if (!cancelled) setUrls((prev) => ({ ...prev, [key]: res.url }));
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setErrors((prev) => ({
              ...prev,
              [key]: err instanceof Error ? err.message : "Failed to load",
            }));
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [attachments, messageId, signFn, urls, errors]);

  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {attachments.map((a) => {
        const url = urls[a.path];
        const err = errors[a.path];
        const isImage = isImageAttachment(a);
        if (isImage) {
          return (
            <a
              key={a.path}
              href={url ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded-lg border border-arena-border bg-arena-panel-2/60"
              onClick={(e) => {
                if (!url) e.preventDefault();
              }}
              title={a.name}
            >
              {url ? (
                <img
                  src={url}
                  alt={a.name}
                  loading="lazy"
                  className="max-h-56 max-w-[280px] object-cover"
                />
              ) : (
                <div className="grid h-32 w-48 place-items-center text-[10px] text-muted-foreground">
                  {err ? (
                    <span className="text-destructive">{err}</span>
                  ) : (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                </div>
              )}
            </a>
          );
        }
        return (
          <a
            key={a.path}
            href={url ?? "#"}
            download={a.name}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              if (!url) e.preventDefault();
            }}
            className="inline-flex max-w-xs items-center gap-2 rounded-lg border border-arena-border bg-arena-panel-2/60 px-3 py-2 text-[12px] text-white/90 transition hover:border-arena-violet/50 hover:bg-arena-panel-2/80"
            title={a.name}
          >
            <FileText className="h-4 w-4 shrink-0 text-arena-cyan" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{a.name}</div>
              <div className="text-[10px] text-muted-foreground">
                {formatBytes(a.size)}
                {err ? ` · ${err}` : ""}
              </div>
            </div>
            {url ? (
              <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : err ? null : (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
            )}
          </a>
        );
      })}
    </div>
  );
}
