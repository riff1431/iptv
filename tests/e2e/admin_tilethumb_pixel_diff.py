"""E2E pixel-level regression: capture each ThumbHeader banner as an isolated
element screenshot at mobile / tablet / desktop, and compare against a stored
baseline PNG. Any pixel drift above a small tolerance (subpixel AA jitter)
fails the run — this catches subtle icon alignment, spacing, gradient, and
sizing regressions that geometry-only assertions miss.

Layout:
  tests/e2e/baselines/tilethumb/<viewport>__<route>__<index>.png    # committed
  /tmp/browser/tilethumb-pixel/diffs/<viewport>__<route>__<index>.* # on drift

Usage:
  python tests/e2e/admin_tilethumb_pixel_diff.py           # verify
  UPDATE_BASELINES=1 python tests/e2e/admin_tilethumb_pixel_diff.py   # refresh

Tolerance: a pixel counts as "different" when any RGB channel differs by more
than 8/255 (ignores font/AA jitter); the run fails when >0.5% of pixels differ
or when the baseline dimensions no longer match (a size change is always a
real regression).
"""
import asyncio
import json
import os
import sys
from pathlib import Path
from PIL import Image, ImageChops
from playwright.async_api import async_playwright

REPO_ROOT = Path(__file__).resolve().parents[2]
BASELINES = REPO_ROOT / "tests" / "e2e" / "baselines" / "tilethumb"
DIFFS = Path("/tmp/browser/tilethumb-pixel/diffs")
BASELINES.mkdir(parents=True, exist_ok=True)
DIFFS.mkdir(parents=True, exist_ok=True)

VIEWPORTS = [("mobile", 390, 1800), ("tablet", 768, 1800), ("desktop", 1280, 1800)]
# route -> (selector, id-strategy). "index" numbers by DOM order; "attr" uses
# the element's data-permutation attribute so filenames stay stable when we
# add or reorder variants on the dev preview route.
ROUTES = [
    ("/admin", 'div.aspect-\\[16\\/3\\]', "index"),
    ("/wallet", 'div.aspect-\\[16\\/3\\]', "index"),
    ("/dev/tilethumb", "[data-permutation]", "attr"),
]

CHANNEL_TOLERANCE = 8       # per-channel delta ignored (AA jitter)
DIFF_RATIO_LIMIT = 0.005    # >0.5% differing pixels = fail
UPDATE = os.environ.get("UPDATE_BASELINES") == "1"


async def restore_session(context, page):
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
    if cookies_json:
        cookies = json.loads(cookies_json)
        for c in cookies:
            c["url"] = "http://localhost:8080"
        await context.add_cookies(cookies)
    await page.goto("http://localhost:8080", wait_until="domcontentloaded")
    if storage_key and session_json:
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
        )


def diff_ratio(a: Image.Image, b: Image.Image) -> tuple[float, Image.Image]:
    """Return (fraction of pixels beyond tolerance, visual diff image)."""
    if a.size != b.size:
        # Force-fail: size mismatch is a real regression, not AA jitter.
        return 1.0, ImageChops.difference(a.resize(b.size), b)
    diff = ImageChops.difference(a.convert("RGB"), b.convert("RGB"))
    bbox = diff.getbbox()
    if not bbox:
        return 0.0, diff
    px = diff.load()
    w, h = diff.size
    bad = 0
    for y in range(h):
        for x in range(w):
            r, g, bch = px[x, y]
            if r > CHANNEL_TOLERANCE or g > CHANNEL_TOLERANCE or bch > CHANNEL_TOLERANCE:
                bad += 1
    return bad / (w * h), diff


async def audit_route(page, viewport_name, route, selector, id_strategy):
    await page.goto(f"http://localhost:8080{route}", wait_until="networkidle", timeout=20000)
    await page.wait_for_timeout(1500)

    # Freeze animations / transitions to remove flake sources.
    await page.add_style_tag(content="""
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
    """)

    banners = page.locator(selector)
    count = await banners.count()
    assert count > 0, f"[{viewport_name} {route}] no banners found for `{selector}`"

    route_slug = route.strip("/").replace("/", "_") or "index"
    results = []

    for i in range(count):
        el = banners.nth(i)
        await el.scroll_into_view_if_needed()
        await page.wait_for_timeout(80)

        if id_strategy == "attr":
            attr = await el.get_attribute("data-permutation")
            ident = (attr or f"idx{i:02d}").replace("/", "_")
        else:
            ident = f"{i:02d}"
        name = f"{viewport_name}__{route_slug}__{ident}.png"
        baseline = BASELINES / name
        actual_bytes = await el.screenshot()

        if UPDATE or not baseline.exists():
            baseline.write_bytes(actual_bytes)
            results.append((name, "wrote-baseline", 0.0))
            continue

        actual = Image.open(__import__("io").BytesIO(actual_bytes))
        expected = Image.open(baseline)
        ratio, diff = diff_ratio(expected, actual)
        if ratio > DIFF_RATIO_LIMIT:
            (DIFFS / name.replace(".png", ".actual.png")).write_bytes(actual_bytes)
            diff.save(DIFFS / name.replace(".png", ".diff.png"))
            expected.save(DIFFS / name.replace(".png", ".expected.png"))
            results.append((name, "DRIFT", ratio))
        else:
            results.append((name, "ok", ratio))

    return results


async def main():
    all_failures = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        for vname, w, h in VIEWPORTS:
            ctx = await browser.new_context(
                viewport={"width": w, "height": h},
                device_scale_factor=1,
                reduced_motion="reduce",
            )
            page = await ctx.new_page()
            await restore_session(ctx, page)
            for route, selector, id_strategy in ROUTES:
                try:
                    results = await audit_route(page, vname, route, selector, id_strategy)
                except Exception as e:
                    all_failures.append(f"[{vname} {route}] raised: {e}")
                    continue
                for name, status, ratio in results:
                    tag = f"{status} ({ratio*100:.3f}%)" if status != "wrote-baseline" else status
                    print(f"[{vname} {route}] {name}: {tag}")
                    if status == "DRIFT":
                        all_failures.append(
                            f"[{vname} {route}] {name}: {ratio*100:.3f}% pixels drifted "
                            f"(limit {DIFF_RATIO_LIMIT*100:.3f}%). See {DIFFS / name.replace('.png', '.diff.png')}"
                        )
            await ctx.close()
        await browser.close()

    if all_failures:
        print("\nFAILURES:")
        for f in all_failures:
            print(" -", f)
        print("\nIf the change is intentional, refresh baselines:")
        print("  UPDATE_BASELINES=1 python tests/e2e/admin_tilethumb_pixel_diff.py")
        sys.exit(1)
    print(f"\nAll banner snapshots match baselines (tolerance {DIFF_RATIO_LIMIT*100:.2f}%).")


if __name__ == "__main__":
    asyncio.run(main())
