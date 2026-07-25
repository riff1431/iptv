"""Visual regression snapshots for admin pages.

Usage:
    python3 e2e/visual/snapshot-admin.py            # compare against baselines
    python3 e2e/visual/snapshot-admin.py --update   # refresh baselines

Reads the managed Supabase session from LOVABLE_BROWSER_SUPABASE_* env vars so
the admin routes can render. When those vars are absent, only public preview
routes are snapshotted and the script prints a hint.

Requires an admin-role user for the injected session. Baselines live under
e2e/visual/baselines/. Diffs from failed comparisons are written to
e2e/visual/diffs/ (gitignored).
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

from PIL import Image, ImageChops
from playwright.async_api import async_playwright

ROOT = Path(__file__).parent
BASELINES = ROOT / "baselines"
DIFFS = ROOT / "diffs"
BASELINES.mkdir(parents=True, exist_ok=True)
DIFFS.mkdir(parents=True, exist_ok=True)

BASE_URL = os.environ.get("VISUAL_BASE_URL", "http://localhost:8080")
UPDATE = "--update" in sys.argv
# Fraction of pixels allowed to differ (0.0 = pixel-perfect).
TOLERANCE = float(os.environ.get("VISUAL_TOLERANCE", "0.005"))

# name → path. Add new admin routes here to lock their visual style.
ROUTES = [
    ("admin-index", "/admin"),
    ("admin-users", "/admin/users"),
    ("admin-lounges", "/admin/lounges"),
    ("admin-tvs", "/admin/tvs"),
    ("admin-ads", "/admin/ads"),
    ("admin-health", "/admin/health"),
    ("admin-settings", "/admin/settings"),
]


async def restore_session(context, page) -> bool:
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
    if not (storage_key and session_json):
        return False
    if cookies_json:
        cookies = json.loads(cookies_json)
        for c in cookies:
            c["url"] = BASE_URL
        await context.add_cookies(cookies)
    await page.goto(BASE_URL)
    await page.evaluate(
        f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
    )
    return True


def diff_ratio(a: Image.Image, b: Image.Image) -> float:
    if a.size != b.size:
        return 1.0
    diff = ImageChops.difference(a.convert("RGB"), b.convert("RGB"))
    bbox = diff.getbbox()
    if bbox is None:
        return 0.0
    # Count pixels above a small per-channel threshold.
    data = diff.crop(bbox).getdata()
    changed = sum(1 for px in data if max(px) > 8)
    total = a.size[0] * a.size[1]
    return changed / total


async def main() -> int:
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 1800},
            device_scale_factor=1,
        )
        page = await context.new_page()

        signed_in = await restore_session(context, page)
        if not signed_in:
            print(
                "! LOVABLE_BROWSER_SUPABASE_* not set — admin routes will hit the auth gate.\n"
                "  Sign in via the preview to inject a session, then re-run."
            )

        failures: list[str] = []
        for name, route in ROUTES:
            url = f"{BASE_URL}{route}"
            await page.goto(url, wait_until="networkidle")
            # Let animations settle.
            await page.wait_for_timeout(400)
            shot = BASELINES / f"{name}.png" if UPDATE else DIFFS / f"{name}.actual.png"
            await page.screenshot(path=str(shot))

            if UPDATE:
                print(f"↻ baseline updated: {name}")
                continue

            baseline_path = BASELINES / f"{name}.png"
            if not baseline_path.exists():
                print(f"? no baseline for {name} — run with --update first.")
                failures.append(name)
                continue

            actual = Image.open(shot)
            baseline = Image.open(baseline_path)
            ratio = diff_ratio(baseline, actual)
            if ratio > TOLERANCE:
                # Emit a side-by-side diff for triage.
                diff = ImageChops.difference(
                    baseline.convert("RGB"), actual.convert("RGB")
                )
                diff.save(DIFFS / f"{name}.diff.png")
                print(f"✗ {name}: {ratio:.3%} pixels changed (tolerance {TOLERANCE:.3%})")
                failures.append(name)
            else:
                print(f"✓ {name}: {ratio:.3%} within tolerance")
                # Clean the temp actual on pass.
                shot.unlink(missing_ok=True)

        await browser.close()
        if failures and not UPDATE:
            print(f"\n{len(failures)} snapshot(s) drifted. Inspect e2e/visual/diffs/*.diff.png.")
            return 1
        return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
