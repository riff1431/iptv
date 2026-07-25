"""E2E: signed-in user visiting /dashboard renders normally; ErrorComponent never takes over."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

SHOTS = Path("/tmp/browser/dashboard-no-error/shots")
SHOTS.mkdir(parents=True, exist_ok=True)

EMAIL = "user@demo.lovable.app"
PASSWORD = "TestPass!2026"

ERROR_MARKERS = [
    "Something went wrong. Try refreshing",
    "Maximum update depth exceeded",
]


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()

        console_errors: list[str] = []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

        # Sign in
        await page.goto("http://localhost:8080/auth", wait_until="domcontentloaded")
        await page.locator('#signin-email').fill(EMAIL)
        await page.locator('input[type="password"]').first.fill(PASSWORD)
        await page.get_by_role("button", name="Sign In", exact=True).click()
        await page.wait_for_url(lambda u: "/auth" not in u, timeout=15000)
        await page.wait_for_timeout(500)
        print("signed in ->", page.url)

        # Navigate to /dashboard
        await page.goto("http://localhost:8080/dashboard", wait_until="domcontentloaded")
        # Give the dashboard time to fully mount, run effects, and settle
        await page.wait_for_timeout(4000)
        await page.screenshot(path=str(SHOTS / "1_dashboard.png"))

        assert "/dashboard" in page.url, f"redirected off dashboard: {page.url}"

        body_text = await page.locator("body").inner_text()
        for marker in ERROR_MARKERS:
            assert marker not in body_text, f"ErrorComponent/loop visible: {marker!r}"

        # Assert something real rendered (header + at least one heading)
        assert await page.locator("h1, h2").count() > 0, "no headings rendered"

        # Poll a second time to catch a delayed error boundary
        await page.wait_for_timeout(2000)
        body_text2 = await page.locator("body").inner_text()
        for marker in ERROR_MARKERS:
            assert marker not in body_text2, f"delayed ErrorComponent: {marker!r}"

        loop_errors = [e for e in console_errors if "Maximum update depth" in e]
        assert not loop_errors, f"update-depth errors in console: {loop_errors[:2]}"

        print("PASS")
        await browser.close()


asyncio.run(main())
