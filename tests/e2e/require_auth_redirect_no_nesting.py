"""E2E: RequireAuth builds correct redirect targets for protected routes and
never produces a nested `?redirect=?redirect=…` chain.

We inspect the full navigation history (not just the final URL) because
downstream code on `/auth` may normalize params after RequireAuth fires;
what we're validating here is the URL RequireAuth *itself* pushes.

Scenarios (all signed-out):
1. /dashboard → history contains /auth?redirect=%2Fdashboard.
2. /dashboard?tab=history&sort=desc#tx-42 → redirect target preserves
   pathname + search + hash.
3. Landing on /auth?redirect=%2Fdashboard first, then hitting /profile
   from the same tab, never stacks `redirect=` inside another `redirect=`.
4. A protected URL with a huge hash produces a redirect target capped
   at MAX_REDIRECT_LENGTH (512 chars).
5. /auth visited directly stays at /auth with no self-added redirect param.
"""
import asyncio
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote
from playwright.async_api import async_playwright

SHOTS = Path("/tmp/browser/require-auth-redirect/shots")
SHOTS.mkdir(parents=True, exist_ok=True)
BASE = "http://localhost:8080"
MAX_REDIRECT_LENGTH = 512


def redirect_param(url: str) -> str | None:
    q = parse_qs(urlparse(url).query)
    val = q.get("redirect", [None])[0]
    return unquote(val) if val else None


def track_history(page):
    """Attach a nav-history recorder that survives the whole test case."""
    urls: list[str] = []

    def on_nav(frame):
        if frame == page.main_frame:
            urls.append(frame.url)

    page.on("framenavigated", on_nav)
    return urls


def assert_no_nested_redirect(urls: list[str]):
    """No URL in the history may stack redirect params (`?redirect=…?redirect=…`)."""
    for u in urls:
        # Raw-URL check: only one `redirect=` occurrence per URL.
        assert u.count("redirect=") <= 1, f"stacked redirect= params in {u!r}"
        # Decoded-value check: the redirect target itself must not embed another.
        rp = redirect_param(u)
        if rp:
            assert "redirect=" not in rp, f"nested redirect inside target: {rp!r} (url={u})"


async def wait_on_auth(page, timeout=10000):
    await page.wait_for_url(lambda u: "/auth" in urlparse(u).path, timeout=timeout)


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)

        # --- Case 1: /dashboard → /auth?redirect=%2Fdashboard in history ---
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        urls = track_history(page)
        await page.goto(f"{BASE}/dashboard", wait_until="domcontentloaded")
        await wait_on_auth(page)
        await page.wait_for_timeout(500)  # let any follow-up nav flush
        await page.screenshot(path=str(SHOTS / "1_dashboard.png"))
        print("case1 history:", urls)
        assert any("/auth" in urlparse(u).path for u in urls), f"no /auth nav: {urls}"
        auth_navs = [u for u in urls if urlparse(u).path == "/auth"]
        assert any(redirect_param(u) == "/dashboard" for u in auth_navs), (
            f"RequireAuth did not push redirect=/dashboard; auth navs={auth_navs}"
        )
        assert_no_nested_redirect(urls)
        await ctx.close()

        # --- Case 2: preserves search + hash in RequireAuth's redirect target ---
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        urls = track_history(page)
        await page.goto(
            f"{BASE}/dashboard?tab=history&sort=desc#tx-42",
            wait_until="domcontentloaded",
        )
        await wait_on_auth(page)
        await page.wait_for_timeout(500)
        await page.screenshot(path=str(SHOTS / "2_dashboard_search_hash.png"))
        print("case2 history:", urls)
        targets = [redirect_param(u) for u in urls if urlparse(u).path == "/auth"]
        targets = [t for t in targets if t]
        assert targets, f"no RequireAuth-authored redirect target found: {urls}"
        chosen = next((t for t in targets if t.startswith("/dashboard")), targets[0])
        assert chosen.startswith("/dashboard"), chosen
        assert "tab=history" in chosen and "sort=desc" in chosen, (
            f"search dropped: {chosen}"
        )
        assert "#tx-42" in chosen, f"hash dropped: {chosen}"
        assert_no_nested_redirect(urls)
        await ctx.close()

        # --- Case 3: no nesting when arriving via /auth?redirect=… first ---
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        urls = track_history(page)
        await page.goto(
            f"{BASE}/auth?redirect=%2Fdashboard", wait_until="domcontentloaded"
        )
        await page.wait_for_load_state("networkidle", timeout=8000)
        await page.goto(f"{BASE}/profile", wait_until="domcontentloaded")
        await wait_on_auth(page)
        await page.wait_for_timeout(500)
        await page.screenshot(path=str(SHOTS / "3_no_nesting.png"))
        print("case3 history:", urls)
        # The critical invariant: no URL ever contains a nested redirect chain.
        assert_no_nested_redirect(urls)
        # And RequireAuth, seeing the current URL already carries `redirect=`,
        # should fall back to "/" instead of chaining — so at least one /auth
        # visit in the history should have no redirect param at all.
        assert any(
            urlparse(u).path == "/auth" and redirect_param(u) is None for u in urls
        ), f"expected a RequireAuth fallback to /auth without redirect param: {urls}"
        await ctx.close()

        # --- Case 4: very long hash gets capped in the redirect target ---
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        urls = track_history(page)
        long_hash = "a" * 1000
        await page.goto(f"{BASE}/dashboard#{long_hash}", wait_until="domcontentloaded")
        await wait_on_auth(page)
        await page.wait_for_timeout(500)
        print("case4 history sizes:", [len(u) for u in urls])
        targets = [
            redirect_param(u) for u in urls if urlparse(u).path == "/auth"
        ]
        targets = [t for t in targets if t]
        assert targets, f"no redirect param produced: {urls}"
        for t in targets:
            assert len(t) <= MAX_REDIRECT_LENGTH, (
                f"redirect target not capped: len={len(t)} target={t[:80]}…"
            )
        assert_no_nested_redirect(urls)
        await ctx.close()

        # --- Case 5: /auth visited directly, no self-added redirect param ---
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        urls = track_history(page)
        await page.goto(f"{BASE}/auth", wait_until="domcontentloaded")
        await page.wait_for_load_state("networkidle", timeout=8000)
        await page.wait_for_timeout(500)
        print("case5 history:", urls)
        assert urlparse(page.url).path == "/auth", page.url
        assert redirect_param(page.url) is None, (
            f"/auth added its own redirect param: {page.url}"
        )
        assert_no_nested_redirect(urls)
        await ctx.close()

        await browser.close()

    print(
        "\nPASS: RequireAuth authors correct redirect targets, preserves URL parts, "
        "caps length, and never nests redirect chains."
    )


asyncio.run(main())
