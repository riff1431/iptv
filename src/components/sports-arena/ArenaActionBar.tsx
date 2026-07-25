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
import type { PublicTv } from "@/lib/lounges.public.functions";
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
  onLeave?: () => void;
  onToggleChat?: () => void;
  chatVisible?: boolean;
  /** Match id when the action bar is mounted from a match page. Used to attribute tips. */
  matchId?: string | null;
  /** Host (recipient) user id who receives tips for this match/lounge. */
  hostUserId?: string | null;
  /** Display name for the host, shown in the tip composer. */
  hostName?: string | null;
};

const REACTIONS = ["🔥", "🎉", "😂", "😮", "👏", "❤️", "⚽", "🏀", "🏆", "💯"];


export function ArenaActionBar({
  loungeId,
  tvs = [],
  onLeave,
  onToggleChat,
  chatVisible = true,
  matchId = null,
  hostUserId = null,
  hostName = null,
}: ArenaActionBarProps) {
  const { user } = useAuth();
  const { send } = useLoungeChat(loungeId);

  const [voiceOn, setVoiceOn] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [allMuted, setAllMuted] = useState(false);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const [programOpen, setProgramOpen] = useState(false);

  async function sendReaction(emoji: string) {
    setReactionsOpen(false);
    if (!user) {
      toast.error("Sign in to send reactions");
      return;
    }
    if (!loungeId) {
      toast.error("Reactions unavailable in this lounge");
      return;
    }
    try {
      await send(emoji, "all");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send reaction");
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

  function toggleVoice() {
    if (!debounceClick("voice")) return;
    const next = !voiceOn;
    setVoiceOn(next);
    toast(next ? "Voice chat joined" : "Voice chat left");
  }
  function toggleMicMute() {
    if (!debounceClick("mic")) return;
    const next = !micMuted;
    setMicMuted(next);
    toast(next ? "Your mic is muted" : "Your mic is live");
  }
  function toggleMuteAll() {
    if (!debounceClick("all")) return;
    const next = !allMuted;
    setAllMuted(next);
    toast(next ? "Muted everyone in voice" : "Unmuted everyone in voice");
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
      label: voiceOn ? "Leave Voice" : "Voice Chat",
      icon: voiceOn ? Volume2 : Mic,
      onClick: toggleVoice,
      active: voiceOn,
    },
    {
      key: "mute-mic",
      label: micMuted ? "Unmute Mic" : "Mute Mic",
      icon: micMuted ? MicOff : Mic,
      onClick: toggleMicMute,
      active: micMuted,
    },
    {
      key: "mute-all",
      label: allMuted ? "Unmute All" : "Mute All",
      icon: UserX,
      onClick: toggleMuteAll,
      active: allMuted,
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
              Tonight's program
            </SheetTitle>
            <SheetDescription>
              Live matchups on every screen in this lounge.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {tvs.length === 0 && (
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
                  {tv.period_label && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {tv.period_label}
                      {tv.clock_label ? ` · ${tv.clock_label}` : ""}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-sm font-semibold text-white">
                  {tv.matchup || tv.display_name || "Untitled matchup"}
                </div>
                {(tv.home_label || tv.away_label) && (
                  <div className="mt-1 flex items-center justify-between text-xs text-white/80">
                    <span>{tv.home_label ?? "Home"}</span>
                    <span className="font-mono font-bold text-white">
                      {tv.home_score} – {tv.away_score}
                    </span>
                    <span>{tv.away_label ?? "Away"}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
