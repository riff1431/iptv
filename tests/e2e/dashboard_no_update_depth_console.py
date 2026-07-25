"""E2E: signed-in user on /dashboard sees no 'Maximum update depth exceeded' console errors while UI is visible."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

SHOTS = Path("/tmp/browser/dashboard-no-update-depth/shots")
SHOTS.mkdir(parents=True, exist_ok=True)

EMAIL = "user@demo.lovable.app"
PASSWORD = "TestPass!2026"
LOOP_MARKER = "Maximum update depth exceeded"


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()

        console_errors: list[str] = []
        page_errors: list[str] = []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)))

        # Sign in
        await page.goto("http://localhost:8080/auth", wait_until="domcontentloaded")
        await page.locator('#signin-email').fill(EMAIL)
        await page.locator('input[type="password"]').first.fill(PASSWORD)
        await page.get_by_role("button", name="Sign In", exact=True).click()
        await page.wait_for_url(lambda u: "/auth" not in u, timeout=15000)
        await page.wait_for_timeout(500)
        print("signed in ->", page.url)

        # Visit dashboard
        await page.goto("http://localhost:8080/dashboard", wait_until="domcontentloaded")
        await page.wait_for_timeout(3000)
        await page.screenshot(path=str(SHOTS / "1_dashboard.png"))

        assert "/dashboard" in page.url, f"redirected off dashboard: {page.url}"

        # Dashboard UI must be visible
        headings = await page.locator("h1, h2").count()
        assert headings > 0, "dashboard UI not visible (no headings)"

        # Interact a bit to provoke ref/state churn, then poll again
        try:
            await page.mouse.wheel(0, 800)
        except Exception:
            pass
        await page.wait_for_timeout(2500)
        await page.screenshot(path=str(SHOTS / "2_after_scroll.png"))

        loop_console = [e for e in console_errors if LOOP_MARKER in e]
        loop_page = [e for e in page_errors if LOOP_MARKER in e]
        assert not loop_console, f"console update-depth errors: {loop_console[:2]}"
        assert not loop_page, f"page update-depth errors: {loop_page[:2]}"

        print(f"PASS (console errors seen: {len(console_errors)}, none were update-depth)")
        await browser.close()


asyncio.run(main())
