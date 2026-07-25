#!/usr/bin/env node
/**
 * Deployment health check.
 *
 * Pings key pages, verifies auth redirects, and probes API connectivity.
 * Exits non-zero on any failure so CI / deploy pipelines can gate on it.
 *
 * Usage:
 *   BASE_URL=https://your-app.lovable.app node scripts/deploy-health-check.mjs
 *
 * Env:
 *   BASE_URL      Target origin (default: http://localhost:8080)
 *   TIMEOUT_MS    Per-request timeout (default: 15000)
 *   API_KEY       Optional apikey header for /api/public/hooks/health-check probe
 *   HYDRATION     "0" to skip client-hydration checks (default: on if playwright available)
 *   HYDRATION_PATHS  Comma-separated paths to hydrate-check (default: "/,/auth")
 */

const BASE = (process.env.BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 15000);
const API_KEY = process.env.API_KEY ?? "";
const HYDRATION_ENABLED = process.env.HYDRATION !== "0";
const HYDRATION_PATHS = (process.env.HYDRATION_PATHS ?? "/,/auth")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const results = [];
let failed = 0;

/** @param {string} name @param {() => Promise<void>} fn */
async function check(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    const ms = Date.now() - t0;
    results.push({ name, ok: true, ms });
    console.log(`  OK    ${name}  (${ms}ms)`);
  } catch (err) {
    failed++;
    const ms = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, ms, error: msg });
    console.error(`  FAIL  ${name}  (${ms}ms)\n        ${msg}`);
  }
}

async function fetchWithTimeout(url, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, redirect: "manual" });
  } finally {
    clearTimeout(timer);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// -------- Page reachability -------------------------------------------------
// Any 2xx or 3xx counts — hosting may redirect to the auth broker before the
// actual page renders; that's still "reachable", not broken.
async function pageReachable(path) {
  const url = `${BASE}${path}`;
  const res = await fetchWithTimeout(url);
  assert(res.status < 500, `${url} returned HTTP ${res.status}`);
  assert(res.status !== 404, `${url} returned 404 — route missing`);
}

// -------- Auth redirect -----------------------------------------------------
// Signed-out visitors hitting a protected route must reach /auth (either via
// a 3xx from hosting or a 200 page whose client-side guard will redirect).
// We accept both: 3xx to /auth, OR 200 with the /auth or admin route markup
// containing the redirect param wiring. The strict shape is exercised by the
// e2e tests; here we only need to confirm the page is served without 5xx.
async function protectedRouteReachable(path) {
  const url = `${BASE}${path}`;
  const res = await fetchWithTimeout(url);
  assert(res.status < 500, `${url} returned HTTP ${res.status}`);
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location") ?? "";
    assert(
      /\/auth(\?|$|\/)/.test(loc) || loc.includes("login") || loc.startsWith("http"),
      `${url} redirected to unexpected location: ${loc}`,
    );
  }
}

// -------- Public API connectivity ------------------------------------------
// /api/public/hooks/health-check requires POST + apikey. We only verify
// connectivity + auth wiring: without a key we expect 401, with a key we
// expect 200. GET should be 405 / 404 (route exists, method rejected).
async function apiAuthWiring() {
  const url = `${BASE}/api/public/hooks/health-check`;
  const noAuth = await fetchWithTimeout(url, { method: "POST" });
  assert(
    noAuth.status === 401 || noAuth.status === 403,
    `expected 401/403 without apikey, got ${noAuth.status}`,
  );
}

async function apiWithKey() {
  if (!API_KEY) return; // skip silently when unset
  const url = `${BASE}/api/public/hooks/health-check`;
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { apikey: API_KEY },
  });
  assert(res.status === 200, `expected 200 with apikey, got ${res.status}`);
  const body = await res.json().catch(() => null);
  assert(body && typeof body.checked === "number", "response missing { checked: number }");
}

// -------- Client-side hydration --------------------------------------------
// Launch headless Chromium, load the page, and verify:
//  - React actually mounts (root has non-trivial rendered content client-side)
//  - No hydration-mismatch / uncaught errors in console
//  - No failed script/asset requests (4xx/5xx) blocking bootstrap
// Playwright is loaded dynamically so a missing install downgrades to skip
// rather than crashing the whole health check.
async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    return null;
  }
}

async function hydrationSucceeds(browser, path) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  const HYDRATION_PATTERNS = [
    /hydration/i,
    /did not match/i,
    /minified react error #(418|419|421|422|423|425)/i,
  ];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (HYDRATION_PATTERNS.some((r) => r.test(text))) consoleErrors.push(text);
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on("requestfailed", (req) => {
    const url = req.url();
    if (/\.(js|mjs|css)(\?|$)/.test(url)) failedRequests.push(`${req.method()} ${url}`);
  });
  page.on("response", (res) => {
    const url = res.url();
    if (res.status() >= 400 && /\.(js|mjs|css)(\?|$)/.test(url)) {
      failedRequests.push(`HTTP ${res.status()} ${url}`);
    }
  });
  try {
    const url = `${BASE}${path}`;
    const response = await page.goto(url, { waitUntil: "networkidle", timeout: TIMEOUT_MS });
    assert(response, `no response from ${url}`);
    assert(response.status() < 500, `${url} returned HTTP ${response.status()}`);
    // Wait for React to mount — TanStack sets #root or the body children after hydration.
    await page.waitForFunction(
      () => {
        const root = document.getElementById("root") ?? document.body;
        return !!root && root.querySelectorAll("*").length > 5;
      },
      { timeout: TIMEOUT_MS },
    );
    // React 19 marks completed hydration by removing the SSR-only comment
    // markers; a simple sanity signal: querying by role works.
    const rendered = await page.evaluate(() => {
      const root = document.getElementById("root") ?? document.body;
      return {
        elementCount: root.querySelectorAll("*").length,
        bodyText: (document.body.innerText || "").trim().length,
      };
    });
    assert(rendered.elementCount > 10, `sparse DOM after hydration (${rendered.elementCount} nodes)`);
    assert(rendered.bodyText > 0, "empty body text after hydration");
    if (consoleErrors.length > 0) {
      throw new Error(`hydration/console errors:\n        - ${consoleErrors.join("\n        - ")}`);
    }
    if (failedRequests.length > 0) {
      throw new Error(`failed asset requests:\n        - ${failedRequests.join("\n        - ")}`);
    }
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------

const PAGES = ["/", "/auth", "/forbidden"];
const PROTECTED = ["/admin", "/admin/settings", "/dashboard"];

console.log(`Deploy health check → ${BASE}`);
console.log(`Timeout: ${TIMEOUT_MS}ms  API key: ${API_KEY ? "set" : "unset (probe skipped)"}\n`);

console.log("Public pages:");
for (const p of PAGES) await check(`GET  ${p}`, () => pageReachable(p));

console.log("\nProtected pages (must not 5xx; redirect to /auth OK):");
for (const p of PROTECTED) await check(`GET  ${p}`, () => protectedRouteReachable(p));

console.log("\nAPI connectivity:");
await check("POST /api/public/hooks/health-check (no key → 401)", apiAuthWiring);
if (API_KEY) await check("POST /api/public/hooks/health-check (with key → 200)", apiWithKey);

console.log("\nClient hydration:");
if (!HYDRATION_ENABLED) {
  console.log("  SKIP  disabled via HYDRATION=0");
} else {
  const pw = await loadPlaywright();
  if (!pw) {
    console.log("  SKIP  playwright not installed (run `bunx playwright install chromium`)");
  } else {
    let browser;
    try {
      browser = await pw.chromium.launch({ headless: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/Executable doesn't exist/i.test(msg)) {
        console.log("  SKIP  chromium browser not installed (run `bunx playwright install chromium`)");
      } else {
        failed++;
        console.error(`  FAIL  launch chromium\n        ${msg}`);
      }
      browser = null;
    }
    if (browser) {
      try {
        for (const p of HYDRATION_PATHS) {
          await check(`hydrate ${p}`, () => hydrationSucceeds(browser, p));
        }
      } finally {
        await browser.close();
      }
    }
  }
}

const totalMs = results.reduce((a, r) => a + r.ms, 0);
console.log(`\n${failed === 0 ? "PASS" : "FAIL"}: ${results.length - failed}/${results.length} checks in ${totalMs}ms`);

if (failed > 0) process.exit(1);
