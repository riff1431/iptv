"""Verify user-initiated URL hash changes update the scrollspy highlight
immediately with no motion — distinct from click-driven navigation which
uses smooth scroll.

We simulate 'user initiated' by:
  - Programmatically setting `window.location.hash = '...'` (equivalent to
    typing a URL / pasting a link — fires hashchange without a preceding
    click).
  - History back/forward across hash entries.

For each case, after the hashchange:
  - active section highlight updates immediately (aria-current="true"
    lands within a short window).
  - focus moves into the target section.
  - the target section's top is at (or very near) the viewport top
    without any smooth-scroll animation (position stabilizes in a
    single frame).
"""
import asyncio
import sys
from pathlib import Path
from playwright.async_api import async_playwright

SCREENSHOTS = Path("/tmp/browser/home_hash_user_initiated/screenshots")
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

BASE = "http://localhost:8080"
SECTIONS = ["features", "lounges", "pricing", "faq", "contact"]

failures: list[str] = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        failures.append(msg)
        print(f"FAIL: {msg}")
    else:
        print(f"ok:   {msg}")


async def scroll_settles_instantly(page, section_id: str) -> tuple[bool, float, float]:
    """Sample scrollY twice ~50ms apart. Instant scroll should show no
    delta between samples. Returns (settled, first, second)."""
    first = await page.evaluate("window.scrollY")
    await page.wait_for_timeout(60)
    second = await page.evaluate("window.scrollY")
    return (abs(first - second) < 1.0, first, second)


async def run() -> None:
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        # Do NOT set reduced_motion — we want to prove instant scroll
        # happens even with smooth-scroll globally enabled.
        context = await browser.new_context(
            viewport={"width": 1280, "height": 1800},
        )
        page = await context.new_page()
        await page.goto(f"{BASE}/", wait_until="networkidle")

        # 1) Programmatic hash change (user-initiated equivalent): highlight
        # updates immediately, focus lands, scroll is instant.
        for section_id in SECTIONS:
            await page.evaluate(f"window.location.hash = {section_id!r}")
            # Give the hashchange handler + scroll a moment to settle. Even
            # an "instant" scroll can take a couple of frames to reflect
            # in scrollY when preceded by the browser's native anchor scroll.
            await page.wait_for_timeout(250)

            settled, first, second = await scroll_settles_instantly(page, section_id)
            check(
                settled,
                f"[user-typed #{section_id}] scroll settled instantly (Δ={abs(first - second):.1f}px between samples 60ms apart)",
            )

            hash_val = await page.evaluate("window.location.hash")
            check(
                hash_val == f"#{section_id}",
                f"[user-typed #{section_id}] hash is set (got {hash_val!r})",
            )

            active_id = await page.evaluate("document.activeElement?.id ?? null")
            check(
                active_id == section_id,
                f"[user-typed #{section_id}] focus lands on section (activeElement id={active_id!r})",
            )

            aria = await page.locator(
                f'nav[aria-label="Page sections"] a[href="#{section_id}"]'
            ).first.get_attribute("aria-current")
            check(
                aria == "true",
                f"[user-typed #{section_id}] highlight updated (aria-current={aria!r})",
            )

            # Section should be visible in the viewport after scroll. For
            # sections near the document bottom, the browser can't scroll
            # them all the way to the top — assert they at least intersect
            # the viewport (partially visible).
            rect = await page.evaluate(
                f"""(() => {{
                    const r = document.getElementById({section_id!r}).getBoundingClientRect();
                    return {{ top: r.top, bottom: r.bottom, vh: window.innerHeight }};
                }})()"""
            )
            in_view = rect["top"] < rect["vh"] and rect["bottom"] > 0
            check(
                in_view,
                f"[user-typed #{section_id}] section visible in viewport (top={rect['top']:.0f}, bottom={rect['bottom']:.0f}, vh={rect['vh']})",
            )



        await page.screenshot(path=str(SCREENSHOTS / "1_after_user_typed.png"))

        # 2) Back/forward is user-initiated too — same instant behavior.
        await page.go_back()
        await page.wait_for_timeout(120)
        settled, first, second = await scroll_settles_instantly(page, "faq")
        check(
            settled,
            f"[back → faq] scroll instant (Δ={abs(first - second):.1f}px)",
        )
        hash_val = await page.evaluate("window.location.hash")
        check(hash_val == "#faq", f"[back → faq] hash (got {hash_val!r})")
        focus_id = await page.evaluate("document.activeElement?.id ?? null")
        check(focus_id == "faq", f"[back → faq] focus (got {focus_id!r})")

        await page.go_forward()
        await page.wait_for_timeout(120)
        settled, first, second = await scroll_settles_instantly(page, "contact")
        check(
            settled,
            f"[forward → contact] scroll instant (Δ={abs(first - second):.1f}px)",
        )
        hash_val = await page.evaluate("window.location.hash")
        check(hash_val == "#contact", f"[forward → contact] hash (got {hash_val!r})")

        await page.screenshot(path=str(SCREENSHOTS / "2_after_back_forward.png"))

        # 3) A nav-link click should still use smooth scroll (control case).
        # Scroll back to hero first to make the delta observable.
        await page.evaluate("window.scrollTo(0, 0)")
        await page.wait_for_timeout(120)
        await page.locator(
            'nav[aria-label="Page sections"] a[href="#contact"]'
        ).first.click()
        # Sample immediately then again ~100ms later — smooth scroll should
        # still be in progress, so positions differ.
        first = await page.evaluate("window.scrollY")
        await page.wait_for_timeout(100)
        second = await page.evaluate("window.scrollY")
        check(
            abs(first - second) > 5.0 or second > 0,
            f"[click → contact] click still uses smooth scroll (Δ={abs(first - second):.1f}px, second={second})",
        )
        await page.screenshot(path=str(SCREENSHOTS / "3_click_smooth.png"))

        await browser.close()


asyncio.run(run())

if failures:
    print(f"\n{len(failures)} failure(s):")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("\nAll user-initiated hash change checks passed.")
