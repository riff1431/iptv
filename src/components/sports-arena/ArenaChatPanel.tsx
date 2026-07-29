import { useEffect, useRef, useState } from "react";
import { MoreVertical, Send, Smile, Plus, Crown, Coins, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useLoungeChat } from "@/hooks/useLoungeChat";
import { useMatchChat } from "@/hooks/useMatchChat";
import { useTypingIndicator } from "@/hooks/useTypingIndicator";
import { formatTypingLabel } from "@/lib/typing-label";
import { EmojiGrid } from "@/components/sports-arena/EmojiGrid";
import { TipComposerDialog } from "@/components/tips/TipComposerDialog";

const EMOJIS = [
  "🔥",
  "🎉",
  "😂",
  "😮",
  "👏",
  "❤️",
  "⚽",
  "🏀",
  "🏆",
  "💯",
  "🥳",
  "🤯",
  "😎",
  "🙌",
  "👀",
];

function timeLabel(iso: string) {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

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

export type ArenaChatPanelProps = {
  loungeId?: string | null;
  matchId?: string | null;
  online?: number;
  /** When false the panel stays mounted but is visually hidden so state + scroll persist. */
  visible?: boolean;
};

export function ArenaChatPanel({
  loungeId = null,
  matchId = null,
  online = 1248,
  visible = true,
}: ArenaChatPanelProps) {
  const { user } = useAuth();
  const loungeChat = useLoungeChat(matchId ? null : loungeId);
  const matchChat = useMatchChat(matchId);
  const { messages, loading, send } = matchId ? matchChat : loungeChat;
  const roomId = matchId ?? loungeId;
  const roomLabel = matchId ? "Match Chat" : "Arena Chat";
  const emptyLabel = matchId
    ? "Chat unavailable for this match."
    : "Chat unavailable for demo lounges. Configure this lounge in Admin.";
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [profiles, setProfiles] = useState<
    Record<string, { name: string; avatarUrl: string | null }>
  >({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const savedScrollTop = useRef<number | null>(null);
  const wasAtBottom = useRef(true);

  const typingRoomKey = roomId ? `${matchId ? "match" : "lounge"}:${roomId}` : null;
  const { typing, notifyTyping } = useTypingIndicator(typingRoomKey, user?.id ?? null);
  const selfName =
    (user?.id && profiles[user.id]?.name) ||
    (user?.user_metadata as { display_name?: string } | undefined)?.display_name ||
    user?.email?.split("@")[0] ||
    "Someone";
  const typingLabel = formatTypingLabel(typing);

  const [tipTarget, setTipTarget] = useState<{
    userId: string;
    name: string;
    messageId: string;
    body: string;
  } | null>(null);

  useEffect(() => {
    const missing = Array.from(
      new Set(messages.map((m) => m.user_id).filter((id) => !(id in profiles))),
    );
    if (missing.length === 0) return;
    void supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .in("id", missing)
      .then(({ data }) => {
        setProfiles((cur) => {
          const next = { ...cur };
          // Cache a deterministic fallback for IDs with no profile row so the
          // effect does not retry the same empty lookup on every render.
          for (const id of missing) {
            next[id] = { name: id.slice(0, 6), avatarUrl: null };
          }
          for (const p of data ?? []) {
            next[p.id] = {
              name: p.display_name ?? p.id.slice(0, 6),
              avatarUrl: p.avatar_url ?? null,
            };
          }
          return next;
        });
      });
  }, [messages, profiles]);

  const [atBottom, setAtBottom] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const prevMsgCountRef = useRef(messages.length);

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    wasAtBottom.current = true;
    setAtBottom(true);
    setUnreadCount(0);
  };

  // Only auto-scroll to the newest message when the user was already at the
  // bottom — otherwise increment the unread counter shown on the jump button.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !visible) {
      prevMsgCountRef.current = messages.length;
      return;
    }
    const added = messages.length - prevMsgCountRef.current;
    prevMsgCountRef.current = messages.length;
    if (wasAtBottom.current) {
      el.scrollTo({ top: el.scrollHeight });
      setUnreadCount(0);
    } else if (added > 0) {
      setUnreadCount((n) => n + added);
    }
  }, [messages.length, visible]);

  // Save scrollTop before hide; restore after show. `display:none` on the
  // wrapper resets scrollTop in most browsers, so we manage it explicitly.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!visible) {
      savedScrollTop.current = el.scrollTop;
      wasAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    } else if (savedScrollTop.current != null) {
      // Restore on next frame after layout settles.
      const top = wasAtBottom.current ? el.scrollHeight : savedScrollTop.current;
      requestAnimationFrame(() => el.scrollTo({ top }));
    }
  }, [visible]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    wasAtBottom.current = isAtBottom;
    setAtBottom(isAtBottom);
    if (isAtBottom && unreadCount !== 0) setUnreadCount(0);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() || !roomId || !user) return;
    setBusy(true);
    try {
      await send(draft, "all");
      setDraft("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside
      aria-hidden={!visible}
      className={`arena-card relative flex h-[480px] min-h-[420px] flex-col rounded-2xl sm:h-[560px] lg:h-auto lg:min-h-0 lg:flex-1 ${visible ? "" : "hidden"}`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-arena-border px-4 py-3 sm:px-5 sm:py-4">
        <div>
          <h3 className="font-display text-sm font-bold uppercase tracking-wider text-white">
            {roomLabel}
          </h3>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-success">
            <span className="h-2 w-2 rounded-full bg-success shadow-[0_0_6px_var(--success)]" />
            <span className="text-white/90">{online.toLocaleString("en-US")}</span>
            <span className="text-success">ONLINE</span>
          </div>
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            aria-label={typingLabel ?? ""}
            className="mt-1 h-4 text-[11px] italic text-muted-foreground"
          >
            {typingLabel ? (
              <span className="inline-flex items-center gap-1" aria-hidden="true">
                <span className="inline-flex gap-0.5">
                  <span className="h-1 w-1 animate-bounce rounded-full bg-arena-cyan [animation-delay:-0.3s]" />
                  <span className="h-1 w-1 animate-bounce rounded-full bg-arena-cyan [animation-delay:-0.15s]" />
                  <span className="h-1 w-1 animate-bounce rounded-full bg-arena-cyan" />
                </span>
                {typingLabel}
              </span>
            ) : null}
          </div>
        </div>
        <button className="text-muted-foreground transition hover:text-white" aria-label="More">
          <MoreVertical className="h-4 w-4" />
        </button>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3 sm:space-y-3.5 sm:px-5 sm:py-4"
      >
        {!roomId && <div className="text-xs text-muted-foreground">{emptyLabel}</div>}
        {roomId && loading && <div className="text-xs text-muted-foreground">Loading chat…</div>}
        {roomId && !loading && messages.length === 0 && (
          <div className="text-xs text-muted-foreground">No messages yet. Say hi 👋</div>
        )}
        {messages.map((m) => {
          const profile = profiles[m.user_id];
          const name = profile?.name ?? m.user_id.slice(0, 6);
          const avatarUrl = profile?.avatarUrl ?? null;
          const nameParts = name.split(/\s+/).filter(Boolean);
          const initials =
            nameParts.length > 1
              ? nameParts
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join("")
                  .toUpperCase()
              : name.slice(0, 2).toUpperCase();
          const isHost = name.toLowerCase().includes("host") || name === "PlayGroundX";
          const isOwn = user?.id === m.user_id;
          return (
            <div key={m.id} className="group flex items-start gap-2.5">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={`${name}'s avatar`}
                  loading="lazy"
                  decoding="async"
                  onError={(e) => {
                    // Hide broken image so the gradient fallback shows.
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                  className={`h-8 w-8 shrink-0 rounded-full object-cover bg-gradient-to-br ${avatarGradient(m.user_id)}`}
                />
              ) : (
                <div
                  aria-hidden
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white/90 bg-gradient-to-br ${avatarGradient(m.user_id)}`}
                >
                  {initials || name.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-[13px] font-semibold ${isHost ? "text-arena-violet" : "text-arena-cyan"}`}
                  >
                    {name}
                  </span>
                  {isHost && (
                    <span className="inline-flex items-center gap-1 rounded-sm bg-arena-violet/20 px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-wider text-arena-violet">
                      <Crown className="h-2.5 w-2.5" /> Host
                    </span>
                  )}
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {timeLabel(m.created_at)}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Message actions for ${name}`}
                        className="rounded p-0.5 text-muted-foreground opacity-0 transition hover:text-white focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-arena-violet/60 group-hover:opacity-100 data-[state=open]:opacity-100"
                      >
                        <MoreVertical className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[160px]">
                      <DropdownMenuItem
                        disabled={isOwn || !user}
                        onSelect={(e) => {
                          e.preventDefault();
                          if (isOwn || !user) return;
                          setTipTarget({
                            userId: m.user_id,
                            name,
                            messageId: m.id,
                            body: m.body,
                          });
                        }}
                      >
                        <Coins className="mr-2 h-3.5 w-3.5 text-amber-400" />
                        Send tip
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="mt-0.5 break-words text-[13px] text-white/90">{m.body}</div>
              </div>
            </div>
          );
        })}
      </div>

      {!atBottom && roomId && (
        <button
          type="button"
          onClick={() => scrollToBottom("smooth")}
          className="absolute bottom-20 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-arena-border bg-arena-panel/95 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white shadow-lg backdrop-blur transition hover:border-arena-violet/60 hover:text-arena-violet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-arena-violet/60"
          aria-label={
            unreadCount > 0
              ? `Jump to latest, ${unreadCount} new ${unreadCount === 1 ? "message" : "messages"}`
              : "Jump to latest message"
          }
        >
          <ArrowDown className="h-3.5 w-3.5" />
          {unreadCount > 0 ? `${unreadCount} new` : "Jump to latest"}
        </button>
      )}

      <form onSubmit={submit} className="border-t border-arena-border p-3">
        <div className="flex items-center gap-2 rounded-xl border border-arena-border bg-arena-panel-2/60 px-3 py-1.5">
          <input
            disabled={!roomId || !user || busy}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (e.target.value.trim()) notifyTyping(selfName);
            }}
            placeholder="Type a message..."
            maxLength={500}
            className="flex-1 bg-transparent py-2 text-sm text-white placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
          />
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground transition hover:text-white disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-arena-violet rounded"
                aria-label="Insert emoji"
                aria-haspopup="dialog"
                disabled={!roomId || !user}
              >
                <Smile className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="end"
              aria-label="Emoji picker"
              className="w-auto border-arena-border bg-arena-panel p-2"
            >
              <EmojiGrid
                emojis={EMOJIS}
                columns={5}
                ariaLabel="Emojis"
                onSelect={(e) => setDraft((d) => d + e)}
              />
            </PopoverContent>
          </Popover>
          <button
            type="button"
            onClick={() => toast("Attachments are coming soon")}
            className="text-muted-foreground transition hover:text-white"
            aria-label="Attach"
          >
            <Plus className="h-4 w-4" />
          </button>

          <button
            type="submit"
            disabled={!draft.trim() || busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-arena-violet px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white shadow-[0_1px_0_0_rgba(0,0,0,0.25)] transition-[background-color,transform,box-shadow] duration-150 hover:bg-arena-violet active:bg-arena-violet/85 active:translate-y-px active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-arena-violet/60 focus-visible:ring-offset-2 focus-visible:ring-offset-arena-panel disabled:translate-y-0 disabled:opacity-50 disabled:shadow-none"
          >
            <Send className="h-3.5 w-3.5" strokeWidth={2.25} />
            Send
          </button>
        </div>
      </form>

      {tipTarget && roomId && (
        <TipComposerDialog
          open={Boolean(tipTarget)}
          onOpenChange={(v) => !v && setTipTarget(null)}
          recipientUserId={tipTarget.userId}
          recipientName={tipTarget.name}
          loungeId={loungeId ?? undefined}
          chatMessageId={tipTarget.messageId}
          messagePreview={tipTarget.body}
        />
      )}
    </aside>
  );
}
