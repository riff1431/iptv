import { useRef, useState } from "react";
import {
  Smile,
  DollarSign,
  MessageCircle,
  Mic,
  MicOff,
  UserX,
  Volume2,
  Calendar,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useAuth } from "@/hooks/useAuth";
import { useLoungeChat } from "@/hooks/useLoungeChat";
import { useMatchChat } from "@/hooks/useMatchChat";
import { useVoiceRoom } from "@/hooks/useVoiceRoom";
import { muteAllInVoiceRoom } from "@/lib/voice-moderation.functions";
import type { PublicTv } from "@/lib/lounges.public.functions";
import type { PublicMatchSlot } from "@/lib/matches.public.functions";
import { EmojiGrid } from "@/components/sports-arena/EmojiGrid";
import { TipComposerDialog } from "@/components/tips/TipComposerDialog";

type Action = {
  key: string;
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
  danger?: boolean;
  active?: boolean;
};

export type ArenaActionBarProps = {
  loungeId: string | null;
  tvs?: PublicTv[];
  /** Match channel slots — shown in "Show Program" on match pages (where tvs is empty). */
  slots?: PublicMatchSlot[];
  onLeave?: () => void;
  onToggleChat?: () => void;
  chatVisible?: boolean;
  /** Match id when the action bar is mounted from a match page. Used to attribute tips. */
  matchId?: string | null;
  /** Host (recipient) user id who receives tips for this match/lounge. */
  hostUserId?: string | null;
  /** Display name for the host, shown in the tip composer. */
  hostName?: string | null;
  /** Whether the current user is the lounge/match owner (or admin) — gates "Mute All". */
  isHost?: boolean;
};

const REACTIONS = ["🔥", "🎉", "😂", "😮", "👏", "❤️", "⚽", "🏀", "🏆", "💯"];


export function ArenaActionBar({
  loungeId,
  tvs = [],
  slots = [],
  onLeave,
  onToggleChat,
  chatVisible = true,
  matchId = null,
  hostUserId = null,
  hostName = null,
  isHost = false,
}: ArenaActionBarProps) {
  const { user } = useAuth();
  // Match pages pass matchId; lounge pages pass loungeId. Pick the matching
  // chat hook so reactions insert into chat_messages.match_id (FK-correct) on
  // matches, instead of shoving the match id into lounge_id (which violates the
  // lounge_id→lounges FK + the room XOR constraint and silently fails the send).
  const loungeChat = useLoungeChat(matchId ? null : loungeId);
  const matchChat = useMatchChat(matchId);
  const { send } = matchId ? matchChat : loungeChat;

  // Real voice chat via LiveKit. The room is the match or lounge id.
  const voiceRoom = matchId ?? loungeId;
  const voice = useVoiceRoom(voiceRoom, user?.id);

  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const [programOpen, setProgramOpen] = useState(false);

  async function sendReaction(emoji: string) {
    setReactionsOpen(false);
    if (!user) {
      toast.error("Sign in to send reactions");
      return;
    }
    if (!loungeId && !matchId) {
      toast.error("Reactions unavailable in this lounge");
      return;
    }
    try {
      await send(emoji, "all");
    } catch (e) {
      // Supabase PostgrestError is shaped like { message } but isn't an
      // instanceof Error, so surface its message instead of the generic label.
      const msg = e instanceof Error ? e.message : (e as { message?: string } | null)?.message;
      toast.error(msg || "Could not send reaction");
    }
  }

  function openTip() {
    if (!user) {
      toast.error("Sign in to tip the host");
      return;
    }
    if (!hostUserId) {
      toast.error("Tipping unavailable", {
        description: "This match has no host set up to receive tips yet.",
      });
      return;
    }
    if (hostUserId === user.id) {
      toast.info("You're the host of this match", {
        description: "You can't tip yourself — tips from viewers land in your wallet.",
      });
      return;
    }
    setTipOpen(true);
  }


  // Per-toggle click debounce: collapse rapid double-clicks (< 350ms) into
  // one action so the mic/voice/all mute state doesn't flip twice and the
  // user only sees a single toast per intended action.
  const lastClickAt = useRef<Record<string, number>>({});
  function debounceClick(key: string): boolean {
    const now = Date.now();
    const last = lastClickAt.current[key] ?? 0;
    if (now - last < 350) return false;
    lastClickAt.current[key] = now;
    return true;
  }

  async function toggleVoice() {
    if (!debounceClick("voice")) return;
    if (!user) {
      toast.error("Sign in to join voice");
      return;
    }
    if (!voiceRoom) {
      toast.error("Voice unavailable in this lounge");
      return;
    }
    if (voice.isConnected) {
      await voice.disconnect();
      toast("Voice chat left");
      return;
    }
    const res = await voice.connect();
    if (res.ok) toast.success("Voice chat joined");
    else toast.error(res.error);
  }

  async function toggleMicMute() {
    if (!debounceClick("mic")) return;
    if (!voice.isConnected) {
      toast.error("Join voice chat first");
      return;
    }
    const res = await voice.toggleMic();
    if (res.ok) toast(res.enabled ? "Your mic is live" : "Your mic is muted");
    else toast.error(res.error);
  }

  async function toggleMuteAll() {
    if (!debounceClick("all")) return;
    if (!user) {
      toast.error("Sign in first");
      return;
    }
    // Mute-all is a moderation action; the server fn re-checks ownership, but
    // we gate the call here too so non-hosts get an instant explanation.
    if (!isHost) {
      toast.error("Only the host can mute everyone");
      return;
    }
    if (!voiceRoom) {
      toast.error("Voice unavailable");
      return;
    }
    try {
      const res = await muteAllInVoiceRoom({
        data: { room: voiceRoom, kind: matchId ? "match" : "lounge" },
      });
      toast.success(
        res.muted > 0
          ? `Muted ${res.muted} participant${res.muted === 1 ? "" : "s"}`
          : "No one else is speaking",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : (e as { message?: string } | null)?.message;
      toast.error(msg || "Failed to mute all");
    }
  }


  const actions: Action[] = [
    {
      key: "reactions",
      label: "Reactions",
      icon: Smile,
      onClick: () => setReactionsOpen((v) => !v),
      active: reactionsOpen,
    },
    { key: "tip", label: "Tip Host", icon: DollarSign, onClick: openTip },
    {
      key: "chat",
      label: chatVisible ? "Hide Chat" : "Chat",
      icon: MessageCircle,
      onClick: onToggleChat,
      active: chatVisible,
    },
    {
      key: "voice",
      label: voice.isConnected ? "Leave Voice" : "Voice Chat",
      icon: voice.isConnected ? Volume2 : Mic,
      onClick: toggleVoice,
      active: voice.isConnected,
    },
    {
      key: "mute-mic",
      label: voice.micEnabled ? "Mute Mic" : "Unmute Mic",
      icon: voice.micEnabled ? Mic : MicOff,
      onClick: toggleMicMute,
      active: !voice.micEnabled,
    },
    {
      key: "mute-all",
      label: "Mute All",
      icon: UserX,
      onClick: toggleMuteAll,
    },
    {
      key: "program",
      label: "Show Program",
      icon: Calendar,
      onClick: () => setProgramOpen(true),
    },
    {
      key: "leave",
      label: "Leave Arena",
      icon: LogOut,
      onClick: onLeave,
      danger: true,
    },
  ];

  return (
    <>
      <div className="mt-4 flex justify-center sm:mt-6">
        <div className="flex w-full max-w-4xl items-center justify-start gap-1 overflow-x-auto rounded-2xl border border-arena-border bg-arena-panel/80 px-2 py-3 backdrop-blur sm:justify-around sm:gap-2 sm:px-4 sm:py-4">
          {actions.map((a) => {
            const Icon = a.icon;
            const danger = a.danger;
            const active = a.active;

            const button = (
              <button
                key={a.key}
                type="button"
                onClick={a.onClick}
                aria-pressed={active ? true : undefined}
                className={`group flex min-w-[64px] shrink-0 flex-col items-center gap-1.5 px-1 transition sm:min-w-[72px] sm:gap-2 sm:px-2 ${
                  danger ? "text-live" : "text-white/85 hover:text-white"
                }`}
              >
                <span
                  className={`flex h-11 w-11 items-center justify-center rounded-full border transition ${
                    danger
                      ? "border-live/70 bg-live/10 text-live group-hover:bg-live/20"
                      : active
                        ? "border-arena-violet bg-arena-violet/20 text-white shadow-[0_0_18px_-4px_var(--arena-violet)]"
                        : "border-white/20 bg-white/[0.03] text-white/90 group-hover:border-white/40 group-hover:bg-white/[0.06]"
                  }`}
                >
                  <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
                </span>
                <span
                  className={`text-[10px] font-bold uppercase tracking-[0.12em] ${
                    danger ? "text-live" : ""
                  }`}
                >
                  {a.label}
                </span>
              </button>
            );

            if (a.key === "reactions") {
              return (
                <Popover
                  key={a.key}
                  open={reactionsOpen}
                  onOpenChange={setReactionsOpen}
                >
                  <PopoverTrigger asChild>{button}</PopoverTrigger>
                  <PopoverContent
                    align="center"
                    side="top"
                    aria-label="Send a reaction"
                    className="w-auto border-arena-border bg-arena-panel p-2"
                  >
                    <EmojiGrid
                      emojis={REACTIONS}
                      columns={5}
                      ariaLabel="Reactions"
                      onSelect={(r) => void sendReaction(r)}
                      buttonClassName="flex h-10 w-10 items-center justify-center rounded-md text-xl transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-arena-violet"
                    />
                  </PopoverContent>
                </Popover>
              );
            }
            return button;
          })}
        </div>
      </div>

      {tipOpen && hostUserId && user?.id !== hostUserId && (
        <TipComposerDialog
          open={tipOpen}
          onOpenChange={setTipOpen}
          recipientUserId={hostUserId}
          recipientName={hostName?.trim() || "Match host"}
          matchId={matchId ?? undefined}
          loungeId={matchId ? undefined : loungeId ?? undefined}
        />
      )}



      <Sheet open={programOpen} onOpenChange={setProgramOpen}>
        <SheetContent
          side="right"
          className="w-full border-arena-border bg-arena-panel text-white sm:max-w-md"
        >
          <SheetHeader>
            <SheetTitle className="font-display uppercase tracking-wider text-white">
              {tvs.length > 0 ? "Tonight's program" : "Match channels"}
            </SheetTitle>
            <SheetDescription>
              {tvs.length > 0
                ? "Live matchups on every screen in this lounge."
                : "Channels available for this match."}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {tvs.length === 0 && slots.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No screens are live in this lounge yet.
              </p>
            )}
            {tvs.map((tv) => (
              <div
                key={tv.id}
                className="rounded-lg border border-arena-border bg-arena-panel-2/50 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-arena-violet">
                    TV {tv.slot} · {tv.sport || "Live"}
                  </span>
                </div>
                <div className="mt-1 text-sm font-semibold text-white">
                  {tv.matchup || tv.display_name || "Untitled matchup"}
                </div>
              </div>
            ))}
            {tvs.length === 0 &&
              slots.map((s) => (
                <div
                  key={s.slot}
                  className="flex items-center gap-3 rounded-lg border border-arena-border bg-arena-panel-2/50 p-3"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded border border-arena-border bg-arena-panel">
                    {s.channelLogo ? (
                      <img
                        src={s.channelLogo}
                        alt=""
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <span className="text-[10px] font-bold text-muted-foreground">
                        CH{s.slot}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-arena-violet">
                      Channel {s.slot}
                    </div>
                    <div className="mt-0.5 truncate text-sm font-semibold text-white">
                      {s.channelName || (s.enabled ? "Live channel" : "No channel")}
                    </div>
                  </div>
                  <span
                    className={`ml-auto rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                      s.enabled
                        ? "bg-success/15 text-success"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {s.enabled ? "On" : "Off"}
                  </span>
                </div>
              ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
