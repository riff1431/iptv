"""
E2E: the LoungeAccessGate must be satisfied BEFORE any HlsTile mounts
and before the signed proxy (/playlist, /seg) is called.

Flow:
  1. Sign in, ensure a TV is configured + streaming on slot 1.
  2. Open /lounge/test with request logging enabled.
  3. BEFORE clicking the "Start preview" gate:
       * assert no <video> / HlsTile is in the DOM,
       * assert zero /playlist or /seg requests were made.
  4. Click the gate button.
  5. AFTER: a <video> tile appears AND signed /playlist + /seg requests
     begin (playback wires up).
"""

import asyncio, json, os, re, urllib.request
from pathlib import Path
from playwright.async_api import async_playwright

SCREENSHOTS = Path(__file__).parent / "screenshots" / "iptv_gate_before_hlstile"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

XTREAM_URL = "http://cf.8knn.xyz"
XTREAM_USER = "d755c873c436"
XTREAM_PASS = "893e890abf"
LOUNGE_ID = "42cbd067-fe7a-4e3c-8274-546d632232e8"
LOUNGE_SLUG = "test"
SLOT = 1


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

        # Ensure a TV is configured with a real channel on slot 1.
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
                    display_name: 'Gate E2E TV',
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

        # Reset any active LoungeAccessGate session so the gate is guaranteed
        # to render before we open the lounge (a lingering preview/paid row
        # from a prior run bypasses the gate immediately).
        reset = await page.evaluate(
            """async ({ lounge_id }) => {
                const { supabase } = await import('/src/integrations/supabase/client.ts');
                const { data: user } = await supabase.auth.getUser();
                if (!user?.user?.id) return { skipped: true };
                const past = new Date(Date.now() - 60_000).toISOString();
                const { error, count } = await supabase
                    .from('lounge_sessions')
                    .update({ status: 'expired', expires_at: past }, { count: 'exact' })
                    .eq('lounge_id', lounge_id)
                    .eq('user_id', user.user.id);
                return { error: error?.message || null, expired: count ?? 0 };
            }""",
            {"lounge_id": LOUNGE_ID},
        )
        print("reset lounge sessions:", reset)


        # --- Instrument request log, then open the lounge.
        requests_seen: list[dict] = []
        page.on("request", lambda r: requests_seen.append(
            {"url": r.url, "type": r.resource_type}
        ))

        proxy_prefix = f"/api/sports-arena/tv/{tv_id}"

        await page.goto(f"http://localhost:8080/lounge/{LOUNGE_SLUG}",
                        wait_until="networkidle")
        # Give the page a beat to render the gate.
        await page.wait_for_timeout(1500)
        await page.screenshot(path=str(SCREENSHOTS / "1_before_gate.png"))

        # --- Pre-gate assertions.
        pre_video_count = await page.locator("video").count()
        pre_gate_requests = [
            r for r in requests_seen if proxy_prefix in r["url"]
        ]
        gate_button = page.get_by_role("button", name=re.compile(r"start.*preview", re.I))
        gate_visible = await gate_button.first.is_visible()

        print(f"pre-gate: video tags={pre_video_count}, "
              f"proxy calls={len(pre_gate_requests)}, gate visible={gate_visible}")

        assert gate_visible, "expected LoungeAccessGate 'Start preview' button before entry"
        assert pre_video_count == 0, (
            f"HlsTile <video> mounted BEFORE gate satisfied ({pre_video_count} elements)"
        )
        assert not pre_gate_requests, (
            "signed proxy called BEFORE gate satisfied: "
            f"{[r['url'][:120] for r in pre_gate_requests[:3]]}"
        )

        # --- Satisfy the gate.
        pre_count = len(requests_seen)
        await gate_button.first.click()
        # Wait for the tile to mount and playback wiring to start.
        await page.wait_for_selector("video", timeout=10_000)
        # Give hls.js time to fetch the playlist + first segment.
        await page.wait_for_timeout(8_000)
        await page.screenshot(path=str(SCREENSHOTS / "2_after_gate.png"))

        # --- Post-gate assertions.
        post_video_count = await page.locator("video").count()
        post_gate_requests = [
            r for r in requests_seen[pre_count:] if proxy_prefix in r["url"]
        ]
        playlist_hits = [r for r in post_gate_requests if "/playlist" in r["url"]]
        seg_hits = [r for r in post_gate_requests if "/seg" in r["url"]]

        print(f"post-gate: video tags={post_video_count}, "
              f"playlist={len(playlist_hits)}, seg={len(seg_hits)}")

        assert post_video_count >= 1, "HlsTile <video> never mounted after gate"
        assert playlist_hits, "signed /playlist never fetched after gate"
        assert seg_hits, "signed /seg segments never fetched after gate"

        # --- Cleanup: stop the shared session (1-slot cap).
        try:
            await page.evaluate(
                """async ({ tvId }) => {
                    const { stopLoungeStream } = await import('/src/lib/stream-admin.functions.ts');
                    return stopLoungeStream({ data: { tvId } });
                }""", {"tvId": tv_id})
        except Exception as e:
            print("stop non-fatal:", e)

        print("OK — gate blocked HlsTile + proxy calls until satisfied.")
        await browser.close()


asyncio.run(main())
