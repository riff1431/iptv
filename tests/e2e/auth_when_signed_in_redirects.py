"""E2E: visiting /auth while signed in never shows the auth screen — it routes to the post-login page."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

SHOTS = Path("/tmp/browser/auth-when-signed-in/shots")
SHOTS.mkdir(parents=True, exist_ok=True)

EMAIL = "user@demo.lovable.app"
PASSWORD = "TestPass!2026"

# (path to visit, expected landing path after auth-guard bounces the signed-in user)
# No `redirect` param => fallback to /dashboard (non-admin demo user).
# With `redirect` param => honor the requested target.
CASES = [
    ("/auth", "/dashboard"),
    ("/auth?mode=signin", "/dashboard"),
    ("/auth?mode=signup", "/dashboard"),
    ("/auth?redirect=%2Fwallet", "/wallet"),
    ("/auth?redirect=%2Fprofile", "/profile"),
]


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()

        # Sign in first
        await page.goto("http://localhost:8080/auth", wait_until="domcontentloaded")
        await page.locator("#signin-email").fill(EMAIL)
        await page.locator('input[type="password"]').first.fill(PASSWORD)
        await page.get_by_role("button", name="Sign In", exact=True).click()
        await page.wait_for_url(lambda u: "/auth" not in u, timeout=15000)
        await page.wait_for_timeout(1000)
        print("signed in at:", page.url)
        await page.screenshot(path=str(SHOTS / "0_signed_in.png"))

        for i, (visit, expected) in enumerate(CASES, start=1):
            url = f"http://localhost:8080{visit}"
            await page.goto(url, wait_until="domcontentloaded")
            # Wait for the auth-page redirect effect to fire and land off /auth.
            await page.wait_for_url(lambda u: "/auth" not in u, timeout=10000)
            # Wait for the auth form to fully unmount before asserting.
            try:
                await page.locator("#signin-email").wait_for(state="detached", timeout=5000)
            except Exception:
                pass
            await page.wait_for_timeout(300)
            final = page.url
            await page.screenshot(path=str(SHOTS / f"{i}_{visit.replace('/', '_').replace('?', '_').replace('=', '-').replace('%', 'p')}.png"))
            print(f"visit {visit} -> {final} (expected suffix {expected})")

            assert "/auth" not in final, f"still on auth screen for {visit}: {final}"

            has_signin_input = await page.locator("#signin-email").count()
            assert has_signin_input == 0, f"auth form still rendered after visiting {visit}"

            # Landed on the expected post-login page.
            from urllib.parse import urlparse
            path = urlparse(final).path
            assert path == expected, f"{visit}: expected to land on {expected}, got {path}"

        print("\nPASS")
        await browser.close()


asyncio.run(main())
