# QA Results Report — PGX Sports Lounge

**Date:** 2026-07-29
**Tester:** Automated E2E suite (Playwright/Node, custom harness)
**Target:** local dev server — `http://localhost:8082` (`vite dev`) against the shared Supabase backend
**Accounts used:** `admin@demo.lovable.app` (admin) · `demouser@pgx.com` (user)

---

## Executive summary

| Metric | Value |
|---|---|
| Automated checks executed | **54** |
| Passed | **53** |
| Failed | **1** (a real defect — DEFECT-001) |
| Routes covered | ~60 (24 admin + 15 user + public + IPTV/lounges/arena/messaging) |
| API endpoints covered | 10/10 |
| Defects found | 1 (Medium) — see [QA_DEFECTS.md](QA_DEFECTS.md) — **now fixed (2026-07-29)** |
| Baseline unit/integration suite | 235 passed / 11 skipped (unchanged) |

**Bottom line:** the system is in solid shape. Authentication, role-based access control, the IPTV SSRF/proxy security layer, admin CRUD, wallet money-validation, and form-validation parity all behave correctly. The single defect found (wrong admin landing page after login) has been **fixed and verified** — admins now land on `/admin`.

---

## Step 0 — Credential gate ✅
Both accounts authenticate successfully through the real `/auth` form:
- `admin@demo.lovable.app` → signs in (lands on `/dashboard` — see DEFECT-001 for why not `/admin`)
- `demouser@pgx.com` → signs in → `/dashboard`
- Wrong password is rejected with a friendly "Invalid email or password."

---

## Coverage matrix by area

| Area | Tests | Pass | Fail | Notes |
|---|---|---|---|---|
| Auth & account | 11 | 10 | 1 | DEFECT-001 (admin redirect) |
| Navigation smoke (all routes) | 2 | 2 | 0 | Every public + auth route renders, no 5xx/page errors |
| Role-based access control | 3 | 3 | 0 | All 20 `/admin/*` checked for admin/user/anon |
| Admin CRUD (create→delete) | 8 | 8 | 0 | Lounges, quick-dares, payment methods, ads, users, site-settings, TVs |
| Wallet & money flows | 6 | 6 | 0 | Top-up/withdrawal gates, min/max validation |
| IPTV | 3 | 3 | 0 | Grid, settings override, SSRF rejection surfaced |
| Lounges / Arena / gates | 6 | 6 | 0 | Browse + graceful handling of unknown ids + embed |
| Messaging & social | 3 | 3 | 0 | Friends, inbox, DM composer guard |
| API security & gating | 8 | 8 | 0 | SSRF truth table + auth gating on all endpoints |
| Form-validation parity | 4 | 4 | 0 | Client (Zod) parity confirmed |
| **Total** | **54** | **53** | **1** | |

---

## Key positive findings (things that work well)

1. **SSRF defense is robust.** The public M3U proxy (`/api/public/iptv/playlist`) rejected every payload in the truth table: loopback (`127.0.0.1`, `localhost`), cloud metadata (`169.254.169.254`), all RFC1918 ranges, decimal-IP shorthand (`2130706433`), bad scheme (`ftp://`), and userinfo smuggling (`http://example.com@127.0.0.1`).
2. **API auth gating is complete.** Every protected endpoint rejects unauthenticated/unsigned requests: health-check hook (apikey), proxy-metrics (token), sports-arena TV playlist (JWT), and both global Xtream relay endpoints (HMAC/sealed tokens).
3. **RBAC is enforced correctly and consistently.** Admin reaches all 20 admin routes; a signed-in non-admin is denied every one of them; a signed-out visitor is bounced to `/auth` (never leaks the admin UI). This holds on both the client guard and the server-side `requireAdminRoute`.
4. **Admin CRUD round-trips cleanly.** Create → list-verify → delete works for lounges, quick-dares, payment methods, and ads (each entity was created and then removed, leaving no residue).
5. **Wallet money-validation is tight.** Withdrawal submit is correctly disabled below the $5 minimum and above the $1000 maximum; top-up submit is disabled for $0; a valid withdrawal enables submit. Server-side destination validation also held (an invalid PayPal destination was rejected, no record created).
6. **Form-validation parity.** Client-side Zod schemas reject the same invalid inputs at the right field: short password, invalid email, bad username characters, missing 18+ agreement, short display name.
7. **Resilience to bad input.** Unknown lounge/match IDs and the embed route are handled gracefully — no 5xx, no blank screen, no uncaught page errors.

---

## Observations (non-blocking, not defects)

- **Withdrawal destination is validated at submit/server, not as a live gate.** The "Submit request" button enables once amount + method are valid, even before a destination is typed; the destination is then validated on submission. This is acceptable (server enforces it) but a live field-level check would be friendlier.
- **Admin TVs are a fixed 4-slot grid by design** (not arbitrary create/delete). The test confirms the 4 slots render; per-slot Xtream credential save/start-stop was not exhaustively exercised because it requires live upstream credentials.
- **Live external integrations** (LiveKit voice rooms, real IPTV upstreams, Google OAuth, real payment rails) were verified as "configured/reachable" only, not exhaustively transacted, to avoid side effects on external systems.
- **Money/tip happy-paths** that require an existing friend/match recipient or a pre-funded balance were tested at the validation/gate level rather than fully transacted, to avoid polluting append-only ledger tables (`wallet_transactions`, `tips`, `admin_audit_log`). These flows already have dedicated vitest integration coverage (e.g. `send-tip.integration.test.ts`).

---

## Defects

➡️ **1 defect found — see [QA_DEFECTS.md](QA_DEFECTS.md)**

**DEFECT-001 (Medium):** Admin redirected to `/dashboard` instead of `/admin` after login — a race between asynchronous role-loading and the one-shot post-login redirect. Fix is contained to `auth.tsx` / `useAuth.tsx`.

---

## How the run was performed

- **Baseline:** `npx vitest run` → 235 passed / 11 skipped (pre-existing coverage confirmed green).
- **Harness:** a self-contained Node + Playwright harness under `tests/qa/` (no new dependencies added — used the existing `playwright` package; `@playwright/test` was not installed and Python E2E could not run locally, so a minimal custom runner was built).
- **Auth:** each role logged in once through the real `/auth` form; sessions reused across tests. Login-validation tests used a fresh throwaway context per test to avoid cross-contamination.
- **Data safety:** all test-created entities were tagged `[QA]` and deleted in the same test (create→delete). A standalone cleanup pass (`tests/qa/cleanup.mjs`) swept any `[QA]` residue before and after the run (removed 3 accumulated payment-method orphans from earlier iterations). The demouser wallet was checked for orphaned withdrawals — none.
- **Capture:** screenshots, console errors, and 5xx responses captured on failure under `tests/qa/_artifacts/`.
- **Note:** the `tests/qa/` directory is **temporary** and is removed after the run; only this report and [QA_DEFECTS.md](QA_DEFECTS.md) persist.

---

## Appendix — full per-test results

### Auth & account
- ✅ [admin] admin context reaches /admin (no redirect)
- ✅ [user] user context reaches /dashboard (no redirect)
- ✅ [anon] signed-out hitting /admin redirects to /auth
- ✅ [anon] wrong password is rejected with friendly error
- ❌ [anon] admin login should redirect to /admin (role-aware) — **DEFECT-001**
- ✅ [anon] short password triggers client validation
- ✅ [anon] empty fields trigger client validation
- ✅ [anon] signup requires 18+ agreement
- ✅ [anon] signup rejects invalid username characters
- ✅ [anon] open-redirect payload (`//evil.example.com`) is neutralized on login
- ✅ [anon] forgot-password page renders

### Navigation smoke
- ✅ public routes render without errors (`/`, `/lobby`, `/schedule`, `/arena`, `/terms`, `/privacy`, `/forbidden`, `/sitemap.xml`)
- ✅ authenticated routes render without errors (`/dashboard`, `/profile`, `/wallet`, `/friends`, `/messages`, `/iptv`, `/iptv/settings`)

### Role-based access control
- ✅ admin reaches every `/admin/*` route (all 20)
- ✅ non-admin user is denied every `/admin/*` route
- ✅ signed-out is bounced from `/admin/*` to `/auth` (not /forbidden)

### Admin CRUD (create → verify → delete)
- ✅ lounges: create [QA] lounge then delete it
- ✅ quick-dares: create [QA] dare then delete it
- ✅ payment methods: create [QA] method then delete it
- ✅ ads: create [QA] ad then delete it
- ✅ users: search finds the demo user
- ✅ users: credit-wallet dialog opens and validates amount
- ✅ site-settings: website name round-trips and restores
- ✅ tvs: admin TV grid renders 4 fixed slots

### Wallet & money flows
- ✅ wallet page renders with a balance
- ✅ withdrawal submit disabled while amount < $5
- ✅ withdrawal submit enables for valid paypal withdrawal
- ✅ withdrawal submit disabled while amount > $1000 max
- ✅ top-up dialog opens and submit disabled for $0
- ✅ wallet exposes CSV/transaction export affordance

### IPTV
- ✅ IPTV channel grid renders
- ✅ IPTV settings: m3u override field present
- ✅ IPTV settings rejects a non-URL override on save

### Lounges / Arena / access gates
- ✅ lobby browser renders lounges section
- ✅ schedule page renders
- ✅ arena grid renders
- ✅ unknown lounge id handled gracefully (no 500/blank)
- ✅ unknown match id handled gracefully (no 500/blank)
- ✅ embed lounge route renders frameless (no crash)

### Messaging & social
- ✅ friends page renders
- ✅ messages inbox renders
- ✅ DM composer rejects empty body (if a thread is open)

### API endpoints — gating & security
- ✅ playlist proxy rejects every SSRF payload (9 variants)
- ✅ health-check hook rejects missing apikey
- ✅ health-check hook rejects wrong apikey
- ✅ proxy-metrics rejects missing token
- ✅ sports-arena TV playlist rejects unauthenticated request
- ✅ global Xtream relay rejects unsigned channel playlist
- ✅ global Xtream relay rejects unsigned segment
- ✅ public M3U proxy rejects an obviously invalid URL

### Form-validation parity
- ✅ profile rejects display name shorter than 2 chars
- ✅ signup rejects invalid email format
- ✅ signup password must be 6+ chars
- ✅ signin requires email/username presence
