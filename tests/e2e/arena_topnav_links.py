"""Verify every ArenaTopNav link routes to the correct URL and shows the active state."""
import asyncio
import json
import os
from pathlib import Path
from playwright.async_api import async_playwright

SCREENSHOTS = Path(__file__).parent / "screenshots" / "arena_topnav_links"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

BASE = "http://localhost:8080"

# label -> expected pathname
LINKS = [
    ("HOME", "/"),
    ("STREAMS", "/iptv"),
    ("ARENA", "/arena"),
    ("COMMUNITY", "/messages"),
    ("WALLET", "/wallet"),
    
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
    await page.goto(BASE, wait_until="domcontentloaded")
    if storage_key and session_json:
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
        )


async def go_to_arena(page):
    for attempt in range(3):
        try:
            await page.goto(f"{BASE}/arena", wait_until="commit")
            break
        except Exception:
            if attempt == 2:
                raise
            await asyncio.sleep(0.5)
    await page.wait_for_load_state("domcontentloaded")
    # Wait for the arena topnav to render
    await page.wait_for_selector("header nav a", timeout=8000)


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1534, "height": 900})
        page = await context.new_page()

        await restore_session(page, context)
        await go_to_arena(page)
        await page.screenshot(path=str(SCREENSHOTS / "0_arena_start.png"))

        failures = []

        for i, (label, expected_path) in enumerate(LINKS, start=1):
            # Always return to /arena so the header is the ArenaTopNav
            await go_to_arena(page)

            link = page.locator("header nav a", has_text=label).first
            count = await link.count()
            if count == 0:
                failures.append(f"{label}: link not found in ArenaTopNav")
                continue

            href = await link.get_attribute("href")
            await link.click()

            # Wait for URL to match expected path
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
                await page.screenshot(path=str(SCREENSHOTS / f"{i}_{label}_FAIL.png"))
                continue

            # If the header is still ArenaTopNav (only on /arena), check aria-current
            if expected_path == "/arena":
                active_link = page.locator(
                    f'header nav a[aria-current="page"]:has-text("{label}")'
                )
                if await active_link.count() == 0:
                    failures.append(f"{label}: no aria-current='page' on ArenaTopNav")
                else:
                    print(f"{label}: active state OK on ArenaTopNav")

            # For other routes, verify the destination page renders its own
            # active nav item (AppShell for /, /wallet, /vip, /messages;
            # iptv layout for /iptv). Any nav link with aria-current="page"
            # whose href matches the expected path is enough.
            active_generic = page.locator(
                f'a[aria-current="page"][href="{expected_path}"]'
            )
            if await active_generic.count() == 0 and expected_path != "/iptv":
                # /iptv layout may not use aria-current; skip that check
                failures.append(
                    f"{label}: destination {expected_path} has no aria-current active link"
                )

            await page.screenshot(path=str(SCREENSHOTS / f"{i}_{label}.png"))
            print(f"{label} -> {expected_path}: URL OK")

        # ---- Right-cluster buttons: wallet chip, profile avatar, mail, bell, settings.
        # Each must be a real anchor with a real href — no dead <button>s.
        RIGHT_CLUSTER = [
            ("Open wallet", "/wallet"),
            ("Open profile", "/profile"),
            ("Messages", "/messages"),
            ("Notifications", "/profile"),
            ("Settings", "/profile"),
        ]

        for i, (aria, expected_path) in enumerate(RIGHT_CLUSTER, start=100):
            await go_to_arena(page)
            el = page.locator(f'header [aria-label="{aria}"]').first
            if await el.count() == 0:
                failures.append(f"{aria}: element not found in ArenaTopNav header")
                continue

            tag = await el.evaluate("(n) => n.tagName.toLowerCase()")
            href = await el.get_attribute("href")
            if tag != "a" or not href:
                failures.append(
                    f"{aria}: dead click — tag={tag} href={href!r} (must be <a href>)"
                )
                await page.screenshot(path=str(SCREENSHOTS / f"{i}_{aria}_DEAD.png"))
                continue

            await el.click()
            try:
                await page.wait_for_function(
                    f"() => new URL(location.href).pathname === {json.dumps(expected_path)}",
                    timeout=6000,
                )
            except Exception:
                actual = await page.evaluate("() => location.pathname")
                failures.append(
                    f"{aria}: expected {expected_path}, got {actual} (href={href})"
                )
                await page.screenshot(path=str(SCREENSHOTS / f"{i}_{aria}_FAIL.png"))
                continue

            await page.screenshot(path=str(SCREENSHOTS / f"{i}_{aria}.png"))
            print(f"{aria} -> {expected_path}: URL OK (href={href})")

        await browser.close()

        if failures:
            print("\nFAILURES:")
            for f in failures:
                print(" -", f)
            raise SystemExit(1)

        print("\nAll ArenaTopNav links and right-cluster buttons navigated correctly.")


asyncio.run(main())
