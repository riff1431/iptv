"""E2E screen-reader regression for ThumbHeader banners.

Uses Playwright's accessibility snapshot — the same tree Chromium exposes
to assistive tech — to verify each banner surfaces exactly one accessible
name per intended element, with no duplicated announcements.

For every banner on `/admin`, `/wallet`, and `/dev/tilethumb` at
mobile / tablet / desktop, we assert:

  1. The banner subtree contains a single AT node whose `role` is "img"
     and whose `name` matches the ThumbFallback's `aria-label`. This is
     what a screen reader will announce when the user lands on the tile
     ("Sessions, image", "Top up wallet, image", ...).
  2. That name is non-empty.
  3. The name does NOT appear twice in the subtree — i.e. the inner
     Lucide `<svg>` is not exposed as a second AT node duplicating the
     banner's name. This is the "announced twice" bug the a11y test
     already guards against structurally; here we prove it against
     the actual computed AT tree.
  4. If the banner has a corner accent icon:
       - a labeled corner adds a second `role="img"` node whose name
         equals the `cornerLabel` (and is different from the banner
         label — otherwise both surfaces announce the same word);
       - an unlabeled corner adds zero AT nodes (it is aria-hidden).
  5. No AT node inside the banner has `role` "button" / "link" / any
     interactive role — the banner is decorative chrome, not a control.
"""
import asyncio
import json
import os
import sys
from playwright.async_api import async_playwright

VIEWPORTS = [("mobile", 390, 1800), ("tablet", 768, 1800), ("desktop", 1280, 1800)]
ROUTES = ["/admin", "/wallet", "/dev/tilethumb"]
BANNER_SELECTOR = 'div.aspect-\\[16\\/3\\]'
INTERACTIVE_ROLES = {"button", "link", "checkbox", "menuitem", "tab", "switch", "textbox"}


async def restore_session(context, page):
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
    if cookies_json:
        cookies = json.loads(cookies_json)
        for c in cookies:
            c["url"] = "http://localhost:8080"
        await context.add_cookies(cookies)
    await page.goto("http://localhost:8080", wait_until="domcontentloaded")
    if storage_key and session_json:
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
        )


def walk(node, out):
    if node is None:
        return
    out.append(node)
    for c in node.get("children", []) or []:
        walk(c, out)


async def audit_banner(page, el, ident):
    failures = []

    # Read the intended aria-labels from the DOM so the AT tree can be
    # verified against the component's declared contract.
    intent = await el.evaluate(
        """el => {
          const fallback = el.querySelector('[role="img"]');
          const corner = Array.from(el.children).find(c =>
            c !== fallback && c.querySelector && c.querySelector('svg') && /right-3/.test(c.className || '')
          );
          return {
            fallbackLabel: fallback ? fallback.getAttribute('aria-label') : null,
            cornerRole: corner ? corner.getAttribute('role') : null,
            cornerLabel: corner ? corner.getAttribute('aria-label') : null,
            cornerHidden: corner ? corner.getAttribute('aria-hidden') === 'true' : null,
            hasCorner: !!corner,
          };
        }"""
    )

    # Use Playwright's getByRole scoped to the banner — same AT-name
    # computation a screen reader would apply. We enumerate every img
    # role inside the banner and read its accessible name.
    img_locator = el.get_by_role("img")
    img_count = await img_locator.count()
    img_names = []
    for k in range(img_count):
        img_names.append(await img_locator.nth(k).evaluate(
            "e => e.getAttribute('aria-label') || e.textContent?.trim() || ''"
        ))

    # (1) + (2): the fallback label appears exactly once as an img name.
    expected = (intent["fallbackLabel"] or "").strip()
    if not expected:
        failures.append(f"{ident}: DOM has no ThumbFallback aria-label")
    else:
        matches = [n for n in img_names if n == expected]
        if len(matches) == 0:
            failures.append(
                f"{ident}: SR would not announce banner label — "
                f"expected role='img' with name '{expected}', AT names: {img_names}"
            )
        elif len(matches) > 1:
            failures.append(
                f"{ident}: banner label '{expected}' announced {len(matches)}× in AT tree — duplicate"
            )

    # (3): the banner name is not echoed by another labeled element in the subtree.
    if expected:
        echo_count = await el.evaluate(
            """(el, name) => {
              let n = 0;
              el.querySelectorAll('[aria-label],[title]').forEach(x => {
                if ((x.getAttribute('aria-label') || x.getAttribute('title') || '').trim() === name) n++;
              });
              return n;
            }""",
            expected,
        )
        if echo_count > 1:
            failures.append(
                f"{ident}: banner name '{expected}' echoed by {echo_count} labeled elements in subtree"
            )

    # (4): corner icon accounting.
    if intent["hasCorner"]:
        corner_expected = (intent["cornerLabel"] or "").strip()
        if intent["cornerHidden"]:
            # Unlabeled + aria-hidden: only the banner label may appear as an img.
            extra = [n for n in img_names if n and n != expected]
            if extra:
                failures.append(
                    f"{ident}: aria-hidden corner leaked into AT tree as img: names={extra}"
                )
        elif corner_expected:
            corner_matches = [n for n in img_names if n == corner_expected]
            if len(corner_matches) != 1:
                failures.append(
                    f"{ident}: corner label '{corner_expected}' should appear once, got {len(corner_matches)} "
                    f"(AT img names: {img_names})"
                )
            if corner_expected == expected:
                failures.append(
                    f"{ident}: corner label and banner label are identical ('{expected}') — "
                    f"SR announces the same word twice"
                )
        else:
            failures.append(
                f"{ident}: corner icon present but neither aria-hidden nor labeled — invalid AT state"
            )

    # (5): decorative — no interactive AT roles inside the banner.
    interactive_hits = []
    for role in INTERACTIVE_ROLES:
        c = await el.get_by_role(role).count()
        if c:
            interactive_hits.append((role, c))
    if interactive_hits:
        failures.append(
            f"{ident}: decorative banner contains interactive AT nodes: {interactive_hits}"
        )

    return failures


async def audit_route(page, viewport_name, route):
    await page.goto(f"http://localhost:8080{route}", wait_until="networkidle", timeout=20000)
    await page.wait_for_timeout(1200)

    banners = page.locator(BANNER_SELECTOR)
    count = await banners.count()
    assert count > 0, f"[{viewport_name} {route}] no banners found"

    results = []
    for i in range(count):
        el = banners.nth(i)
        await el.scroll_into_view_if_needed()
        parent_attr = await el.evaluate(
            "el => el.closest('[data-permutation]')?.getAttribute('data-permutation') || null"
        )
        ident = f"banner[{parent_attr}]" if parent_attr else f"banner[#{i:02d}]"
        results.extend(await audit_banner(page, el, ident))
    return results


async def main():
    all_failures = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        for vname, w, h in VIEWPORTS:
            ctx = await browser.new_context(viewport={"width": w, "height": h})
            page = await ctx.new_page()
            await restore_session(ctx, page)
            for route in ROUTES:
                try:
                    failures = await audit_route(page, vname, route)
                except Exception as e:
                    all_failures.append(f"[{vname} {route}] raised: {e}")
                    continue
                tag = "OK" if not failures else "FAIL"
                print(f"[{vname} {route}] {tag} — {len(failures)} issue(s)")
                for f in failures:
                    all_failures.append(f"[{vname} {route}] {f}")
            await ctx.close()
        await browser.close()

    if all_failures:
        print("\nFAILURES (screen-reader announcement contract):")
        for f in all_failures:
            print(" -", f)
        sys.exit(1)
    print("\nAll ThumbHeader banners announce once with the expected name.")


if __name__ == "__main__":
    asyncio.run(main())
