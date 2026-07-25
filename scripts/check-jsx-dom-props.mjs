#!/usr/bin/env node
/**
 * Build-time guard: fail if any JSX in src/ uses lowercase DOM attributes
 * that React expects in camelCase (e.g. `fetchpriority` → `fetchPriority`).
 *
 * React 19 warns loudly and, for some props, refuses to hydrate. Catch
 * these at CI time rather than at runtime in the browser.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const srcDir = resolve(root, "src");

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

// Lowercase HTML attribute → React camelCase equivalent.
// Only include attrs React actively warns about and that appear as JSX props.
const INVALID_PROPS = {
  fetchpriority: "fetchPriority",
  crossorigin: "crossOrigin",
  autofocus: "autoFocus",
  autoplay: "autoPlay",
  autocomplete: "autoComplete",
  autocapitalize: "autoCapitalize",
  autocorrect: "autoCorrect",
  contenteditable: "contentEditable",
  spellcheck: "spellCheck",
  tabindex: "tabIndex",
  readonly: "readOnly",
  maxlength: "maxLength",
  minlength: "minLength",
  novalidate: "noValidate",
  formnovalidate: "formNoValidate",
  enctype: "encType",
  srcset: "srcSet",
  srcdoc: "srcDoc",
  usemap: "useMap",
  accesskey: "accessKey",
  playsinline: "playsInline",
  allowfullscreen: "allowFullScreen",
  frameborder: "frameBorder",
  marginwidth: "marginWidth",
  marginheight: "marginHeight",
  referrerpolicy: "referrerPolicy",
};

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".output"]);
const EXTS = new Set([".tsx", ".jsx"]);
// Skip generated files.
const SKIP_FILE = (p) => p.endsWith(".gen.ts") || p.endsWith(".gen.tsx");

/** @param {string} dir */
function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (EXTS.has(extname(entry)) && !SKIP_FILE(full)) yield full;
  }
}

const violations = [];

for (const file of walk(srcDir)) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const bad of Object.keys(INVALID_PROPS)) {
      // Match JSX prop usage: whitespace/newline/`<Tag` boundary before, `=` after.
      // JSX prop boundary: preceded by whitespace or `{`, not by `.`, `-`, or ident chars.
      const re = new RegExp(`(?<![A-Za-z0-9_$.\\-])${bad}\\s*=(?!=)`, "g");
      if (re.test(line)) {
        violations.push({
          file: relative(root, file),
          line: i + 1,
          col: line.indexOf(bad) + 1,
          bad,
          good: INVALID_PROPS[bad],
          snippet: line.trim(),
        });
      }
    }
  }
}

console.log(bold("[check-jsx-dom-props] Scanning src/ for invalid JSX DOM properties"));

if (violations.length === 0) {
  console.log(green("[check-jsx-dom-props] OK — no invalid JSX DOM properties found."));
  process.exit(0);
}

console.error(red(`[check-jsx-dom-props] Found ${violations.length} violation(s):\n`));
for (const v of violations) {
  console.error(
    `  ${yellow(`${v.file}:${v.line}:${v.col}`)}  ${red(v.bad)} → use ${green(v.good)}`,
  );
  console.error(`    ${v.snippet}`);
}
console.error(
  red(
    `\n[check-jsx-dom-props] React expects camelCase DOM props. ` +
      `Rename the attributes above and retry.`,
  ),
);
process.exit(1);
