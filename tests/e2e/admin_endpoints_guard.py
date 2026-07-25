"""E2E: every admin-only server fn rejects signed-out and non-admin callers.

Covers all admin-only server functions in the app:
  - admin-settings.functions.ts: getAdminAllowlist, updateAdminAllowlist
  - admin-users.functions.ts:    listAdminUsers, updateUserRole, adminSendPasswordReset

For each fn:
  - signed-out call  → rejected with "Unauthorized" (no bearer token)
  - non-admin call   → rejected with "Forbidden" (admin role required)

Server fns are invoked through their client RPC stubs so TanStack's serialization
and the bearer-attacher middleware run exactly as in production.
"""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

SHOTS = Path("/tmp/browser/admin-endpoints/shots"); SHOTS.mkdir(parents=True, exist_ok=True)
EMAIL = "user@demo.lovable.app"
PASSWORD = "TestPass!2026"
UID = "6e310a16-8532-4a89-bc16-bcc4b78d2934"
BASE = "http://localhost:8080"

# (label, module, exportName, argJson-or-None)
ENDPOINTS = [
    ("getAdminAllowlist",     "/src/lib/admin-settings.functions.ts", "getAdminAllowlist",     None),
    ("updateAdminAllowlist",  "/src/lib/admin-settings.functions.ts", "updateAdminAllowlist",  {"emails": ["attacker@evil.example"]}),
    ("listAdminUsers",        "/src/lib/admin-users.functions.ts",    "listAdminUsers",        None),
    ("updateUserRole",        "/src/lib/admin-users.functions.ts",    "updateUserRole",        {"userId": UID, "role": "admin", "action": "grant"}),
    ("adminSendPasswordReset","/src/lib/admin-users.functions.ts",    "adminSendPasswordReset",{"email": "someone@example.com"}),
]

async def sign_in(page):
    await page.goto(f"{BASE}/auth", wait_until="domcontentloaded")
    await page.locator('input[type="email"]').fill(EMAIL)
    await page.locator('input[type="password"]').fill(PASSWORD)
    await page.get_by_role("button", name="Sign in", exact=False).click()
    await page.wait_for_url(lambda u: "/auth" not in u, timeout=15000)

async def call_fn(page, module, name, arg):
    return await page.evaluate(
        """async ({ module, name, arg }) => {
          const mod = await import(module);
          const fn = mod[name];
          try {
            const data = arg === null ? await fn() : await fn({ data: arg });
            return { ok: true, data };
          } catch (e) {
            return { ok: false, error: String(e?.message ?? e) };
          }
        }""",
        {"module": module, "name": name, "arg": arg},
    )

async def get_roles(page):
    return await page.evaluate(f"""async () => {{
      const {{ supabase }} = await import('/src/integrations/supabase/client.ts');
      const {{ data }} = await supabase.from('user_roles').select('role').eq('user_id','{UID}');
      return (data ?? []).map(r => r.role);
    }}""")

async def main():
    failures = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)

        # --- Case 1: signed-out ---
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        # Establish origin so RPC calls resolve; do NOT sign in.
        await page.goto(BASE, wait_until="domcontentloaded")
        await page.wait_for_load_state("networkidle", timeout=15000)
        signed_out_status = await page.evaluate("""async () => {
          const { supabase } = await import('/src/integrations/supabase/client.ts');
          const { data } = await supabase.auth.getSession();
          return { hasSession: !!data.session };
        }""")
        print("signed-out session:", signed_out_status)
        assert signed_out_status["hasSession"] is False

        for label, mod, name, arg in ENDPOINTS:
            res = await call_fn(page, mod, name, arg)
            err = (res.get("error") or "").lower()
            print(f"  signed-out  {label:26s} → ok={res['ok']}  err={res.get('error')!r}")
            if res["ok"]:
                failures.append(f"signed-out call to {label} unexpectedly succeeded")
                continue
            if "unauthor" not in err and "no authorization" not in err:
                failures.append(f"signed-out {label}: expected Unauthorized, got: {res['error']}")
        await page.screenshot(path=str(SHOTS / "1_signed_out.png"))
        await ctx.close()

        # --- Case 2: signed-in non-admin ---
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        await sign_in(page)
        roles = await get_roles(page)
        print("roles:", roles)
        assert "admin" not in roles, f"precondition failed: {EMAIL} has admin role: {roles}"

        for label, mod, name, arg in ENDPOINTS:
            res = await call_fn(page, mod, name, arg)
            err = (res.get("error") or "").lower()
            print(f"  non-admin   {label:26s} → ok={res['ok']}  err={res.get('error')!r}")
            if res["ok"]:
                failures.append(f"non-admin call to {label} unexpectedly succeeded")
                continue
            if "forbidden" not in err and "admin" not in err:
                failures.append(f"non-admin {label}: expected Forbidden, got: {res['error']}")

        # Post-check: role escalation attempt via updateUserRole must NOT have granted admin.
        roles_after = await get_roles(page)
        print("roles after attempts:", roles_after)
        if "admin" in roles_after:
            failures.append(
                f"SECURITY: non-admin gained admin role via server fn: {roles_after}"
            )
        await page.screenshot(path=str(SHOTS / "2_non_admin.png"))
        await ctx.close()

        await browser.close()

    if failures:
        print("\nFAIL:")
        for f in failures:
            print("  -", f)
        raise SystemExit(1)
    print(f"\nPASS: {len(ENDPOINTS)} admin endpoints reject signed-out AND non-admin callers")

asyncio.run(main())
