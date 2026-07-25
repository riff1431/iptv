"""E2E: guard applies to every /admin/* page besides /admin/settings.

For each protected page:
  - Signed-out visitor  → /auth?redirect=<path>
  - Signed-in non-admin → /forbidden?from=<path>

The admin-can-access case is already covered for /admin/settings in
admin_settings_guard.py; this test focuses on the sibling routes to prove the
parent /admin beforeLoad guard covers them uniformly.
"""
import asyncio
from pathlib import Path
from urllib.parse import quote
from playwright.async_api import async_playwright

SHOTS = Path("/tmp/browser/admin-siblings/shots"); SHOTS.mkdir(parents=True, exist_ok=True)
EMAIL = "user@demo.lovable.app"
PASSWORD = "TestPass!2026"
UID = "6e310a16-8532-4a89-bc16-bcc4b78d2934"
BASE = "http://localhost:8080"
PATHS = ["/admin", "/admin/lounges", "/admin/tvs", "/admin/ads", "/admin/users"]

async def sign_in(page):
    await page.goto(f"{BASE}/auth", wait_until="domcontentloaded")
    await page.locator('input[type="email"]').fill(EMAIL)
    await page.locator('input[type="password"]').fill(PASSWORD)
    await page.get_by_role("button", name="Sign in", exact=False).click()
    await page.wait_for_url(lambda u: "/auth" not in u, timeout=15000)

async def get_roles(page):
    return await page.evaluate(f"""async () => {{
      const {{ supabase }} = await import('/src/integrations/supabase/client.ts');
      const {{ data }} = await supabase.from('user_roles').select('role').eq('user_id','{UID}');
      return (data ?? []).map(r => r.role);
    }}""")

async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)

        # --- Signed-out: fresh context, no session ---
        ctx = await browser.new_context(viewport={"width":1280,"height":1800})
        page = await ctx.new_page()
        for path in PATHS:
            await page.goto(f"{BASE}{path}", wait_until="domcontentloaded")
            await page.wait_for_url(lambda u: "/auth" in u, timeout=10000)
            url = page.url
            print(f"signed-out {path} → {url}")
            assert "/auth" in url, f"{path}: expected /auth, got {url}"
            assert quote(path, safe="") in url, (
                f"{path}: expected ?redirect back-param, got {url}"
            )
            await page.screenshot(path=str(SHOTS/f"signed_out_{path.strip('/').replace('/','_') or 'root'}.png"))
        await ctx.close()

        # --- Non-admin: signed in as plain 'user' ---
        ctx = await browser.new_context(viewport={"width":1280,"height":1800})
        page = await ctx.new_page()
        await sign_in(page)
        roles = await get_roles(page)
        print("roles:", roles)
        assert "admin" not in roles, f"precondition failed: {EMAIL} is admin: {roles}"

        for path in PATHS:
            await page.goto(f"{BASE}{path}", wait_until="domcontentloaded")
            await page.wait_for_url(lambda u: "/forbidden" in u, timeout=10000)
            url = page.url
            print(f"non-admin {path} → {url}")
            assert "/forbidden" in url, f"{path}: expected /forbidden, got {url}"
            assert "from=" in url and quote(path, safe="") in url, (
                f"{path}: expected ?from param, got {url}"
            )
            await page.screenshot(path=str(SHOTS/f"non_admin_{path.strip('/').replace('/','_') or 'root'}.png"))
        await ctx.close()

        await browser.close()

    print(f"\nPASS: {len(PATHS)} routes guarded for signed-out and non-admin")

asyncio.run(main())
