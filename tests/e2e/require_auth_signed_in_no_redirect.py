"""E2E: signed-in users hitting protected routes render normally and never bounce to /auth."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

SHOTS = Path("/tmp/browser/require-auth-signed-in/shots")
SHOTS.mkdir(parents=True, exist_ok=True)

EMAIL = "user@demo.lovable.app"
PASSWORD = "TestPass!2026"

# Protected routes gated by RequireAuth for any signed-in user
PROTECTED = ["/dashboard", "/wallet", "/profile", "/messages", "/friends"]


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        redirects_to_auth: list[str] = []

        def on_framenav(frame):
            if frame == page.main_frame and "/auth" in frame.url:
                redirects_to_auth.append(frame.url)

        page.on("framenavigated", on_framenav)

        # Sign in
        await page.goto("http://localhost:8080/auth", wait_until="domcontentloaded")
        await page.locator('#signin-email').fill(EMAIL)
        await page.locator('input[type="password"]').first.fill(PASSWORD)
        await page.get_by_role("button", name="Sign In", exact=True).click()
        await page.wait_for_url(lambda u: "/auth" not in u, timeout=15000)
        await page.wait_for_timeout(1000)
        print("signed in, landed at:", page.url)
        await page.screenshot(path=str(SHOTS / "0_signed_in.png"))

        # From here on, any nav to /auth is a failure
        redirects_to_auth.clear()

        for i, route in enumerate(PROTECTED, start=1):
            url = f"http://localhost:8080{route}"
            await page.goto(url, wait_until="domcontentloaded")
            # Give RequireAuth's effect a beat to (incorrectly) redirect if it were going to
            await page.wait_for_timeout(1200)
            final = page.url
            await page.screenshot(path=str(SHOTS / f"{i}_{route.strip('/').replace('/', '_')}.png"))
            print(f"{route} -> {final}")
            assert "/auth" not in final, f"{route} bounced to auth: {final}"
            # Should not be showing the RequireAuth gate placeholder
            body_text = (await page.locator("body").inner_text()).lower()
            assert "redirecting" not in body_text[:400], f"{route} stuck on redirecting gate"

        assert not redirects_to_auth, f"unexpected /auth navigations: {redirects_to_auth}"

        print("\nPASS")
        await browser.close()


asyncio.run(main())
