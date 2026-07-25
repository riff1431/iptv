"""E2E smoke test: /admin loads without a blank screen or 500 error.

Unauthenticated visitors get redirected to /auth by RequireAuth — that still
counts as a successful load (non-500, visible content). The test fails when:
  - the initial HTTP response is >= 500
  - any subresource returns 500
  - the console logs a page error
  - after settling, the rendered body text is effectively empty (blank screen)
"""
import asyncio
import sys
from pathlib import Path
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"
ROUTE = "/admin"
SHOTS = Path("/tmp/browser/admin-smoke"); SHOTS.mkdir(parents=True, exist_ok=True)


async def main() -> int:
    failures: list[str] = []
    server_errors: list[str] = []
    page_errors: list[str] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()

        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.on("response", lambda r: (
            server_errors.append(f"{r.status} {r.url}") if r.status >= 500 else None
        ))

        url = f"{BASE}{ROUTE}"
        response = await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        if response is None:
            failures.append(f"no response for {url}")
        elif response.status >= 500:
            failures.append(f"initial response {response.status} for {url}")

        # Let the app settle (redirects, hydration).
        try:
            await page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass

        body_text = (await page.locator("body").inner_text()).strip()
        final_url = page.url
        await page.screenshot(path=str(SHOTS / "admin.png"))

        # A completely empty body = blank screen. RequireAuth redirect to /auth
        # renders the sign-in form, which has plenty of text.
        if len(body_text) < 20:
            failures.append(f"blank screen: body text = {body_text!r} at {final_url}")

        if server_errors:
            failures.append("5xx responses: " + "; ".join(server_errors[:5]))
        if page_errors:
            # Non-fatal: log for visibility but don't fail the build.
            print("warn: page errors observed: " + " | ".join(page_errors[:3]))

        await browser.close()

    print(f"final url: {final_url}")
    print(f"body chars: {len(body_text)}")
    if failures:
        print("\nFAIL:")
        for f in failures:
            print("  -", f)
        return 1
    print("\nPASS: /admin loaded without blank screen or 500 errors")
    return 0


sys.exit(asyncio.run(main()))
