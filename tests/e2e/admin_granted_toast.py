import asyncio, json
from pathlib import Path
from playwright.async_api import async_playwright

SHOTS = Path("/tmp/browser/admin-toast/shots"); SHOTS.mkdir(exist_ok=True)
EMAIL = "user@demo.lovable.app"
PASSWORD = "TestPass!2026"
UID = "6e310a16-8532-4a89-bc16-bcc4b78d2934"

async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width":1280,"height":1800})
        page = await ctx.new_page()
        console_msgs = []
        page.on("console", lambda m: console_msgs.append(f"[{m.type}] {m.text}"))

        await page.goto("http://localhost:8080/auth", wait_until="domcontentloaded")
        await page.get_by_placeholder("you@").first.fill(EMAIL) if await page.get_by_placeholder("you@").count() else await page.locator('input[type="email"]').fill(EMAIL)
        await page.locator('input[type="password"]').fill(PASSWORD)
        await page.screenshot(path=str(SHOTS/"1_signin.png"))
        await page.get_by_role("button", name="Sign in", exact=False).click()

        # Wait for redirect off /auth
        await page.wait_for_url(lambda u: "/auth" not in u, timeout=15000)
        await page.wait_for_timeout(1500)
        print("post-signin url:", page.url)
        await page.screenshot(path=str(SHOTS/"2_signed_in.png"))

        # Clear the once-per-browser guard so the toast can fire
        await page.evaluate(f"window.localStorage.removeItem('admin-granted-notified:{UID}')")

        # Assert not admin yet
        pre_roles = await page.evaluate("""async () => {
          const { supabase } = await import('/src/integrations/supabase/client.ts');
          const { data } = await supabase.from('user_roles').select('role').eq('user_id','6e310a16-8532-4a89-bc16-bcc4b78d2934');
          return data;
        }""")
        print("roles before:", pre_roles)
        assert not any(r["role"] == "admin" for r in (pre_roles or [])), "user already admin"

        # Grant admin via allowlist RPC (fires realtime INSERT → toast)
        claim = await page.evaluate("""async () => {
          const { supabase } = await import('/src/integrations/supabase/client.ts');
          const { data, error } = await supabase.rpc('claim_admin_if_allowed');
          return { data, error: error?.message };
        }""")
        print("claim result:", claim)
        assert claim.get("data") is True, f"claim failed: {claim}"

        # Wait for the sonner toast text
        toast = page.locator('[data-sonner-toast]', has_text="admin access")
        try:
            await toast.first.wait_for(state="visible", timeout=8000)
            visible = True
        except Exception:
            visible = False
        await page.screenshot(path=str(SHOTS/"3_after_grant.png"))
        text = await toast.first.text_content() if visible else None
        print("toast visible:", visible, "text:", text)

        # Verify admin role in DB via UI supabase
        post_roles = await page.evaluate("""async () => {
          const { supabase } = await import('/src/integrations/supabase/client.ts');
          const { data } = await supabase.from('user_roles').select('role').eq('user_id','6e310a16-8532-4a89-bc16-bcc4b78d2934');
          return data;
        }""")
        print("roles after:", post_roles)

        print("\n--- CONSOLE ---")
        for m in console_msgs[-30:]: print(m)

        assert visible, "admin-granted toast did not appear"
        assert any(r["role"]=="admin" for r in (post_roles or [])), "admin role not present after claim"
        print("\nPASS")
        await browser.close()

asyncio.run(main())
