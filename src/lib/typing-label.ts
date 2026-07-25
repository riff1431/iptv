export type TypingLabelInput = { name: string }[];

/**
 * Format a typing indicator label. Names are sorted alphabetically for a
 * stable order so the label doesn't jitter as broadcasts arrive.
 */
export function formatTypingLabel(typing: TypingLabelInput): string | null {
  if (typing.length === 0) return null;
  const names = typing.map((t) => t.name).sort((a, b) => a.localeCompare(b));
  const verb = names.length === 1 ? "is" : "are";
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} ${verb} typing…`;
  if (names.length === 3)
    return `${names[0]}, ${names[1]} and ${names[2]} ${verb} typing…`;
  const extra = names.length - 2;
  return `${names[0]}, ${names[1]} and ${extra} ${extra === 1 ? "other" : "others"} ${verb} typing…`;
}
