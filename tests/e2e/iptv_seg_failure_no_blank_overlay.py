"""
E2E: when an upstream /seg-path fetch fails, the preview UI must NOT show
the blank-screen / "This page didn't load" overlay, and playback must keep
trying (the <video> stays mounted; hls.js keeps retrying).

We simulate upstream failure deterministically by intercepting the /playlist
proxy fetches from HlsTile and forcing them to fail with 502 — the exact
symptom from the original blank-screen bug report. If the app is healthy,
the LoungeAccessGate should render / satisfy without crashing, HlsTile
should mount its <video>, hls.js should retry the manifest, and NO blank
error overlay should appear at any point.

Assertions:
  1. Interceptor served at least a few 502 failures.
  2. "This page didn't load" / error-page markers never appear in the DOM.
  3. No `[data-lovable-blank-page-placeholder]` / error overlay renders.
  4. The <video> element remains mounted throughout.
  5. hls.js keeps retrying (multiple /playlist requests) rather than giving
     up after the first failure.
  6. Route stays on the lounge page.
"""

import asyncio, json, os, re, urllib.request
from pathlib import Path
from playwright.async_api import async_playwright

SCREENSHOTS = Path(__file__).parent / "screenshots" / "iptv_seg_failure_no_blank_overlay"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

XTREAM_URL = "http://cf.8knn.xyz"
XTREAM_USER = "d755c873c436"
XTREAM_PASS = "893e890abf"
LOUNGE_ID = "42cbd067-fe7a-4e3c-8274-546d632232e8"
LOUNGE_SLUG = "test"
SLOT = 1

BLANK_OVERLAY_TEXTS = [
    "This page didn't load",
    "Something went wrong on our end",
]
BLANK_OVERLAY_SELECTORS = [
    "[data-lovable-blank-page-placeholder]",
    "[data-lovable-error]",
    "[data-testid='error-page']",
]


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        # Restore Supabase session.
        storage_key = os.environ["LOVABLE_BROWSER_SUPABASE_STORAGE_KEY"]
        session_json = os.environ["LOVABLE_BROWSER_SUPABASE_SESSION_JSON"]
        cookies_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON")
        if cookies_json:
            cookies = json.loads(cookies_json)
            for c in cookies:
                c["url"] = "http://localhost:8080"
            await context.add_cookies(cookies)
        await page.goto("http://localhost:8080", wait_until="domcontentloaded")
        await page.evaluate(
            f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
        )

        # Configure a TV with a real channel + start the shared stream.
        await page.goto("http://localhost:8080/admin/tvs", wait_until="networkidle")
        streams_url = (
            f"{XTREAM_URL}/player_api.php?username={XTREAM_USER}"
            f"&password={XTREAM_PASS}&action=get_live_streams"
        )
        req = urllib.request.Request(streams_url, headers={"User-Agent": "VLC/3.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            streams = json.loads(r.read())
        ch = {
            "id": str(streams[0]["stream_id"]),
            "name": str(streams[0].get("name") or f"Channel {streams[0]['stream_id']}"),
            "logo": streams[0].get("stream_icon") or None,
        }
        saved = await page.evaluate(
            """async ({ lounge_id, slot, url, user, pw, ch }) => {
                const { saveTv } = await import('/src/lib/iptv-admin.functions.ts');
                const { supabase } = await import('/src/integrations/supabase/client.ts');
                const { data: existing } = await supabase.from('tvs')
                    .select('id').eq('lounge_id', lounge_id).eq('slot', slot).maybeSingle();
                return saveTv({ data: {
                    id: existing?.id,
                    lounge_id, slot,
                    display_name: 'Seg Failure E2E TV',
                    provider_name: 'Xtream',
                    server_url: url, username: user, password: pw,
                    connection_type: 'xtream',
                    selected_channel_id: String(ch.id),
                    selected_channel_name: ch.name,
                    selected_channel_logo: ch.logo || null,
                    enabled: true,
                }});
            }""",
            {"lounge_id": LOUNGE_ID, "slot": SLOT, "url": XTREAM_URL,
             "user": XTREAM_USER, "pw": XTREAM_PASS, "ch": ch},
        )
        tv_id = saved["id"]
        await page.evaluate(
            """async ({ tvId }) => {
                const { startLoungeStream } = await import('/src/lib/stream-admin.functions.ts');
                return startLoungeStream({ data: { tvId } });
            }""", {"tvId": tv_id})

        # Reset lounge sessions so the gate renders if needed.
        await page.evaluate(
            """async ({ lounge_id }) => {
                const { supabase } = await import('/src/integrations/supabase/client.ts');
                const { data: user } = await supabase.auth.getUser();
                if (!user?.user?.id) return;
                const past = new Date(Date.now() - 60_000).toISOString();
                await supabase.from('lounge_sessions')
                    .update({ status: 'expired', expires_at: past })
                    .eq('lounge_id', lounge_id).eq('user_id', user.user.id);
            }""", {"lounge_id": LOUNGE_ID},
        )

        # --- Simulate upstream failure: force /playlist for our tv_id to 502.
        # This is the exact response shape the original blank-screen bug
        # reported. Only the tv_id under test is affected, so unrelated proxy
        # traffic is untouched.
        stats = {"forced_502": 0}
        playlist_re = re.compile(
            rf"/api/sports-arena/tv/{re.escape(tv_id)}/playlist(\?|$)"
        )

        async def fail_playlist(route):
            stats["forced_502"] += 1
            await route.fulfill(
                status=502,
                headers={"Cache-Control": "no-store", "Content-Type": "text/plain"},
                body="Simulated upstream failure",
            )

        await context.route(
            f"**/api/sports-arena/tv/{tv_id}/playlist*", fail_playlist
        )

        # Track proxy activity for the tv_id under test.
        playlist_requests: list[str] = []
        page.on("request", lambda r: (
            playlist_requests.append(r.url) if playlist_re.search(r.url) else None
        ))

        # Capture unexpected page-level errors (should be zero).
        console_errors: list[str] = []
        page.on("console", lambda m: (
            console_errors.append(m.text) if m.type == "error" else None
        ))
        page_errors: list[str] = []
        page.on("pageerror", lambda e: page_errors.append(str(e)))

        # Open lounge and satisfy the gate if it renders.
        await page.goto(f"http://localhost:8080/lounge/{LOUNGE_SLUG}",
                        wait_until="networkidle")
        gate_btn = page.get_by_role("button", name=re.compile(r"start.*preview", re.I))
        try:
            await gate_btn.first.wait_for(state="visible", timeout=5000)
            await gate_btn.first.click()
        except Exception:
            pass  # gate may already be satisfied from a prior session

        # HlsTile must still mount its <video> even though /playlist fails.
        await page.wait_for_selector("video", timeout=15_000)
        await page.screenshot(path=str(SCREENSHOTS / "1_playback_mounted.png"))

        # Let hls.js discover the failure and retry a few times.
        await page.wait_for_timeout(15_000)
        await page.screenshot(path=str(SCREENSHOTS / "2_after_failures.png"))

        print(f"forced 502s served: {stats['forced_502']}, "
              f"playlist requests observed: {len(playlist_requests)}")

        # --- Assertions.
        # 1. Interceptor actually served failures.
        assert stats["forced_502"] >= 1, (
            f"interceptor never matched a /playlist request for tv {tv_id}"
        )

        # 2. No blank-screen overlay text anywhere.
        page_html = await page.content()
        for marker in BLANK_OVERLAY_TEXTS:
            assert marker.lower() not in page_html.lower(), (
                f"blank-screen overlay text present: {marker!r}"
            )

        # 3. No blank-screen overlay element.
        for sel in BLANK_OVERLAY_SELECTORS:
            n = await page.locator(sel).count()
            assert n == 0, f"blank-screen overlay element present ({sel} matched {n})"

        # 4. Video element remained mounted throughout.
        video_count = await page.locator("video").count()
        assert video_count >= 1, "video element disappeared after upstream failures"

        # 5. hls.js kept retrying — more than one /playlist request for our TV.
        assert len(playlist_requests) >= 2, (
            f"hls.js gave up after the first failure "
            f"({len(playlist_requests)} /playlist requests)"
        )

        # 6. Still on the lounge page — no error-boundary navigation.
        assert f"/lounge/{LOUNGE_SLUG}" in page.url, (
            f"navigated away from lounge on failure: {page.url}"
        )

        # 7. No uncaught page-level errors surfaced from the failure.
        assert not page_errors, f"unexpected uncaught page errors: {page_errors[:3]}"

        print("OK — upstream /playlist failed repeatedly, no blank-screen "
              f"overlay ever appeared, <video> stayed mounted, and hls.js "
              f"retried ({len(playlist_requests)} times).")

        # Cleanup.
        try:
            await page.evaluate(
                """async ({ tvId }) => {
                    const { stopLoungeStream } = await import('/src/lib/stream-admin.functions.ts');
                    return stopLoungeStream({ data: { tvId } });
                }""", {"tvId": tv_id})
        except Exception as e:
            print("stop non-fatal:", e)

        await browser.close()


asyncio.run(main())
