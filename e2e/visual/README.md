# Admin visual regression

Two layers of protection against non-Arena styling drifting into the admin
surface.

## 1. Static token guard (fast, no browser)

```bash
npm run check:arena
```

Fails when any file under `src/routes/admin.*.tsx` or `src/components/admin/`
uses:

- non-Arena `<Button variant="…">` (must be `arena` / `arenaOutline` / `arenaGhost`)
- raw `bg-card`, `bg-background`, `bg-muted`, `border-border`, `divide-border`
- `<thead><tr><th>` without the `arena-th` utility

Wire this into CI to block drift at PR time.

## 2. Pixel snapshots (visual truth)

```bash
# refresh baselines (do this after an intentional design change)
npm run visual:admin:update

# compare current preview against baselines
npm run visual:admin
```

Screens are captured against `http://localhost:8080` (override with
`VISUAL_BASE_URL`). Admin routes are auth-gated, so the script restores the
managed Supabase session from `LOVABLE_BROWSER_SUPABASE_*` env vars if
present. Sign into the preview as an admin user first so those vars are
injected, then re-run.

- Baselines: `e2e/visual/baselines/*.png` (committed)
- Diffs from failed runs: `e2e/visual/diffs/*.diff.png` (gitignored)
- Tolerance: 0.5% of pixels by default — override with `VISUAL_TOLERANCE`.

Add new admin routes to the `ROUTES` list at the top of
`snapshot-admin.py` to lock their visuals.
