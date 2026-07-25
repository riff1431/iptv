#!/usr/bin/env node
// Static guard: fails when admin files use non-Arena button variants
// or raw color/border utilities that bypass the Arena tokens.
//
// Run:  bun scripts/check-arena-admin.mjs
// Also wired as `npm run check:arena`.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["src/routes", "src/components/admin"];
const ADMIN_MATCH = /(^|\/)admin([./]|$)|(^|\/)Admin/;

// Forbidden patterns → each entry is [regex, human message].
// Keep this list in sync with src/components/ui/button.tsx variants and
// the arena utilities in src/styles.css.
const RULES = [
  [
    /<Button[^>]*\bvariant=(["'])(default|outline|secondary|ghost)\1/g,
    'Use variant="arena" | "arenaOutline" | "arenaGhost" on admin <Button>.',
  ],
  [
    /\bbg-card\b/g,
    "Use the `arena-card` utility (or bg-arena-panel/bg-arena-panel-2) instead of bg-card.",
  ],
  [
    /\bbg-background\b/g,
    "Use bg-arena-panel-2/60 for form controls instead of bg-background.",
  ],
  [
    /\bborder-border\b/g,
    "Use border-arena-border instead of border-border.",
  ],
  [
    /\bdivide-border\b/g,
    "Use divide-arena-border instead of divide-border.",
  ],
  [
    /\bbg-muted\b(?!-foreground)/g,
    "Use bg-arena-panel-2 (or an arena token) instead of bg-muted.",
  ],
  [
    /<thead[^>]*>\s*<tr>\s*<th(?![^>]*\barena-th\b)/g,
    "Admin table <th> cells must use the `arena-th` utility class.",
  ],
];

// Files intentionally exempt from the raw-token rules (e.g. auto-gen).
const EXEMPT = new Set([]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) yield* walk(full);
    else if (/\.(tsx?|jsx?)$/.test(name)) yield full;
  }
}

const violations = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const rel = relative(process.cwd(), file);
    if (!ADMIN_MATCH.test(rel) || EXEMPT.has(rel)) continue;
    const src = readFileSync(file, "utf8");
    for (const [pattern, message] of RULES) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(src))) {
        const line = src.slice(0, m.index).split("\n").length;
        violations.push({ file: rel, line, match: m[0].slice(0, 80), message });
      }
    }
  }
}

if (violations.length === 0) {
  console.log("✓ arena-admin: all admin files use Arena tokens & variants.");
  process.exit(0);
}

console.error(`✗ arena-admin: ${violations.length} violation(s):\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}`);
  console.error(`    ${v.message}`);
  console.error(`    → ${v.match.replace(/\s+/g, " ")}\n`);
}
process.exit(1);
