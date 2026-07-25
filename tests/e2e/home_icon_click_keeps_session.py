"""E2E regression: after signing in, clicking the homepage icon (PGX brand)
must keep the user signed in, not flash the signed-out header, and never
trip the root ErrorComponent takeover.

Guards against the previously-observed "auto logout" symptom where either:
  (a) UserNav rendered the "Log In / Create Account" CTAs while
      `useAuth()` was still resolving `getUser()`, or
  (b) a realtime channel-name collision (e.g. `arena-matches-0`) threw
      "cannot add postgres_changes callbacks after subscribe()" and the
      root ErrorComponent replaced the page.
"""
import asyncio
from pathlib import Path
import re
from playwright.async_api import async_playwright

SHOTS = Path("/tmp/browser/home-icon-keeps-session/shots")
SHOTS.mkdir(parents=True, exist_ok=True)

EMAIL = "user@demo.lovable.app"
PASSWORD = "TestPass!2026"

# Strings that would appear if the root ErrorComponent takes over. Match
# what src/routes/__root.tsx and the router's defaultErrorComponent render.
ERROR_TAKEOVER_MARKERS = [
    "something went wrong",
    "unexpected error",
    "an error occurred",
    "try again",
    "reload the page",
]

# Fatal console errors we should surface (soft-fail on the noisy dev ones).
FATAL_CONSOLE_PATTERNS = [
    "cannot add `postgres_changes` callbacks",
    "cannot add `postgres_changes` callbacks after `subscribe()`",
    "error in route match",
]


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
        after_signin_url = page.url
        print("signed in, landed at:", after_signin_url)
        await page.screenshot(path=str(SHOTS / "0_signed_in.png"))

        # Confirm the signed-in header is rendered before we start (Sign In
        # / Create Account CTAs must NOT be present once auth is settled).
        signin_cta = await page.get_by_role("button", name="Log In", exact=True).count()
        signup_cta = await page.get_by_role("button", name="Create Account", exact=True).count()
        assert signin_cta == 0 and signup_cta == 0, (
            f"signed-out CTAs present after sign-in: log-in={signin_cta} create={signup_cta}"
        )

        # 2. Navigate to a non-home route first so clicking the brand is a
        #    real soft-navigation, not a same-URL no-op.
        await page.goto("http://localhost:8080/arena", wait_until="domcontentloaded")
        await page.wait_for_load_state("networkidle")
        await page.screenshot(path=str(SHOTS / "1_on_arena.png"))

        # 3. Click the homepage icon (PGX brand link in the top nav).
        brand = page.get_by_role("link", name="PGX Sports Lounge home")
        if await brand.count() == 0:
            # Fallback: any link whose accessible name contains "PGX".
            brand = page.get_by_role("link", name=re.compile(r"pgx", re.I)).first
        assert await brand.count() > 0, "could not find the PGX home brand link"
        await brand.first.click()
        # Wait for the URL to become the homepage (path may include search).
        await page.wait_for_url(
            lambda u: u.rstrip("/").endswith("localhost:8080") or "localhost:8080/?" in u,
            timeout=10000,
        )

        # 4. Sample the header immediately AND after settle to catch a
        #    transient signed-out flash. The regression manifested as
        #    "Log In / Create Account" appearing for ~200ms.
        transient_signed_out_flash = False
        for i in range(10):
            cta_count = await page.get_by_role("button", name="Log In", exact=True).count()
            cta_count += await page.get_by_role("button", name="Create Account", exact=True).count()
            if cta_count > 0:
                transient_signed_out_flash = True
                await page.screenshot(path=str(SHOTS / f"2_flash_{i}.png"))
                break
            await page.wait_for_timeout(50)
        assert not transient_signed_out_flash, (
            "Signed-out CTA appeared on the home header after clicking the brand — "
            "UserNav is showing the logged-out shell while auth is still loading."
        )

        await page.wait_for_load_state("networkidle")
        await page.screenshot(path=str(SHOTS / "3_home_settled.png"))

        # 5. Root ErrorComponent must not have taken over.
        body_text = (await page.locator("body").inner_text()).lower()
        for marker in ERROR_TAKEOVER_MARKERS:
            assert marker not in body_text, (
                f"root ErrorComponent appears to have taken over the homepage — "
                f"found marker: {marker!r}"
            )

        # 6. Still signed in? Signed-out CTAs must be absent, and a
        #    signed-in affordance (avatar/menu trigger or Sign Out) must exist.
        cta_count = await page.get_by_role("button", name="Log In", exact=True).count()
        cta_count += await page.get_by_role("button", name="Create Account", exact=True).count()
        assert cta_count == 0, f"signed-out CTAs still present after settle: {cta_count}"

        # Any of these labels means the signed-in header rendered. Poll
        # for up to 8s: the header's auth-loading skeleton legitimately
        # takes a beat to resolve while useAuth() fetches roles.
        signed_in_locator = page.locator(
            'button[aria-label="Notifications"],'
            'button[aria-label*="Account menu"],'
            'button[aria-label*="avatar" i]'
        )
        try:
            await signed_in_locator.first.wait_for(state="attached", timeout=8000)
        except Exception:
            await page.screenshot(path=str(SHOTS / "3b_no_signed_in_marker.png"))
            raise AssertionError("no signed-in header affordance found on homepage")

        # 7. No fatal console errors (channel reuse, route-match error).
        assert not fatal_errors, f"fatal console errors during nav: {fatal_errors}"

        # 8. Sanity: reload the homepage and re-check — the signed-in
        #    session must survive a hard reload too.
        await page.reload(wait_until="networkidle")
        await page.screenshot(path=str(SHOTS / "4_after_reload.png"))
        cta_count = await page.get_by_role("button", name="Log In", exact=True).count()
        cta_count += await page.get_by_role("button", name="Create Account", exact=True).count()
        assert cta_count == 0, f"signed-out CTAs present after hard reload: {cta_count}"

        print("\nPASS")
        print(f"non-fatal console errors: {len(console_errors)}")
        await browser.close()


asyncio.run(main())
