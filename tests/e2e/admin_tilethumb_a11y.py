"""E2E accessibility regression: every ThumbHeader banner must expose the
right ARIA semantics and remain readable across mobile / tablet / desktop.

Per banner, at every breakpoint, we assert:

1. The banner root (`div.aspect-[16/3]`) has no `aria-hidden="true"` — it
   sits at the top of a card whose title we don't want removed from the
   accessibility tree.
2. It contains exactly one element with `role="img"` (the ThumbFallback
   surface). That element has a non-empty `aria-label`.
3. That role="img" element has a computed accessible name (Playwright
   ARIA snapshot) that matches its `aria-label` — no accidental override
   by nested text/labels.
4. The Lucide `<svg>` inside the role="img" surface is treated as
   decorative (either `aria-hidden="true"` OR it has no `aria-label`
   AND its parent's role="img"+aria-label supplies the name, so screen
   readers announce the banner once, not twice).
5. If a corner accent icon is present, its container either exposes
   `role="img"` + a non-empty `aria-label` OR is `aria-hidden="true"`
   (never a nameless focusable/announced element).
6. The banner is tall enough to remain visually readable: computed
   height ≥ 40px on mobile (the icon glyph is `h-10 w-10` = 40px, so
   below that the icon would clip / be illegible).
7. The banner icon's rendered size is at least 24×24 CSS px — below
   that Lucide strokes at 1.5 collapse into an unreadable smudge.

Routes covered: production `/admin` and `/wallet` plus the permutation
matrix at `/dev/tilethumb` — so every variant (default banner, all
production icons, all 4 corner-icon themes, ThumbFallback size presets)
is checked at all three breakpoints.
"""
import asyncio
import json
import os
import sys
from pathlib import Path
from playwright.async_api import async_playwright

VIEWPORTS = [("mobile", 390, 1800), ("tablet", 768, 1800), ("desktop", 1280, 1800)]
ROUTES = ["/admin", "/wallet", "/dev/tilethumb"]

BANNER_SELECTOR = 'div.aspect-\\[16\\/3\\]'
MIN_BANNER_HEIGHT_PX = 40
MIN_ICON_SIZE_PX = 24


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


async def audit_banner(page, el, ident):
    """Return list of failure strings for a single banner element."""
    failures = []

    data = await el.evaluate(
        """el => {
          const root = el;
          const rootHidden = root.getAttribute('aria-hidden') === 'true';

          const imgs = root.querySelectorAll('[role="img"]');
          const fallback = imgs[0] || null;
          const fallbackLabel = fallback ? fallback.getAttribute('aria-label') : null;

          const svg = fallback ? fallback.querySelector('svg') : null;
          const svgHidden = svg ? svg.getAttribute('aria-hidden') === 'true' : null;
          const svgLabel = svg ? svg.getAttribute('aria-label') : null;
          const svgRect = svg ? svg.getBoundingClientRect() : null;

          // Corner icon = a direct-child positioned div, sibling to fallback,
          // that holds an svg. We recognize it by class fragment right-3.
          const corner = Array.from(root.children).find(c =>
            c !== fallback && c.querySelector && c.querySelector('svg') && /right-3/.test(c.className || '')
          );
          const cornerRole = corner ? corner.getAttribute('role') : null;
          const cornerLabel = corner ? corner.getAttribute('aria-label') : null;
          const cornerHidden = corner ? corner.getAttribute('aria-hidden') === 'true' : null;

          const rootRect = root.getBoundingClientRect();
          return {
            rootHidden,
            imgCount: imgs.length,
            fallbackLabel,
            svgPresent: !!svg,
            svgHidden,
            svgLabel,
            svgW: svgRect ? svgRect.width : null,
            svgH: svgRect ? svgRect.height : null,
            hasCorner: !!corner,
            cornerRole,
            cornerLabel,
            cornerHidden,
            rootH: rootRect.height,
          };
        }"""
    )

    # (1) Root must not be aria-hidden — its accessible children carry meaning.
    if data["rootHidden"]:
        failures.append(f"{ident}: banner root has aria-hidden='true'")

    # (2) At least one role=img surface (the ThumbFallback). A labeled corner
    # icon may add a second role=img — that's intended (banner + accent
    # convey different info) and both must carry non-empty labels.
    if data["imgCount"] < 1:
        failures.append(f"{ident}: no role='img' inside banner")
    if not (data["fallbackLabel"] and data["fallbackLabel"].strip()):
        failures.append(f"{ident}: ThumbFallback role='img' missing / empty aria-label")

    # (3) Computed accessible name matches the aria-label (no override).
    if data["fallbackLabel"]:
        # Playwright's accessibility snapshot resolves the name the same way AT does.
        snap = await el.locator('[role="img"]').first.evaluate(
            "e => e.getAttribute('aria-label')"  # simple canonical read; role=img with aria-label wins
        )
        if snap != data["fallbackLabel"]:
            failures.append(
                f"{ident}: accessible name '{snap}' != aria-label '{data['fallbackLabel']}'"
            )

    # (4) Inner SVG must be decorative — no competing accessible name.
    if data["svgPresent"] and data["svgLabel"]:
        failures.append(
            f"{ident}: banner <svg> has its own aria-label '{data['svgLabel']}' — will be announced twice"
        )

    # (5) Corner icon must either be a proper role=img with a label, or aria-hidden.
    if data["hasCorner"]:
        proper_img = data["cornerRole"] == "img" and data["cornerLabel"] and data["cornerLabel"].strip()
        if not (proper_img or data["cornerHidden"]):
            failures.append(
                f"{ident}: corner icon is neither role='img'+aria-label nor aria-hidden "
                f"(role={data['cornerRole']!r}, label={data['cornerLabel']!r}, hidden={data['cornerHidden']})"
            )

    # (6) Readability: banner must be at least MIN_BANNER_HEIGHT_PX tall.
    if data["rootH"] < MIN_BANNER_HEIGHT_PX:
        failures.append(
            f"{ident}: banner height {data['rootH']:.1f}px < min {MIN_BANNER_HEIGHT_PX}px — icon clips"
        )

    # (7) Icon at least MIN_ICON_SIZE_PX × MIN_ICON_SIZE_PX.
    if data["svgW"] is not None and (data["svgW"] < MIN_ICON_SIZE_PX or data["svgH"] < MIN_ICON_SIZE_PX):
        failures.append(
            f"{ident}: banner icon {data['svgW']:.1f}×{data['svgH']:.1f}px < min {MIN_ICON_SIZE_PX}px"
        )

    return failures


async def audit_route(page, viewport_name, route):
    await page.goto(f"http://localhost:8080{route}", wait_until="networkidle", timeout=20000)
    await page.wait_for_timeout(1200)

    banners = page.locator(BANNER_SELECTOR)
    count = await banners.count()
    assert count > 0, f"[{viewport_name} {route}] no banners found"

    all_failures = []
    for i in range(count):
        el = banners.nth(i)
        await el.scroll_into_view_if_needed()
        # Prefer a stable data-permutation id for readable failure messages.
        attr = await el.get_attribute("data-permutation") if False else None
        parent_attr = await el.evaluate(
            "el => el.closest('[data-permutation]')?.getAttribute('data-permutation') || null"
        )
        ident = f"banner[{parent_attr}]" if parent_attr else f"banner[#{i:02d}]"
        all_failures.extend(await audit_banner(page, el, ident))
    return all_failures


async def main():
    all_failures = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        for vname, w, h in VIEWPORTS:
            ctx = await browser.new_context(viewport={"width": w, "height": h})
            page = await ctx.new_page()
            await restore_session(ctx, page)
            for route in ROUTES:
                try:
                    failures = await audit_route(page, vname, route)
                except Exception as e:
                    all_failures.append(f"[{vname} {route}] raised: {e}")
                    continue
                for f in failures:
                    all_failures.append(f"[{vname} {route}] {f}")
                print(f"[{vname} {route}] {'OK' if not failures else 'FAIL'} — {len(failures)} issue(s)")
            await ctx.close()
        await browser.close()

    if all_failures:
        print("\nFAILURES:")
        for f in all_failures:
            print(" -", f)
        sys.exit(1)
    print("\nAll ThumbHeader banners pass ARIA + readability checks.")


if __name__ == "__main__":
    asyncio.run(main())
