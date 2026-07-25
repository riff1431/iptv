"""E2E: non-admin users hitting any /admin/* UI route are redirected to a
friendly /forbidden screen — never see a raw error, blank page, or 5xx.

For each protected admin route we verify:
  1. The response never returns a 5xx status.
  2. The signed-in non-admin ends up at /forbidden with ?from=<original>.
  3. The friendly access-denied UI is visible: "403", "Admins only", and
     a "Go to dashboard" link.
  4. No uncaught page errors fire during the navigation.

The demo user (user@demo.lovable.app) is a plain 'user' — the test asserts
that precondition and never mutates roles, so it is idempotent.
"""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

SHOTS = Path("/tmp/browser/admin-non-admin/shots")
SHOTS.mkdir(parents=True, exist_ok=True)

BASE = "http://localhost:8080"
EMAIL = "user@demo.lovable.app"
PASSWORD = "TestPass!2026"
UID = "6e310a16-8532-4a89-bc16-bcc4b78d2934"

# Sample across the layout parent and several distinct child routes so we
# catch a route that forgets to inherit the parent guard.
ADMIN_ROUTES = [
    "/admin",
    "/admin/arena",
    "/admin/lounges",
    "/admin/tvs",
    "/admin/users",
    "/admin/audit",
    "/admin/payments",
    "/admin/settings",
    "/admin/wallet-ledger",
]


async def sign_in(page):
    await page.goto(f"{BASE}/auth", wait_until="domcontentloaded")
    await page.locator("#signin-email").fill(EMAIL)
    await page.locator("#signin-password").fill(PASSWORD)
    await page.get_by_role("button", name="Sign In", exact=True).click()
    await page.wait_for_url(lambda u: "/auth" not in u, timeout=15000)


async def get_roles(page):
    return await page.evaluate(
        f"""async () => {{
          const {{ supabase }} = await import('/src/integrations/supabase/client.ts');
          const {{ data }} = await supabase.from('user_roles').select('role').eq('user_id','{UID}');
          return (data ?? []).map(r => r.role);
        }}"""
    )


async def check_route(page, path):
    page_errors = []
    status_codes = []

    def on_response(resp):
        # Only care about the top-level document response(s).
        if resp.request.resource_type == "document":
            status_codes.append((resp.url, resp.status))

    def on_pageerror(err):
        page_errors.append(str(err))

    page.on("response", on_response)
    page.on("pageerror", on_pageerror)

    try:
        await page.goto(f"{BASE}{path}", wait_until="domcontentloaded")
        # Wait for the client-side guard to redirect.
        await page.wait_for_url(lambda u: "/forbidden" in u, timeout=10000)
        # Let the friendly UI paint.
        await page.wait_for_selector("text=Admins only", timeout=5000)
        body = await page.locator("body").inner_text()
        landed = page.url
        await page.screenshot(path=str(SHOTS / f"{path.strip('/').replace('/', '_') or 'admin'}.png"))
    finally:
        page.remove_listener("response", on_response)
        page.remove_listener("pageerror", on_pageerror)

    # Assertions ------------------------------------------------------------
    bad_status = [(u, s) for (u, s) in status_codes if s >= 500]
    assert not bad_status, f"{path}: 5xx document response(s): {bad_status}"

    assert "/forbidden" in landed, f"{path}: expected /forbidden, landed on {landed}"
    assert "from=" in landed, f"{path}: /forbidden missing ?from param — got {landed}"

    for needle in ("403", "Admins only", "Go to dashboard"):
        assert needle in body, f"{path}: access-denied UI missing '{needle}'. Body: {body[:400]!r}"

    assert not page_errors, f"{path}: uncaught page errors: {page_errors}"

    print(f"OK  {path:28s} → {landed}")


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()

        await sign_in(page)
        roles = await get_roles(page)
        print("roles:", roles)
        assert "admin" not in roles, (
            f"precondition failed: {EMAIL} already has admin role: {roles}"
        )

        for path in ADMIN_ROUTES:
            await check_route(page, path)

        # Confirm the friendly page also renders its home link and CTA.
        assert await page.get_by_role("link", name="Go to dashboard").first.is_visible()
        assert await page.get_by_role("link", name="Home").first.is_visible()

        await ctx.close()
        await browser.close()

    print(f"\nPASS: {len(ADMIN_ROUTES)} admin routes redirect non-admin to friendly /forbidden")


if __name__ == "__main__":
    asyncio.run(main())
