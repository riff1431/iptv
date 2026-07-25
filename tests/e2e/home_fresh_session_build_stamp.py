"""E2E: fresh-session post-deploy homepage smoke test.

Simulates a returning visitor after a deploy by:
  1. Launching a brand-new browser context (no cookies, no cache, no storage).
  2. Loading `/` and asserting the latest UI shell rendered.
  3. Reading the hidden BUILD_ID stamp (meta[x-build-id] + [data-build-id])
     and printing it so CI logs record which build was verified.
  4. Asserting cache-busting meta headers are present (no-cache / no-store).
  5. Reloading and confirming the BUILD_ID is stable within the same server
     process (the stamp only changes across server starts / deploys).
  6. Verifying shimmer skeleton state renders during data fetch:
     - The `shimmer` utility is defined (::after content + animation).
     - Skeleton placeholders using `.shimmer` appear on first paint.
     - Under prefers-reduced-motion: reduce, the shimmer animation is hidden.

Exits non-zero on any failure with screenshots under
/tmp/browser/home_fresh_session_build_stamp/screenshots/.
"""
import asyncio
import re
import sys
from pathlib import Path
from playwright.async_api import async_playwright

SCREENSHOTS = Path("/tmp/browser/home_fresh_session_build_stamp/screenshots")
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

BASE = "http://localhost:8080"

failures: list[str] = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        failures.append(msg)
        print(f"FAIL: {msg}")
    else:
        print(f"ok:   {msg}")


async def new_fresh_context(pw, **kwargs):
    """Fresh context = no storage state, no shared cache."""
    browser = await pw.chromium.launch(headless=True)
    context = await browser.new_context(
        viewport={"width": 1280, "height": 1800},
        storage_state=None,
        **kwargs,
    )
    return browser, context


async def run() -> None:
    async with async_playwright() as pw:
        # --- Session 1: fresh browser, first load after "deploy" ---
        browser, context = await new_fresh_context(pw)
        page = await context.new_page()

        await page.goto(f"{BASE}/", wait_until="domcontentloaded")
        await page.wait_for_load_state("networkidle")
        await page.screenshot(path=str(SCREENSHOTS / "1_first_paint.png"))


        # 1) Homepage shell rendered (root has an <h1> or main landmark).
        main_count = await page.locator("main, [role='main']").count()
        check(main_count >= 1, f"homepage renders a <main> landmark (got {main_count})")

        # 2) BUILD_ID stamp: meta tag.
        build_id_meta = await page.evaluate(
            "document.querySelector('meta[name=\"x-build-id\"]')?.content ?? null"
        )
        check(
            build_id_meta is not None and re.fullmatch(r"\d+", build_id_meta or "") is not None,
            f"meta[name=x-build-id] present and numeric (got {build_id_meta!r})",
        )
        print(f"info: BUILD_ID (meta) = {build_id_meta}")

        # 3) BUILD_ID stamp: hidden body div.
        build_id_body = await page.evaluate(
            "document.querySelector('[data-build-id]')?.dataset?.buildId ?? null"
        )
        check(
            build_id_body == build_id_meta,
            f"body data-build-id matches meta ({build_id_body!r} vs {build_id_meta!r})",
        )

        # 4) Hidden stamp is not visible to the user.
        stamp_visible = await page.evaluate(
            """() => {
                const el = document.querySelector('[data-build-id]');
                if (!el) return true;
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
            }"""
        )
        check(not stamp_visible, "body build stamp is hidden from users")

        # 5) Cache-busting meta headers present.
        cache_control = await page.evaluate(
            "document.querySelector('meta[http-equiv=\"Cache-Control\" i]')?.content ?? null"
        )
        check(
            cache_control is not None and "no-cache" in cache_control.lower(),
            f"Cache-Control meta enforces no-cache (got {cache_control!r})",
        )

        # 6) Favicon carries a ?v= cache-buster.
        favicon_href = await page.evaluate(
            "document.querySelector('link[rel=\"icon\"]')?.href ?? null"
        )
        check(
            favicon_href is not None and "favicon.ico?v=" in (favicon_href or ""),
            f"favicon link includes ?v= cache-buster (got {favicon_href!r})",
        )

        # 7) Shimmer utility is compiled correctly (from styles.css).
        shimmer_css = await page.evaluate(
            """() => {
                const el = document.createElement('div');
                el.className = 'shimmer';
                document.body.appendChild(el);
                const cs = getComputedStyle(el);
                const after = getComputedStyle(el, '::after');
                const out = {
                    position: cs.position,
                    overflow: cs.overflow,
                    afterContent: after.content,
                    afterAnimation: after.animationName,
                };
                el.remove();
                return out;
            }"""
        )
        check(
            shimmer_css["position"] == "relative",
            f".shimmer position is relative (got {shimmer_css['position']!r})",
        )
        check(
            shimmer_css["overflow"] == "hidden",
            f".shimmer overflow is hidden (got {shimmer_css['overflow']!r})",
        )
        check(
            shimmer_css["afterContent"] not in (None, "", "none"),
            f".shimmer::after has content (got {shimmer_css['afterContent']!r})",
        )
        check(
            "shimmer-sweep" in (shimmer_css["afterAnimation"] or ""),
            f".shimmer::after runs shimmer-sweep animation (got {shimmer_css['afterAnimation']!r})",
        )

        # 8) Shimmer skeleton state on a client-side navigation to `/`.
        # The initial HTML delivery is SSR, so the loader has already
        # resolved by the time the browser sees markup — the shimmer only
        # appears on client-side route transitions. Simulate one by
        # navigating away, throttling data calls, then navigating back
        # to `/` via a real <Link> (History API navigation).
        async def slow_data(route):
            await asyncio.sleep(1.5)
            await route.continue_()

        await page.goto(f"{BASE}/forbidden", wait_until="networkidle")
        await context.route("**/_serverFn/**", slow_data)

        # Trigger a soft navigation back to `/` via the History API so
        # TanStack Router runs its loader (and shows pendingComponent).
        await page.evaluate("window.history.pushState({}, '', '/')")
        await page.evaluate("window.dispatchEvent(new PopStateEvent('popstate'))")
        await page.wait_for_timeout(250)

        shimmer_on_transition = await page.locator(".shimmer").count()
        await page.screenshot(path=str(SCREENSHOTS / "2_client_nav_shimmer.png"))
        check(
            shimmer_on_transition >= 1,
            f"shimmer skeletons render during client-side loader pending "
            f"(got {shimmer_on_transition})",
        )

        await context.unroute("**/_serverFn/**")
        await page.wait_for_load_state("networkidle")
        await page.screenshot(path=str(SCREENSHOTS / "3_after_hydrate.png"))
        await context.close()
        await browser.close()


        # --- Session 2: reload confirms BUILD_ID is stable per server process ---
        browser2, context2 = await new_fresh_context(pw)
        page2 = await context2.new_page()
        await page2.goto(f"{BASE}/", wait_until="networkidle")
        build_id_meta_2 = await page2.evaluate(
            "document.querySelector('meta[name=\"x-build-id\"]')?.content ?? null"
        )
        check(
            build_id_meta_2 == build_id_meta,
            f"BUILD_ID is stable across fresh sessions in one server "
            f"(session1={build_id_meta!r} vs session2={build_id_meta_2!r})",
        )
        await context2.close()
        await browser2.close()

        # --- Session 3: reduced-motion hides shimmer animation ---
        browser3 = await pw.chromium.launch(headless=True)
        context3 = await browser3.new_context(
            viewport={"width": 1280, "height": 1800},
            reduced_motion="reduce",
            storage_state=None,
        )
        page3 = await context3.new_page()
        await page3.goto(f"{BASE}/", wait_until="domcontentloaded")
        rm_display = await page3.evaluate(
            """() => {
                const el = document.createElement('div');
                el.className = 'shimmer';
                document.body.appendChild(el);
                const after = getComputedStyle(el, '::after');
                const out = { display: after.display, animation: after.animationName };
                el.remove();
                return out;
            }"""
        )
        check(
            rm_display["display"] == "none" or rm_display["animation"] in ("none", ""),
            f"shimmer animation suppressed under reduced-motion "
            f"(display={rm_display['display']!r}, animation={rm_display['animation']!r})",
        )
        await page3.screenshot(path=str(SCREENSHOTS / "3_reduced_motion.png"))
        await context3.close()
        await browser3.close()


asyncio.run(run())

if failures:
    print(f"\n{len(failures)} failure(s):")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("\nAll fresh-session / build-stamp checks passed.")
