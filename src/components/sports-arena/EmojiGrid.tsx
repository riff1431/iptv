import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Accessible emoji grid with roving tabindex + arrow-key navigation.
 * Wrap in a Radix Popover — Popover already provides focus trap + Escape-to-close;
 * this component adds intra-grid keyboard navigation and ARIA grid semantics.
 */
export function EmojiGrid({
  emojis,
  columns = 5,
  onSelect,
  ariaLabel = "Emoji picker",
  buttonClassName = "flex h-9 w-9 items-center justify-center rounded-md text-lg transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-arena-violet",
}: {
  emojis: string[];
  columns?: number;
  onSelect: (emoji: string) => void;
  ariaLabel?: string;
  buttonClassName?: string;
}) {
  const [active, setActive] = useState(0);
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // When the popover mounts, put focus on the first cell so keyboard users
  // can navigate immediately instead of tabbing past the trigger.
  useEffect(() => {
    btnRefs.current[0]?.focus();
  }, []);

  const move = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(emojis.length - 1, next));
      setActive(clamped);
      btnRefs.current[clamped]?.focus();
    },
    [emojis.length],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        move(active + 1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        move(active - 1);
        break;
      case "ArrowDown":
        e.preventDefault();
        move(active + columns);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(active - columns);
        break;
      case "Home":
        e.preventDefault();
        move(0);
        break;
      case "End":
        e.preventDefault();
        move(emojis.length - 1);
        break;
    }
  }

  const rows: string[][] = [];
  for (let i = 0; i < emojis.length; i += columns) {
    rows.push(emojis.slice(i, i + columns));
  }

  return (
    <div
      role="grid"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className="grid gap-1"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {emojis.map((emoji, i) => (
        <button
          key={`${emoji}-${i}`}
          ref={(el) => {
            btnRefs.current[i] = el;
          }}
          role="gridcell"
          type="button"
          tabIndex={i === active ? 0 : -1}
          aria-label={`Insert ${emoji}`}
          onClick={() => onSelect(emoji)}
          onFocus={() => setActive(i)}
          className={buttonClassName}
        >
          {emoji}
        </button>
      ))}
      {/* Row landmarks for AT that expect grid rows */}
      <span className="sr-only" aria-hidden="true">
        {rows.length} rows, {columns} columns
      </span>
    </div>
  );
}
