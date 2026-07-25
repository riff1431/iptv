"""E2E: /admin/settings guard for signed-out, non-admin, and admin users.

- Signed-out visitor → redirected to /auth (with ?redirect back to /admin/settings)
- Signed-in non-admin → redirected to /forbidden (with ?from=/admin/settings)
- Signed-in admin → /admin/settings loads (URL unchanged, page renders)

The demo user (user@demo.lovable.app) starts as a plain 'user'. The test grants
admin via the allowlist-backed `claim_admin_if_allowed` RPC after asserting the
non-admin redirect, then revokes it through the admin's own Supabase client so
the test is idempotent (another admin exists, so the last-admin trigger is
inert).
"""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

SHOTS = Path("/tmp/browser/admin-guard/shots"); SHOTS.mkdir(parents=True, exist_ok=True)
EMAIL = "user@demo.lovable.app"
PASSWORD = "TestPass!2026"
UID = "6e310a16-8532-4a89-bc16-bcc4b78d2934"
BASE = "http://localhost:8080"
TARGET = f"{BASE}/admin/settings"

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

        # --- Case 1: signed-out → /auth ---
        ctx = await browser.new_context(viewport={"width":1280,"height":1800})
        page = await ctx.new_page()
        await page.goto(TARGET, wait_until="domcontentloaded")
        await page.wait_for_url(lambda u: "/auth" in u, timeout=10000)
        await page.screenshot(path=str(SHOTS/"1_signed_out.png"))
        url1 = page.url
        print("signed-out landed:", url1)
        assert "/auth" in url1, f"expected /auth, got {url1}"
        assert "admin" in url1 and "settings" in url1, f"missing ?redirect back-param in {url1}"
        await ctx.close()

        # --- Case 2: signed-in non-admin → /forbidden ---
        ctx = await browser.new_context(viewport={"width":1280,"height":1800})
        page = await ctx.new_page()
        await sign_in(page)
        roles_before = await get_roles(page)
        print("roles before:", roles_before)
        assert "admin" not in roles_before, (
            f"precondition failed: {EMAIL} already has admin role: {roles_before}"
        )

        await page.goto(TARGET, wait_until="domcontentloaded")
        await page.wait_for_url(lambda u: "/forbidden" in u, timeout=10000)
        await page.screenshot(path=str(SHOTS/"2_non_admin.png"))
        url2 = page.url
        print("non-admin landed:", url2)
        assert "/forbidden" in url2, f"expected /forbidden, got {url2}"
        assert "from=" in url2 and "admin" in url2, f"missing ?from param in {url2}"

        # --- Case 3: grant admin, then /admin/settings must load ---
        claim = await page.evaluate("""async () => {
          const { supabase } = await import('/src/integrations/supabase/client.ts');
          const { data, error } = await supabase.rpc('claim_admin_if_allowed');
          return { data, error: error?.message };
        }""")
        print("claim_admin_if_allowed:", claim)
        assert claim.get("data") is True, f"claim failed: {claim}"

        try:
            await page.goto(TARGET, wait_until="domcontentloaded")
            # Guard must NOT redirect.
            await page.wait_for_load_state("networkidle", timeout=10000)
            await page.screenshot(path=str(SHOTS/"3_admin.png"))
            url3 = page.url
            print("admin landed:", url3)
            assert url3.rstrip("/") == TARGET.rstrip("/"), f"expected {TARGET}, got {url3}"
            heading = page.get_by_role("heading", name="Settings", exact=False)
            await heading.first.wait_for(state="visible", timeout=5000)
        finally:
            # Cleanup: revoke admin via the user's own (now-admin) supabase client.
            # RLS "Admins manage roles" allows this; another admin still exists.
            revoke = await page.evaluate(f"""async () => {{
              const {{ supabase }} = await import('/src/integrations/supabase/client.ts');
              const {{ error }} = await supabase.from('user_roles')
                .delete().eq('user_id','{UID}').eq('role','admin');
              return {{ error: error?.message }};
            }}""")
            print("revoke:", revoke)

        await ctx.close()
        await browser.close()

    print("\nPASS: signed-out → /auth, non-admin → /forbidden, admin → /admin/settings")

asyncio.run(main())
