"""E2E accessibility regression: verify homepage scrollspy focus management
and reduced-motion behavior remain intact.

Checks performed against http://localhost:8080/:

1. Global CSS honors `prefers-reduced-motion: reduce`: computed
   `scroll-behavior` on <html> is `auto` when the media feature is set.
2. Clicking a scrollspy nav link:
   - Updates `window.location.hash` to the target section id.
   - Moves keyboard focus into the target section (document.activeElement
     is the section element, matching what screen readers announce).
   - Advances `active` state (aria-current="true" moves to the clicked link).
3. Invalid hash (`/#does-not-exist`) gracefully clears the hash and focuses
   the hero section instead of leaving the user stranded.
4. The /dev/motion-test view exposes a single <main>, a live-region status
   pill reflecting reduced-motion, and each demo section is programmatically
   focusable (tabindex="-1") with a visible heading.

Exits non-zero on any failure with a screenshot under
/tmp/browser/home_a11y_focus_reduced_motion/screenshots/.
"""
import asyncio
import sys
from pathlib import Path
from playwright.async_api import async_playwright

SCREENSHOTS = Path("/tmp/browser/home_a11y_focus_reduced_motion/screenshots")
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

BASE = "http://localhost:8080"
SECTIONS = ["hero", "features", "lounges", "pricing", "faq", "contact"]

failures: list[str] = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        failures.append(msg)
        print(f"FAIL: {msg}")
    else:
        print(f"ok:   {msg}")


async def run() -> None:
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 1800},
            reduced_motion="reduce",
        )
        page = await context.new_page()

        # 1) Reduced-motion CSS kill-switch is active.
        await page.goto(f"{BASE}/", wait_until="domcontentloaded")
        await page.wait_for_load_state("networkidle")
        scroll_behavior = await page.evaluate(
            "getComputedStyle(document.documentElement).scrollBehavior"
        )
        check(
            scroll_behavior == "auto",
            f"html scroll-behavior is 'auto' under reduced-motion (got {scroll_behavior!r})",
        )
        await page.screenshot(path=str(SCREENSHOTS / "1_home_reduced_motion.png"))

        # 2) Each scrollspy link updates hash, focuses target section, sets aria-current.
        for section_id in SECTIONS[1:]:  # skip hero (already at top)
            link = page.locator(
                f'nav[aria-label="Page sections"] a[href="#{section_id}"]'
            )
            await link.first.click()
            await page.wait_for_timeout(150)

            hash_val = await page.evaluate("window.location.hash")
            check(
                hash_val == f"#{section_id}",
                f"clicking '{section_id}' sets location.hash (got {hash_val!r})",
            )

            active_id = await page.evaluate("document.activeElement?.id ?? null")
            check(
                active_id == section_id,
                f"clicking '{section_id}' focuses section (activeElement id={active_id!r})",
            )

            aria_current = await link.first.get_attribute("aria-current")
            check(
                aria_current == "true",
                f"clicked link '{section_id}' has aria-current=true (got {aria_current!r})",
            )

        await page.screenshot(path=str(SCREENSHOTS / "2_scrollspy_focus.png"))

        # 3) Invalid hash gracefully recovers: hash is replaced with a valid
        # section (or cleared) and focus lands on the hero section.
        await page.goto(f"{BASE}/#does-not-exist", wait_until="domcontentloaded")
        await page.wait_for_load_state("networkidle")
        await page.wait_for_timeout(500)
        hash_val = await page.evaluate("window.location.hash")
        check(
            hash_val in ("", "#hero"),
            f"invalid hash gracefully recovered (got {hash_val!r}, expected '' or '#hero')",
        )
        active_id = await page.evaluate("document.activeElement?.id ?? null")
        check(
            active_id == "hero",
            f"invalid hash focuses hero (activeElement id={active_id!r})",
        )
        await page.screenshot(path=str(SCREENSHOTS / "3_invalid_hash_recovery.png"))


        # 4) /dev/motion-test structural + a11y checks.
        await page.goto(f"{BASE}/dev/motion-test", wait_until="domcontentloaded")
        await page.wait_for_load_state("networkidle")

        main_count = await page.locator("main").count()
        check(main_count == 1, f"/dev/motion-test has exactly one <main> (got {main_count})")

        status = page.locator('[role="status"][aria-live="polite"]')
        check(
            await status.count() == 1,
            "reduced-motion status pill present with aria-live=polite",
        )
        status_text = (await status.first.inner_text()).lower()
        check(
            "reduce" in status_text,
            f"status pill reports reduced-motion active (text={status_text!r})",
        )

        for demo_id in ["fade", "scale", "slide", "hover", "story", "pulse"]:
            sec = page.locator(f"section#{demo_id}")
            check(
                await sec.count() == 1,
                f"/dev/motion-test section#{demo_id} exists",
            )
            tabindex = await sec.first.get_attribute("tabindex")
            check(
                tabindex == "-1",
                f"section#{demo_id} is programmatically focusable (tabindex={tabindex!r})",
            )
            heading = sec.first.locator("h2")
            check(
                await heading.count() == 1
                and bool((await heading.first.inner_text()).strip()),
                f"section#{demo_id} has a non-empty <h2>",
            )

        # Reduced-motion should collapse animation-duration on animated demos.
        for demo_id, animated_class in [
            ("fade", "animate-fade-in"),
            ("scale", "animate-scale-in"),
            ("slide", "animate-slide-in-right"),
        ]:
            duration_ms = await page.evaluate(
                """(cls) => {
                    const el = document.querySelector('.' + cls);
                    if (!el) return null;
                    const d = getComputedStyle(el).animationDuration;
                    return parseFloat(d) * (d.endsWith('ms') ? 1 : 1000);
                }""",
                animated_class,
            )
            check(
                duration_ms is not None and duration_ms < 10,
                f"{animated_class} animation-duration collapses under reduced-motion (got {duration_ms}ms)",
            )

        await page.screenshot(path=str(SCREENSHOTS / "4_motion_test_view.png"))

        await browser.close()


asyncio.run(run())

if failures:
    print(f"\n{len(failures)} failure(s):")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("\nAll accessibility checks passed.")
