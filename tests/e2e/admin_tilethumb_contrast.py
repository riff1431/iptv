"""E2E WCAG non-text contrast regression for ThumbHeader banners.

The banner label is exposed via `aria-label` only (not visible text), so
WCAG 1.4.3 (text contrast) does not apply. What DOES apply is WCAG 2.1
Success Criterion 1.4.11 "Non-text Contrast" — the icon glyph is a
graphical object conveying information, and must reach a **3.0:1**
contrast ratio against the adjacent background at every breakpoint.

Per banner, at mobile / tablet / desktop, we:
  1. Element-screenshot the banner (contains the gradient bg + icon).
  2. Read the icon <svg>'s bounding box relative to the banner.
  3. Sample the icon foreground color (median of the darkest 25% of
     pixels inside the icon bbox — the Lucide strokes are the low-luma
     pixels; the icon is rendered with 55% drop-shadow glow so pure
     max-luma sampling would grab the glow, not the stroke).
     Actually, arena-violet is a mid-tone drawn on a dark violet
     gradient, so we take the **most-saturated** pixels — the strokes
     — regardless of luma polarity.
  4. Sample the background color (median of pixels along the banner's
     four edges, well outside the icon bbox).
  5. Compute the WCAG relative-luminance contrast ratio and assert
     it is ≥ 3.0:1. Also compute the corner accent icon's contrast
     against its own container when one is present.

Themes: the app currently ships one dark theme (`arena-*` tokens in
`src/styles.css`). Should a light theme be added, extend `THEMES` below;
the sampling logic is theme-agnostic.
"""
import asyncio
import io
import json
import os
import sys
from pathlib import Path
from PIL import Image
from playwright.async_api import async_playwright

VIEWPORTS = [("mobile", 390, 1800), ("tablet", 768, 1800), ("desktop", 1280, 1800)]
ROUTES = ["/admin", "/wallet", "/dev/tilethumb"]
THEMES = [("dark", None)]  # (name, html-attr-to-set); None = leave as-is

MIN_CONTRAST_NON_TEXT = 3.0  # WCAG 2.1 SC 1.4.11
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


# ---------- WCAG contrast math ----------

def _srgb_to_linear(c: float) -> float:
    c /= 255.0
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def relative_luminance(rgb):
    r, g, b = rgb
    return (
        0.2126 * _srgb_to_linear(r)
        + 0.7152 * _srgb_to_linear(g)
        + 0.0722 * _srgb_to_linear(b)
    )


def contrast_ratio(rgb_a, rgb_b):
    l1 = relative_luminance(rgb_a)
    l2 = relative_luminance(rgb_b)
    lighter, darker = max(l1, l2), min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


# ---------- pixel sampling ----------

def _saturation(px):
    r, g, b = px
    mx, mn = max(px), min(px)
    return (mx - mn) if mx > 0 else 0


def sample_icon_and_bg(img: Image.Image, icon_box):
    """Return (icon_rgb, bg_rgb). icon_box is (x, y, w, h) inside img."""
    img = img.convert("RGB")
    W, H = img.size
    ix, iy, iw, ih = icon_box
    # Clamp to image bounds.
    ix, iy = max(0, int(ix)), max(0, int(iy))
    iw, ih = int(min(iw, W - ix)), int(min(ih, H - iy))
    if iw < 4 or ih < 4:
        raise ValueError(f"icon bbox too small: {icon_box}")

    # --- foreground: most-saturated pixels inside icon bbox ---
    icon_pixels = list(img.crop((ix, iy, ix + iw, iy + ih)).getdata())
    icon_pixels.sort(key=_saturation, reverse=True)
    fg_sample = icon_pixels[: max(1, len(icon_pixels) // 20)]  # top 5% most saturated
    fg = tuple(round(sum(c) / len(fg_sample)) for c in zip(*fg_sample))

    # --- background: pixels along the banner edges, well outside icon bbox ---
    bg_pixels = []
    margin = 2
    # top and bottom strips
    for y in list(range(0, min(margin + 4, iy))) + list(range(min(iy + ih + margin, H), H)):
        for x in range(0, W, max(1, W // 40)):
            bg_pixels.append(img.getpixel((x, y)))
    # left and right strips
    for x in list(range(0, min(margin + 4, ix))) + list(range(min(ix + iw + margin, W), W)):
        for y in range(0, H, max(1, H // 20)):
            bg_pixels.append(img.getpixel((x, y)))
    if not bg_pixels:
        raise ValueError("no background pixels sampled")
    bg = tuple(round(sum(c) / len(bg_pixels)) for c in zip(*bg_pixels))
    return fg, bg


# ---------- audit ----------

async def audit_banner(page, el, ident):
    failures = []

    geom = await el.evaluate(
        """el => {
          const root = el;
          const rootRect = root.getBoundingClientRect();

          // Primary icon: first svg inside the role='img' fallback.
          const fallback = root.querySelector('[role="img"]');
          const svg = fallback ? fallback.querySelector('svg') : null;
          const svgRect = svg ? svg.getBoundingClientRect() : null;

          // Corner icon: positioned pill with class right-3.
          const corner = Array.from(root.children).find(c =>
            c !== fallback && c.querySelector && c.querySelector('svg') && /right-3/.test(c.className || '')
          );
          const cornerRect = corner ? corner.getBoundingClientRect() : null;
          const cornerSvg = corner ? corner.querySelector('svg') : null;
          const cornerSvgRect = cornerSvg ? cornerSvg.getBoundingClientRect() : null;

          return {
            root: [rootRect.x, rootRect.y, rootRect.width, rootRect.height],
            svg: svgRect && [svgRect.x, svgRect.y, svgRect.width, svgRect.height],
            corner: cornerRect && [cornerRect.x, cornerRect.y, cornerRect.width, cornerRect.height],
            cornerSvg: cornerSvgRect && [cornerSvgRect.x, cornerSvgRect.y, cornerSvgRect.width, cornerSvgRect.height],
          };
        }"""
    )

    if not geom["svg"]:
        failures.append(f"{ident}: banner svg not found — skipping contrast check")
        return failures

    # --- banner icon vs banner background ---
    shot = await el.screenshot()
    img = Image.open(io.BytesIO(shot))
    rx, ry, _, _ = geom["root"]
    sx, sy, sw, sh = geom["svg"]
    icon_box_local = (sx - rx, sy - ry, sw, sh)
    try:
        fg, bg = sample_icon_and_bg(img, icon_box_local)
        ratio = contrast_ratio(fg, bg)
        if ratio < MIN_CONTRAST_NON_TEXT:
            failures.append(
                f"{ident}: banner icon contrast {ratio:.2f}:1 < {MIN_CONTRAST_NON_TEXT}:1 "
                f"(icon={fg}, bg={bg})"
            )
    except ValueError as e:
        failures.append(f"{ident}: banner sampling failed — {e}")

    # --- corner icon vs its container background ---
    if geom["corner"] and geom["cornerSvg"]:
        cx, cy, cw, ch = geom["corner"]
        csx, csy, csw, csh = geom["cornerSvg"]
        # Screenshot the whole banner already; convert corner rect to local coords.
        corner_local = (cx - rx, cy - ry, cw, ch)
        # Crop corner region.
        cxl, cyl, cwl, chl = corner_local
        cxl, cyl = max(0, int(cxl)), max(0, int(cyl))
        cwl, chl = int(cwl), int(chl)
        corner_img = img.crop((cxl, cyl, cxl + cwl, cyl + chl))
        # Corner-svg bbox relative to corner container.
        icon_box_in_corner = (csx - cx, csy - cy, csw, csh)
        try:
            cfg, cbg = sample_icon_and_bg(corner_img, icon_box_in_corner)
            cratio = contrast_ratio(cfg, cbg)
            if cratio < MIN_CONTRAST_NON_TEXT:
                failures.append(
                    f"{ident}: corner icon contrast {cratio:.2f}:1 < {MIN_CONTRAST_NON_TEXT}:1 "
                    f"(icon={cfg}, bg={cbg})"
                )
        except ValueError as e:
            failures.append(f"{ident}: corner sampling failed — {e}")

    return failures


async def audit_route(page, viewport_name, route):
    await page.goto(f"http://localhost:8080{route}", wait_until="networkidle", timeout=20000)
    await page.wait_for_timeout(1200)

    banners = page.locator(BANNER_SELECTOR)
    count = await banners.count()
    assert count > 0, f"[{viewport_name} {route}] no banners found"

    results = []
    for i in range(count):
        el = banners.nth(i)
        await el.scroll_into_view_if_needed()
        await page.wait_for_timeout(60)
        parent_attr = await el.evaluate(
            "el => el.closest('[data-permutation]')?.getAttribute('data-permutation') || null"
        )
        ident = f"banner[{parent_attr}]" if parent_attr else f"banner[#{i:02d}]"
        results.extend(await audit_banner(page, el, ident))
    return results


async def main():
    all_failures = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        for theme_name, _theme_attr in THEMES:
            for vname, w, h in VIEWPORTS:
                ctx = await browser.new_context(viewport={"width": w, "height": h})
                page = await ctx.new_page()
                await restore_session(ctx, page)
                for route in ROUTES:
                    try:
                        failures = await audit_route(page, vname, route)
                    except Exception as e:
                        all_failures.append(f"[{theme_name} {vname} {route}] raised: {e}")
                        continue
                    tag = "OK" if not failures else "FAIL"
                    print(f"[{theme_name} {vname} {route}] {tag} — {len(failures)} issue(s)")
                    for f in failures:
                        all_failures.append(f"[{theme_name} {vname} {route}] {f}")
                await ctx.close()
        await browser.close()

    if all_failures:
        print("\nFAILURES (WCAG 2.1 SC 1.4.11 — non-text contrast ≥ 3.0:1):")
        for f in all_failures:
            print(" -", f)
        sys.exit(1)
    print(f"\nAll ThumbHeader icons meet WCAG non-text contrast (≥ {MIN_CONTRAST_NON_TEXT}:1).")


if __name__ == "__main__":
    asyncio.run(main())
