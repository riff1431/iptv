#!/usr/bin/env node
// Summarize LHCI runs and diff against a baseline (if present).
// Reads .lighthouseci (head) and lhci-base (base). Writes:
//   - lhci-summary.md         (for PR comment)
//   - $GITHUB_STEP_SUMMARY    (for Actions UI checks tab)
import { readdirSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"];

function loadRuns(dir) {
  if (!existsSync(dir)) return {};
  const files = readdirSync(dir).filter((f) => f.startsWith("lhr-") && f.endsWith(".json"));
  const byUrl = {};
  for (const f of files) {
    try {
      const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
      const url = new URL(r.finalDisplayedUrl || r.finalUrl || r.requestedUrl).pathname || "/";
      const scores = {};
      for (const c of CATEGORIES) scores[c] = r.categories?.[c]?.score ?? null;
      const lcp = r.audits?.["largest-contentful-paint"]?.numericValue ?? null;
      const cls = r.audits?.["cumulative-layout-shift"]?.numericValue ?? null;
      const tbt = r.audits?.["total-blocking-time"]?.numericValue ?? null;
      (byUrl[url] ||= []).push({ scores, lcp, cls, tbt });
    } catch {}
  }
  // median per url
  const out = {};
  for (const [url, runs] of Object.entries(byUrl)) {
    const median = (key, sub) => {
      const vals = runs
        .map((r) => (sub ? r[key] : r.scores[key]))
        .filter((v) => v !== null && v !== undefined)
        .sort((a, b) => a - b);
      return vals.length ? vals[Math.floor(vals.length / 2)] : null;
    };
    out[url] = {
      scores: Object.fromEntries(CATEGORIES.map((c) => [c, median(c, false)])),
      lcp: median("lcp", true),
      cls: median("cls", true),
      tbt: median("tbt", true),
    };
  }
  return out;
}

const head = loadRuns(".lighthouseci");
const base = loadRuns("lhci-base");

const pct = (v) => (v == null ? "—" : Math.round(v * 100));
const ms = (v) => (v == null ? "—" : `${Math.round(v)}ms`);
const num = (v) => (v == null ? "—" : v.toFixed(3));

function delta(h, b, fmt = pct, higherBetter = true) {
  if (h == null || b == null) return fmt(h);
  const d = higherBetter ? (h - b) : (b - h);
  const sign = d > 0 ? "🟢 +" : d < 0 ? "🔴 " : "▪ ";
  const num = higherBetter ? Math.round((h - b) * 100) : Math.round(b - h);
  return `${fmt(h)} (${sign}${num})`;
}

let md = "## 🔦 Lighthouse CI\n\n";
const urls = Object.keys(head).sort();
if (urls.length === 0) {
  md += "_No Lighthouse results found._\n";
} else {
  md += "| Path | Perf | A11y | Best | SEO | LCP | CLS | TBT |\n";
  md += "|---|---|---|---|---|---|---|---|\n";
  for (const u of urls) {
    const h = head[u];
    const b = base[u] || {};
    md += `| \`${u}\` `;
    for (const c of CATEGORIES) {
      md += `| ${delta(h.scores[c], b.scores?.[c], pct, true)} `;
    }
    md += `| ${delta(h.lcp, b.lcp, ms, false)} `;
    md += `| ${delta(h.cls, b.cls, (v) => (v == null ? "—" : v.toFixed(3)), false)} `;
    md += `| ${delta(h.tbt, b.tbt, ms, false)} |\n`;
  }
  md += "\n_Median of 3 runs. Deltas vs base branch (🟢 improvement, 🔴 regression)._\n";
}

import { writeFileSync } from "node:fs";
writeFileSync("lhci-summary.md", md);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}
console.log(md);
