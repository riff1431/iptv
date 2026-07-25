"""E2E regression: sign in, soft-navigate to /arena, hard-reload, and
verify the signed-in header renders without any signed-out CTA flash or
root ErrorComponent takeover.

Guards against:
  (a) UserNav rendering the "Log In / Create Account" CTAs while
      `useAuth()` is still resolving `getUser()` on a fresh hard reload,
  (b) realtime channel-name collisions on /arena (e.g. `arena-matches-0`)
      throwing "cannot add postgres_changes callbacks after subscribe()"
      and tripping the root ErrorComponent.
"""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

SHOTS = Path("/tmp/browser/arena-hard-reload/shots")
SHOTS.mkdir(parents=True, exist_ok=True)

EMAIL = "user@demo.lovable.app"
PASSWORD = "TestPass!2026"

ERROR_TAKEOVER_MARKERS = [
    "something went wrong",
    "unexpected error",
    "an error occurred",
    "try again",
    "reload the page",
]

FATAL_CONSOLE_PATTERNS = [
    "cannot add `postgres_changes` callbacks",
    "cannot add `postgres_changes` callbacks after `subscribe()`",
    "error in route match",
]


async def count_signed_out_ctas(page) -> int:
    n = await page.get_by_role("button", name="Log In", exact=True).count()
    n += await page.get_by_role("button", name="Create Account", exact=True).count()
    return n


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()

        console_errors: list[str] = []
        fatal_errors: list[str] = []

        def on_console(msg):
            if msg.type != "error":
                return
            text = msg.text
            console_errors.append(text)
            low = text.lower()
            if any(p in low for p in FATAL_CONSOLE_PATTERNS):
                fatal_errors.append(text)

        page.on("console", on_console)

        # 1. Sign in.
        await page.goto("http://localhost:8080/auth", wait_until="domcontentloaded")
        await page.locator("#signin-email").fill(EMAIL)
        await page.locator('input[type="password"]').first.fill(PASSWORD)
        await page.get_by_role("button", name="Sign In", exact=True).click()
        await page.wait_for_url(lambda u: "/auth" not in u, timeout=15000)
        await page.wait_for_load_state("networkidle")
        await page.screenshot(path=str(SHOTS / "0_signed_in.png"))
        assert await count_signed_out_ctas(page) == 0, "signed-out CTAs after sign-in"

        # 2. Soft-navigate to /arena.
        await page.goto("http://localhost:8080/arena", wait_until="domcontentloaded")
        await page.wait_for_load_state("networkidle")
        await page.screenshot(path=str(SHOTS / "1_arena_soft.png"))
        assert await count_signed_out_ctas(page) == 0, "signed-out CTAs on arena soft-nav"

        # 3. Hard reload (F5 equivalent). This forces a fresh SSR document
        #    and re-runs `useAuth()` from scratch — the flash regression
        #    window.
        await page.reload(wait_until="domcontentloaded")

        # 4. Poll aggressively for a signed-out CTA appearing at any point
        #    during hydration + auth resolution.
        flash_detected = False
        for i in range(40):  # ~2s at 50ms cadence
            if await count_signed_out_ctas(page) > 0:
                flash_detected = True
                await page.screenshot(path=str(SHOTS / f"2_flash_{i}.png"))
                break
            await page.wait_for_timeout(50)
        assert not flash_detected, (
            "Signed-out CTA flashed on /arena after hard reload — UserNav is "
            "rendering the logged-out shell while auth is still loading."
        )

        await page.wait_for_load_state("networkidle")
        await page.screenshot(path=str(SHOTS / "3_arena_settled.png"))

        # 5. Root ErrorComponent must not have taken over.
        body_text = (await page.locator("body").inner_text()).lower()
        for marker in ERROR_TAKEOVER_MARKERS:
            assert marker not in body_text, (
                f"root ErrorComponent took over /arena after reload — marker: {marker!r}"
            )

        # 6. URL must still be /arena (no bounce to /auth).
        assert "/arena" in page.url and "/auth" not in page.url, (
            f"unexpected post-reload URL: {page.url}"
        )

        # 7. Signed-in header affordance must be present.
        signed_in_locator = page.locator(
            'button[aria-label^="Notifications"],'
            'button[aria-label*="Account menu"],'
            '[aria-label*="avatar" i]'
        )
        try:
            await signed_in_locator.first.wait_for(state="attached", timeout=8000)
        except Exception:
            await page.screenshot(path=str(SHOTS / "3b_no_signed_in_marker.png"))
            raise AssertionError("no signed-in header affordance on /arena after reload")

        # 8. Final CTA sweep post-settle.
        assert await count_signed_out_ctas(page) == 0, (
            "signed-out CTAs present after /arena settle"
        )

        # 9. No fatal console errors (channel reuse, route-match error).
        assert not fatal_errors, f"fatal console errors during reload: {fatal_errors}"

        print("\nPASS")
        print(f"non-fatal console errors: {len(console_errors)}")
        await browser.close()


asyncio.run(main())
