"""
End-to-end test: when the client's direct M3U fetch fails (simulating a
CORS-blocked provider), useIptvPlaylist must transparently fall back to the
server-side proxy at /api/public/iptv/playlist and still load channels.

We simulate CORS blockage by aborting the direct request via page.route,
which is what the browser does for real CORS-denied responses from the
Fetch API's perspective (the promise rejects with a TypeError).
"""

import asyncio
import json
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.async_api import async_playwright

SCREENSHOTS = Path(__file__).parent / "screenshots" / "iptv_proxy_fallback"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

# A plausible provider URL that would be CORS-blocked in a real browser.
# We never actually contact it — page.route aborts the direct call, and the
# proxy leg is stubbed to return a small canned M3U.
PROVIDER_URL = "https://blocked.example.com/playlist.m3u"

CANNED_M3U = (
    "#EXTM3U\n"
    '#EXTINF:-1 tvg-id="ch1" tvg-logo="https://example.com/a.png" '
    'group-title="News",Alpha News\n'
    "https://cdn.example.com/alpha.m3u8\n"
    '#EXTINF:-1 tvg-id="ch2" group-title="Sports",Beta Sports\n'
    "https://cdn.example.com/beta.m3u8\n"
)


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        direct_attempts: list[str] = []
        proxy_attempts: list[str] = []

        async def handle_direct(route):
            direct_attempts.append(route.request.url)
            # Simulate the browser's behaviour when the response is CORS-denied:
            # the fetch() promise rejects with a network error.
            await route.abort("failed")

        async def handle_proxy(route):
            proxy_attempts.append(route.request.url)
            qs = parse_qs(urlparse(route.request.url).query)
            forwarded = qs.get("url", [""])[0]
            assert forwarded == PROVIDER_URL, (
                f"proxy forwarded wrong URL: {forwarded!r} != {PROVIDER_URL!r}"
            )
            await route.fulfill(
                status=200,
                headers={
                    "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
                    "Cache-Control": "public, max-age=60",
                },
                body=CANNED_M3U,
            )

        await page.route(PROVIDER_URL, handle_direct)
        await page.route("**/api/public/iptv/playlist?**", handle_proxy)

        # Seed the persisted playlist URL so /iptv loads our provider immediately.
        await page.goto("http://localhost:8080", wait_until="domcontentloaded")
        await page.evaluate(
            f"window.localStorage.setItem('iptv.playlistUrl', {json.dumps(PROVIDER_URL)})"
        )

        try:
            await page.goto("http://localhost:8080/iptv", wait_until="load")
        except Exception as e:
            print("goto note:", e); await page.wait_for_load_state("domcontentloaded")

        # Wait for either a channel button to appear or an error surface.
        try:
            await page.get_by_text("Alpha News").first.wait_for(timeout=15_000)
        except Exception:
            print("current URL:", page.url)
            print("body preview:", (await page.locator("body").inner_text())[:600])
            await page.screenshot(path=str(SCREENSHOTS / "fail.png"))
            raise
        await page.screenshot(path=str(SCREENSHOTS / "1_iptv_loaded.png"))

        assert direct_attempts, "direct fetch to provider was never attempted"
        assert proxy_attempts, "proxy fallback was never invoked after direct failure"
        print(f"direct attempts: {len(direct_attempts)}  proxy attempts: {len(proxy_attempts)}")

        # The channel list must contain both channels parsed from the proxied body.
        page_text = await page.locator("body").inner_text()
        assert "Alpha News" in page_text, f"Alpha News missing in page: {page_text[:400]}"
        assert "Beta Sports" in page_text, f"Beta Sports missing in page: {page_text[:400]}"

        # No error surface should be visible.
        alerts = await page.locator("[role=alert]").all_inner_texts()
        blocking = [a for a in alerts if "Could not load" in a or "failed" in a.lower()]
        assert not blocking, f"error surface visible despite proxy success: {blocking}"

        print("OK — direct fetch aborted, proxy fallback served M3U, channels rendered.")

        await browser.close()


asyncio.run(main())
