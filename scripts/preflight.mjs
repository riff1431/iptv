#!/usr/bin/env node
/**
 * Preflight check: ensures the Node.js runtime matches the version
 * pinned in .nvmrc before the build proceeds. Fails fast with a clear
 * message so Nixpacks/CI logs surface the mismatch immediately.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const nvmrcPath = resolve(__dirname, "..", ".nvmrc");

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

console.log(bold("[preflight] Verifying Node.js runtime"));

let required;
try {
  required = readFileSync(nvmrcPath, "utf8").trim().replace(/^v/, "");
} catch (err) {
  console.error(red(`[preflight] Failed to read .nvmrc: ${err.message}`));
  process.exit(1);
}

const requiredMajor = required.split(".")[0];
const actual = process.versions.node;
const actualMajor = actual.split(".")[0];

console.log(dim(`  .nvmrc requires: v${required} (major ${requiredMajor})`));
console.log(dim(`  runtime:         v${actual} (major ${actualMajor})`));
console.log(dim(`  platform:        ${process.platform}/${process.arch}`));

if (actualMajor !== requiredMajor) {
  console.error(
    red(
      `[preflight] Node major ${actualMajor} does not match required ${requiredMajor}.`,
    ),
  );
  console.error(
    red(
      `[preflight] Update the runtime (Nixpacks NIXPACKS_NODE_VERSION / nvm use) and retry.`,
    ),
  );
  process.exit(1);
}

console.log(green(`[preflight] Node v${actual} OK — proceeding with build.`));
