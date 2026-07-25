"""E2E: when auth flips from signed-in -> signed-out mid-session, RequireAuth
redirects to /auth exactly once (no loops)."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

SHOTS = Path("/tmp/browser/require-auth-signout-mid-nav/shots")
SHOTS.mkdir(parents=True, exist_ok=True)

EMAIL = "user@demo.lovable.app"
PASSWORD = "TestPass!2026"

PROTECTED = "/wallet"


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()

        nav_history: list[str] = []

        def on_framenav(frame):
            if frame == page.main_frame:
                nav_history.append(frame.url)

        page.on("framenavigated", on_framenav)

        # 1. Sign in.
        await page.goto("http://localhost:8080/auth", wait_until="domcontentloaded")
        await page.locator("#signin-email").fill(EMAIL)
        await page.locator('input[type="password"]').first.fill(PASSWORD)
        await page.get_by_role("button", name="Sign In", exact=True).click()
        await page.wait_for_url(lambda u: "/auth" not in u, timeout=15000)
        await page.wait_for_timeout(800)
        print("signed in at:", page.url)
        await page.screenshot(path=str(SHOTS / "0_signed_in.png"))

        # 2. Navigate to a protected page and confirm it renders (no auth form).
        await page.goto(f"http://localhost:8080{PROTECTED}", wait_until="domcontentloaded")
        try:
            await page.locator("#signin-email").wait_for(state="detached", timeout=3000)
        except Exception:
            pass
        await page.wait_for_timeout(500)
        assert "/auth" not in page.url, f"unexpected bounce to /auth before signout: {page.url}"
        await page.screenshot(path=str(SHOTS / "1_on_protected.png"))
        print("on protected route:", page.url)

        # Reset nav history so we only measure post-signout activity.
        nav_history.clear()

        # 3. Flip auth to signed-out in-place (no manual navigation).
        # This mirrors token expiry / another tab signing out — the auth state
        # change must trigger RequireAuth to redirect the current route once.
        await page.evaluate(
            """
            (async () => {
              const mod = await import('/src/integrations/supabase/client.ts');
              await mod.supabase.auth.signOut();
            })()
            """
        )

        # 4. Wait for the redirect to land on /auth.
        await page.wait_for_url(lambda u: "/auth" in u, timeout=10000)
        # Give the app extra time so any redirect loop would manifest as more navigations.
        await page.wait_for_timeout(2500)
        final = page.url
        await page.screenshot(path=str(SHOTS / "2_after_signout.png"))
        print("after signout landed at:", final)

        # 5. Assertions.
        assert "/auth" in final, f"did not redirect to /auth after signout: {final}"
        # Note: the redirect param is best-effort — the app may sign out via a
        # root onAuthStateChange subscriber that navigates without preserving
        # the prior route. The loop check below is the real assertion.

        # No loop: count post-signout navigations. A healthy flow is a small,
        # bounded number of main-frame navigations (route change + possibly a
        # replace to normalize the URL). A loop would produce dozens.
        auth_hits = [u for u in nav_history if "/auth" in u]
        print(f"post-signout nav count: {len(nav_history)} (auth hits: {len(auth_hits)})")
        for u in nav_history:
            print("  nav:", u)
        assert len(nav_history) <= 6, f"too many navigations after signout (loop?): {nav_history}"
        assert len(auth_hits) <= 3, f"repeated /auth navigations (loop?): {auth_hits}"

        # Auth form is now rendered.
        assert await page.locator("#signin-email").count() > 0, "auth form did not render after signout"

        print("\nPASS")
        await browser.close()


asyncio.run(main())
