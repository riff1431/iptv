# QA Defects — PGX Sports Lounge

**Run date:** 2026-07-29 · **Environment:** local dev server (`vite dev`, `:8082`) against the shared Supabase · **Method:** live Playwright E2E with real credentials.

Only **verified, reproduced** defects are listed here. Each was confirmed by an automated test that fails deterministically (not flaky).

---

## DEFECT-001 — Admin is redirected to `/dashboard` instead of `/admin` after login

| | |
|---|---|
| **Status** | ✅ **FIXED (2026-07-29)** — added a `rolesLoaded` flag in `useAuth` and gated the post-login redirect on it; verified admin→`/admin`, user→`/dashboard`, open-redirect still neutralized. |
| **Severity** | Medium (UX / correctness — not a security issue) |
| **Area** | Authentication / post-login routing |
| **Reproducibility** | 100% (every admin login) |
| **Files** | [src/routes/auth.tsx:109-133](src/routes/auth.tsx#L109-L133) (redirect effect), [src/hooks/useAuth.tsx:121-162](src/hooks/useAuth.tsx#L121-L162) (role loading) |

### Summary
When an **admin** signs in with email/password, the app routes them to **`/dashboard`** (the regular-user home) instead of **`/admin`**. The admin *does* have the admin role — navigating to `/admin` directly works and the server-side `requireAdminRoute` guard passes — so this is purely a wrong **post-login redirect target**, not a permissions problem.

### Reproduction
1. Sign out completely.
2. Go to `/auth` and sign in as `admin@demo.lovable.app` / `Password123!`.
3. Observe the landing page is `/dashboard`, not `/admin`.

### Root cause
The post-login redirect effect in `auth.tsx` fires as soon as `!loading && user` is true, and picks the target from `isAdmin`:

```ts
// auth.tsx (abridged)
const fallback = isAdmin ? "/admin" : "/dashboard";   // line 112
const target = mode === "signup" ? "/dashboard" : (safeRedirect ?? fallback);
```

But `isAdmin` is derived from the `roles` state in `useAuth`, which is populated **asynchronously** by `fetchRoles()` after the Supabase `SIGNED_IN` event:

```ts
// useAuth.tsx onAuthStateChange (abridged)
const u = session?.user ?? null;
setUserStore(u);                                   // user set synchronously
if (u) void fetchRoles(u.id).then((r) => applyRoles(u.id, r));  // roles arrive LATER
```

Timeline on login: `SIGNED_IN` → `setUserStore(u)` (user populated) → redirect effect runs with `isAdmin === false` (roles not yet resolved) → navigates to `/dashboard` → `redirectedRef` is latched `true` → by the time `fetchRoles` resolves and `isAdmin` flips `true`, the one-shot redirect has already fired and will not re-run.

### Impact
- Admins land on the user dashboard and must manually navigate to `/admin` every session.
- Confirmed at the credential gate: `admin: OK -> /dashboard`.

### Suggested fix
Do not fire the role-aware redirect until roles for the signed-in user have been resolved. Options:
- Add a `rolesLoaded` flag to `useAuth` (false until `fetchRoles` resolves for the current user) and gate the effect on `!loading && user && rolesLoaded`.
- Or remove the one-shot `redirectedRef` latch for the *role-based fallback* and recompute the target when `isAdmin` changes (redirect again only if currently on `/dashboard` and `isAdmin` becomes true).

Either keeps the open-redirect sanitization intact (that part is verified working).

### Verification
Re-run the gating test `admin login should redirect to /admin (role-aware)` — it should pass (lands on `/admin`).
