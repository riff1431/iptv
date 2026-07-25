import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Command as CommandIcon,
  Home,
  Trophy,
  Tv,
  MessageCircle,
  Wallet,
  
  User as UserIcon,
  LogOut,
  Search,
  Sparkles,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";

type QuickAction = {
  onSignOut?: () => void | Promise<void>;
  isAdmin?: boolean;
};

/**
 * ⌘K / Ctrl+K command palette. Opens from any page via keyboard shortcut
 * or the trigger button rendered in the AppShell header. Provides fuzzy
 * navigation to every top-level route plus a quick sign-out action.
 */
export function NavCommandPalette({ onSignOut, isAdmin }: QuickAction) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (to: string) => {
    setOpen(false);
    void navigate({ to: to as never });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open command palette"
        className="group hidden items-center gap-2 rounded-md border border-arena-border bg-arena-panel/60 px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:bg-arena-panel hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 md:inline-flex"
      >
        <Search className="h-3.5 w-3.5 transition-colors group-hover:text-primary" aria-hidden="true" />
        <span className="hidden lg:inline">Search</span>
        <kbd className="ml-1 hidden items-center gap-0.5 rounded border border-arena-border bg-arena-bg/70 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground lg:inline-flex">
          <CommandIcon className="h-2.5 w-2.5" aria-hidden="true" />K
        </kbd>
      </button>

      {/* Mobile / compact trigger */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open command palette"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-arena-border bg-arena-panel/60 text-muted-foreground transition hover:border-primary/40 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 md:hidden"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search pages, actions…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Navigate">
            <CommandItem onSelect={() => go("/")}>
              <Home className="mr-2 h-4 w-4" />
              <span>Home</span>
            </CommandItem>
            <CommandItem onSelect={() => go("/arena")}>
              <Trophy className="mr-2 h-4 w-4" />
              <span>Arena</span>
            </CommandItem>
            {isAdmin && (
              <CommandItem onSelect={() => go("/iptv")}>
                <Tv className="mr-2 h-4 w-4" />
                <span>IPTV</span>
              </CommandItem>
            )}
            <CommandItem onSelect={() => go("/messages")}>
              <MessageCircle className="mr-2 h-4 w-4" />
              <span>Messages</span>
            </CommandItem>
            <CommandItem onSelect={() => go("/wallet")}>
              <Wallet className="mr-2 h-4 w-4" />
              <span>Wallet</span>
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Quick actions">
            <CommandItem onSelect={() => go("/profile")}>
              <UserIcon className="mr-2 h-4 w-4" />
              <span>View profile</span>
            </CommandItem>
            <CommandItem onSelect={() => go("/wallet")}>
              <Sparkles className="mr-2 h-4 w-4" />
              <span>Top up wallet</span>
              <CommandShortcut>$</CommandShortcut>
            </CommandItem>
            {onSignOut && (
              <CommandItem
                onSelect={() => {
                  setOpen(false);
                  void onSignOut();
                }}
              >
                <LogOut className="mr-2 h-4 w-4" />
                <span>Sign out</span>
              </CommandItem>
            )}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
