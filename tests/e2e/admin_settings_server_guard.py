"""E2E: server-side guard on updateAdminAllowlist.

- Signed-in non-admin invoking `updateAdminAllowlist` must be rejected by the
  `requireAdminServer` middleware (throws before mutating app_settings).
- Signed-in admin invoking it succeeds, and the returned emails reflect the
  update. Original allowlist is restored afterwards (idempotent).

Server fns are called through their client RPC stubs (imported from the
`.functions.ts` module) so TanStack's serialization / bearer attacher run
exactly as they do in production.
"""
import asyncio, json
from pathlib import Path
from playwright.async_api import async_playwright

SHOTS = Path("/tmp/browser/admin-server-guard/shots"); SHOTS.mkdir(parents=True, exist_ok=True)
EMAIL = "user@demo.lovable.app"
PASSWORD = "TestPass!2026"
UID = "6e310a16-8532-4a89-bc16-bcc4b78d2934"
BASE = "http://localhost:8080"

async def sign_in(page):
    await page.goto(f"{BASE}/auth", wait_until="domcontentloaded")
    await page.locator('input[type="email"]').fill(EMAIL)
    await page.locator('input[type="password"]').fill(PASSWORD)
    await page.get_by_role("button", name="Sign in", exact=False).click()
    await page.wait_for_url(lambda u: "/auth" not in u, timeout=15000)

async def call_update(page, emails):
    return await page.evaluate(
        """async (emails) => {
          const mod = await import('/src/lib/admin-settings.functions.ts');
          try {
            const data = await mod.updateAdminAllowlist({ data: { emails } });
            return { ok: true, data };
          } catch (e) {
            return { ok: false, error: String(e?.message ?? e) };
          }
        }""",
        emails,
    )

async def call_get(page):
    return await page.evaluate(
        """async () => {
          const mod = await import('/src/lib/admin-settings.functions.ts');
          try {
            const data = await mod.getAdminAllowlist();
            return { ok: true, data };
          } catch (e) {
            return { ok: false, error: String(e?.message ?? e) };
          }
        }"""
    )

async def get_allowlist_admin(page):
    # Direct read using the signed-in admin's client (RLS allows admins).
    return await page.evaluate("""async () => {
      const { supabase } = await import('/src/integrations/supabase/client.ts');
      const { data, error } = await supabase.from('app_settings')
        .select('admin_bootstrap_emails').eq('id', true).maybeSingle();
      return { data: data?.admin_bootstrap_emails ?? [], error: error?.message };
    }""")

async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width":1280,"height":1800})
        page = await ctx.new_page()

        await sign_in(page)

        # --- Case 1: non-admin call must be rejected ---
        roles = await page.evaluate(f"""async () => {{
          const {{ supabase }} = await import('/src/integrations/supabase/client.ts');
          const {{ data }} = await supabase.from('user_roles').select('role').eq('user_id','{UID}');
          return (data ?? []).map(r => r.role);
        }}""")
        print("roles before:", roles)
        assert "admin" not in roles, f"precondition failed: {EMAIL} is admin: {roles}"

        # Try to sneak in a bogus email as a non-admin.
        result = await call_update(page, ["attacker@evil.example"])
        print("non-admin update result:", result)
        assert result["ok"] is False, f"non-admin update unexpectedly succeeded: {result}"
        assert "forbidden" in result["error"].lower() or "unauthorized" in result["error"].lower() \
            or "admin" in result["error"].lower(), f"unexpected error: {result['error']}"

        # get should also be rejected for non-admin.
        get_result = await call_get(page)
        print("non-admin get result:", get_result)
        assert get_result["ok"] is False, f"non-admin get unexpectedly succeeded: {get_result}"

        await page.screenshot(path=str(SHOTS/"1_non_admin_rejected.png"))

        # --- Case 2: promote to admin, then update must succeed ---
        claim = await page.evaluate("""async () => {
          const { supabase } = await import('/src/integrations/supabase/client.ts');
          const { data, error } = await supabase.rpc('claim_admin_if_allowed');
          return { data, error: error?.message };
        }""")
        print("claim_admin_if_allowed:", claim)
        assert claim.get("data") is True, f"claim failed: {claim}"

        original = await get_allowlist_admin(page)
        print("original allowlist:", original)
        assert original.get("error") is None
        original_emails = original["data"]

        # Preserve original + append a probe email so we can prove a write happened.
        probe = "e2e-probe@demo.lovable.app"
        new_emails = list(original_emails)
        if probe not in new_emails:
            new_emails.append(probe)

        try:
            update_result = await call_update(page, new_emails)
            print("admin update result:", update_result)
            assert update_result["ok"] is True, f"admin update failed: {update_result}"
            returned = update_result["data"]["emails"]
            assert probe in returned, f"probe email missing from response: {returned}"

            # Verify persisted.
            after = await get_allowlist_admin(page)
            print("after write:", after)
            assert probe in after["data"], f"probe email not persisted: {after}"

            # And getAdminAllowlist server fn works for admins too.
            get_admin_result = await call_get(page)
            print("admin get result:", get_admin_result)
            assert get_admin_result["ok"] is True
            assert probe in get_admin_result["data"]["emails"]

            await page.screenshot(path=str(SHOTS/"2_admin_updated.png"))
        finally:
            # Restore original allowlist and revoke admin role.
            restore = await call_update(page, original_emails)
            print("restore:", restore)
            revoke = await page.evaluate(f"""async () => {{
              const {{ supabase }} = await import('/src/integrations/supabase/client.ts');
              const {{ error }} = await supabase.from('user_roles')
                .delete().eq('user_id','{UID}').eq('role','admin');
              return {{ error: error?.message }};
            }}""")
            print("revoke:", revoke)

        await ctx.close()
        await browser.close()

    print("\nPASS: non-admin blocked, admin can update app_settings via server fn")

asyncio.run(main())
