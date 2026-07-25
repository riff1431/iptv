"""Verify the AppShell mobile hamburger menu opens/closes and links navigate."""
import asyncio
import json
import os
from pathlib import Path
from playwright.async_api import async_playwright

SCREENSHOTS = Path(__file__).parent / "screenshots" / "mobile_nav"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

BASE = "http://localhost:8080"

# Non-admin session: IPTV link is admin-only and hidden — skip it.
LINKS = [
    ("Home", "/"),
    ("Arena", "/arena"),
    ("Messages", "/messages"),
    ("Wallet", "/wallet"),
    
]


async def restore_session(page, context):
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
    if cookies_json:
        cookies = json.loads(cookies_json)
        for c in cookies:
            c["url"] = BASE
        await context.add_cookies(cookies)
    await page.goto(BASE, wait_until="commit")
    await page.wait_for_load_state("domcontentloaded")
    if storage_key and session_json:
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
        )


async def goto(page, path):
    for attempt in range(3):
        try:
            await page.goto(f"{BASE}{path}", wait_until="commit")
            break
        except Exception:
            if attempt == 2:
                raise
            await asyncio.sleep(0.4)
    await page.wait_for_load_state("domcontentloaded")


async def sheet_is_open(page) -> bool:
    return await page.locator('[role="dialog"][data-state="open"]').count() > 0


async def hide_toasts(page):
    """Sonner toast portals sit above the header and intercept clicks —
    hide them so pointer events reach the hamburger and sheet items."""
    await page.add_style_tag(
        content='[data-sonner-toaster], [aria-label="Notifications alt+T"] { display: none !important; }'
    )


async def open_hamburger(page):
    await hide_toasts(page)
    btn = page.locator('button[aria-label="Open navigation menu"]')
    await btn.wait_for(state="visible", timeout=6000)
    # Give React a beat to hydrate the SheetTrigger before clicking, otherwise
    # the click hits an inert DOM node and Radix never toggles state.
    await asyncio.sleep(0.5)
    await btn.click()
    try:
        await page.locator('[role="dialog"][data-state="open"]').first.wait_for(timeout=3000)
    except Exception:
        await asyncio.sleep(0.6)
        await btn.click()
        await page.locator('[role="dialog"][data-state="open"]').first.wait_for(timeout=4000)


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        # Mobile viewport (< md breakpoint = 768px) so the hamburger renders
        # and desktop nav is hidden.
        # Small viewport so md-breakpoint (768px) hides the desktop nav and
        # shows the hamburger. We keep pointer-based clicks (no is_mobile
        # emulation) — Radix responds to real clicks reliably, and touch
        # emulation adds flakiness without changing the layout under test.
        context = await browser.new_context(
            viewport={"width": 390, "height": 844},
        )
        page = await context.new_page()

        await restore_session(page, context)
        await goto(page, "/")

        failures: list[str] = []

        # 1) Hamburger must be visible on mobile; desktop nav must be hidden.
        hamburger = page.locator('button[aria-label="Open navigation menu"]')
        if not await hamburger.is_visible():
            failures.append("Hamburger button is not visible on mobile (<md)")
        desktop_nav = page.locator('header nav[aria-label="Primary"]').first
        if await desktop_nav.is_visible():
            failures.append("Desktop primary nav should be hidden on mobile")

        # 2) Open + close via X button.
        await open_hamburger(page)
        await page.screenshot(path=str(SCREENSHOTS / "01_opened.png"))
        # shadcn Sheet ships a close button labelled "Close"
        close_btn = page.locator('[role="dialog"][data-state="open"] button:has-text("Close")').first
        if await close_btn.count() == 0:
            # fallback: any button with sr-only Close
            close_btn = page.locator('[role="dialog"][data-state="open"] [aria-label="Close"]').first
        await close_btn.click()
        # Wait for the dialog to be gone or closed
        try:
            await page.wait_for_function(
                "() => !document.querySelector('[role=\"dialog\"][data-state=\"open\"]')",
                timeout=3000,
            )
        except Exception:
            failures.append("Sheet did not close after clicking Close")
        await page.screenshot(path=str(SCREENSHOTS / "02_closed.png"))

        # 3) Open + close via Escape.
        await open_hamburger(page)
        await page.keyboard.press("Escape")
        try:
            await page.wait_for_function(
                "() => !document.querySelector('[role=\"dialog\"][data-state=\"open\"]')",
                timeout=3000,
            )
        except Exception:
            failures.append("Sheet did not close on Escape")

        # 4) Each nav link: open sheet, click link, URL updates, sheet closes.
        for i, (label, expected_path) in enumerate(LINKS, start=10):
            # Start from a route that is NOT the target so we can observe a change.
            start_path = "/wallet" if expected_path == "/" else "/"
            await goto(page, start_path)
            await open_hamburger(page)

            link = page.locator(
                f'[role="dialog"][data-state="open"] nav a:has-text("{label}")'
            ).first
            if await link.count() == 0:
                failures.append(f"{label}: link not found inside mobile sheet")
                await page.screenshot(path=str(SCREENSHOTS / f"{i}_{label}_MISSING.png"))
                continue

            href = await link.get_attribute("href")
            await link.click()

            # URL must match expected
            try:
                await page.wait_for_function(
                    f"() => new URL(location.href).pathname === {json.dumps(expected_path)}",
                    timeout=6000,
                )
            except Exception:
                actual = await page.evaluate("() => location.pathname")
                failures.append(
                    f"{label}: expected {expected_path}, got {actual} (href={href})"
                )
                await page.screenshot(path=str(SCREENSHOTS / f"{i}_{label}_URL_FAIL.png"))
                continue

            # Sheet must auto-close after link click
            try:
                await page.wait_for_function(
                    "() => !document.querySelector('[role=\"dialog\"][data-state=\"open\"]')",
                    timeout=3000,
                )
            except Exception:
                failures.append(f"{label}: sheet did not close after navigation")
                await page.screenshot(path=str(SCREENSHOTS / f"{i}_{label}_STILL_OPEN.png"))
                continue

            await page.screenshot(path=str(SCREENSHOTS / f"{i}_{label}_ok.png"))
            print(f"{label} -> {expected_path}: mobile nav OK")

        await browser.close()

        if failures:
            print("\nFAILURES:")
            for f in failures:
                print(" -", f)
            raise SystemExit(1)

        print("\nMobile hamburger nav works end-to-end.")


asyncio.run(main())
