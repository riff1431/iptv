"""E2E regression: ThumbHeader banners on the admin dashboard and wallet page
never clip, shift, or overflow across mobile / tablet / desktop.

For every viewport, for every ThumbHeader banner on /admin and /wallet:
- the banner element is fully within the horizontal viewport (no clipping /
  overflow past the right edge — accounts for the intentional negative-margin
  bleed to the card border);
- the banner height matches the intended ~16:3 aspect ratio (within 2px);
- the sibling content below the banner is visible (no shift covering text).
"""
import asyncio
import json
import os
import sys
from pathlib import Path
from playwright.async_api import async_playwright

SHOTS = Path("/tmp/browser/tilethumb-responsive/shots")
SHOTS.mkdir(parents=True, exist_ok=True)

VIEWPORTS = [("mobile", 390, 1800), ("tablet", 768, 1800), ("desktop", 1280, 1800)]
ROUTES = ["/admin", "/wallet"]

# ThumbHeader roots share this exact class fragment (see src/components/ThumbFallback.tsx)
BANNER_SELECTOR = 'div.aspect-\\[16\\/3\\]'


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


async def audit_route(page, viewport_name, viewport_w, route):
    await page.goto(f"http://localhost:8080{route}", wait_until="networkidle", timeout=20000)
    await page.wait_for_timeout(1200)
    await page.screenshot(path=str(SHOTS / f"{viewport_name}_{route.strip('/')}.png"))

    banners = page.locator(BANNER_SELECTOR)
    count = await banners.count()
    assert count > 0, f"[{viewport_name} {route}] no ThumbHeader banners found"

    failures = []
    for i in range(count):
        el = banners.nth(i)
        box = await el.bounding_box()
        if not box:
            failures.append(f"banner #{i}: not laid out (no bounding box)")
            continue

        # Overflow check: banner must not extend past the viewport right edge.
        # The banner intentionally bleeds via negative margins to the card border
        # (arena-card has ~1px border), so we allow a 4px tolerance.
        right = box["x"] + box["width"]
        if right > viewport_w + 4:
            failures.append(
                f"banner #{i}: overflows viewport ({right:.1f}px > {viewport_w}px)"
            )
        if box["x"] < -4:
            failures.append(f"banner #{i}: left edge clipped (x={box['x']:.1f}px)")

        # Aspect-ratio check: aspect-[16/3] means height ≈ width * 3/16.
        expected_h = box["width"] * 3 / 16
        if abs(box["height"] - expected_h) > 2:
            failures.append(
                f"banner #{i}: aspect ratio off (w={box['width']:.1f} h={box['height']:.1f}, expected h≈{expected_h:.1f})"
            )

        # No-shift check: banner must render above whatever sibling comes next
        # in the same card — sibling top should be >= banner bottom.
        sibling_top = await el.evaluate(
            "el => { const s = el.nextElementSibling; return s ? s.getBoundingClientRect().top : null; }"
        )
        if sibling_top is not None and sibling_top + 1 < box["y"] + box["height"]:
            failures.append(
                f"banner #{i}: next sibling overlaps banner (sibling top {sibling_top:.1f} < banner bottom {box['y'] + box['height']:.1f})"
            )

        # Icon-alignment check: the banner's ThumbFallback icon should be
        # centered within the banner (±3px on both axes).
        icon_box = await el.evaluate(
            """el => {
              const svg = el.querySelector(':scope > div > svg');
              if (!svg) return null;
              const r = svg.getBoundingClientRect();
              return { x: r.x, y: r.y, w: r.width, h: r.height };
            }"""
        )
        if not icon_box:
            failures.append(f"banner #{i}: no ThumbFallback icon rendered")
        else:
            banner_cx = box["x"] + box["width"] / 2
            banner_cy = box["y"] + box["height"] / 2
            icon_cx = icon_box["x"] + icon_box["w"] / 2
            icon_cy = icon_box["y"] + icon_box["h"] / 2
            if abs(icon_cx - banner_cx) > 3 or abs(icon_cy - banner_cy) > 3:
                failures.append(
                    f"banner #{i}: icon off-center (icon @ {icon_cx:.1f},{icon_cy:.1f} vs banner @ {banner_cx:.1f},{banner_cy:.1f})"
                )

        # Duplicate-icon check (header-scoped): the tile's HEADER row — the
        # element immediately after the banner — must not repeat the banner's
        # lucide icon. Deeper body/CTA/list icons are ignored: activity rows,
        # form buttons, and stat tiles legitimately reuse glyphs. What we
        # guard against is a redundant accent-circle icon sitting next to
        # the tile title (the case the user asked us to dedupe).
        dup = await el.evaluate(
            """el => {
              const svg = el.querySelector(':scope > div > svg');
              if (!svg) return null;
              const cls = Array.from(svg.classList).find(c => c.startsWith('lucide-') && c !== 'lucide');
              if (!cls) return null;
              const header = el.nextElementSibling;
              if (!header) return null;
              const matches = header.querySelectorAll('svg.' + cls);
              return { icon: cls, dupCount: matches.length };
            }"""
        )
        if dup and dup["dupCount"] > 0:
            failures.append(
                f"banner #{i}: banner icon `{dup['icon']}` repeated {dup['dupCount']}× in the tile header row"
            )


    return failures



async def main():
    all_failures = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        for name, w, h in VIEWPORTS:
            ctx = await browser.new_context(viewport={"width": w, "height": h})
            page = await ctx.new_page()
            await restore_session(ctx, page)
            for route in ROUTES:
                try:
                    failures = await audit_route(page, name, w, route)
                except Exception as e:
                    all_failures.append(f"[{name} {route}] raised: {e}")
                    continue
                for f in failures:
                    all_failures.append(f"[{name} {route}] {f}")
                print(f"[{name} {route}] {'OK' if not failures else 'FAIL'} — {len(failures)} issue(s)")
            await ctx.close()
        await browser.close()

    if all_failures:
        print("\nFAILURES:")
        for f in all_failures:
            print(" -", f)
        sys.exit(1)
    print("\nAll ThumbHeader banners pass responsive checks.")


if __name__ == "__main__":
    asyncio.run(main())
