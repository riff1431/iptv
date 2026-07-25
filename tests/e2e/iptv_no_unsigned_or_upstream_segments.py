"""
E2E: verify the custom TV player NEVER requests unsigned or upstream
segment URLs during playback on a TV screen.

Strategy (belt-and-braces):
  1. Sign-in via injected Supabase session.
  2. Persist Xtream creds on TV slot 1 with a real live channel.
  3. Start the shared stream for that TV.
  4. Open /lounge/test with:
       * a request listener that records every network call, and
       * a route interceptor that ABORTS any request going to the
         upstream provider host — if the player ever tries, playback
         would break AND we'd see the aborted request in the log.
  5. Let the tile play for ~12s.
  6. Assert:
       - at least one signed /seg request happened (playback worked),
       - zero requests to the upstream provider host,
       - zero segment-shaped media/xhr/fetch URLs outside /seg,
       - zero blocked (aborted) upstream requests were attempted.
  7. Stop the stream (1-slot provider cap).
"""

import asyncio, json, os, re, urllib.request
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright

SCREENSHOTS = Path(__file__).parent / "screenshots" / "iptv_no_unsigned_or_upstream_segments"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

XTREAM_URL = "http://cf.8knn.xyz"
XTREAM_USER = "d755c873c436"
XTREAM_PASS = "893e890abf"
LOUNGE_ID = "42cbd067-fe7a-4e3c-8274-546d632232e8"  # "Test"
LOUNGE_SLUG = "test"
SLOT = 1

UPSTREAM_HOST = urlparse(XTREAM_URL).hostname  # cf.8knn.xyz
SEG_LIKE_RE = re.compile(r"\.(ts|m4s|mp4|aac|mp3|vtt|key)(\?|$)", re.I)
MEDIA_TYPES = {"xhr", "fetch", "media"}


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        # --- Restore Supabase session (localStorage + SSR cookies).
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

        # --- Fetch a real live channel from the provider.
        await page.goto("http://localhost:8080/admin/tvs", wait_until="networkidle")
        streams_url = (
            f"{XTREAM_URL}/player_api.php?username={XTREAM_USER}"
            f"&password={XTREAM_PASS}&action=get_live_streams"
        )
        req = urllib.request.Request(streams_url, headers={"User-Agent": "VLC/3.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            streams = json.loads(r.read())
        assert streams, "no live streams from provider"
        ch = {
            "id": str(streams[0]["stream_id"]),
            "name": str(streams[0].get("name") or f"Channel {streams[0]['stream_id']}"),
            "logo": streams[0].get("stream_icon") or None,
        }

        # --- Save via the same server fn the admin UI uses.
        saved = await page.evaluate(
            """async ({ lounge_id, slot, url, user, pw, ch }) => {
                const { saveTv } = await import('/src/lib/iptv-admin.functions.ts');
                const { supabase } = await import('/src/integrations/supabase/client.ts');
                const { data: existing } = await supabase
                    .from('tvs').select('id').eq('lounge_id', lounge_id).eq('slot', slot).maybeSingle();
                return saveTv({ data: {
                    id: existing?.id,
                    lounge_id, slot,
                    display_name: 'No-upstream E2E TV',
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
        assert saved and saved.get("id"), f"saveTv failed: {saved}"
        tv_id = saved["id"]
        print(f"tv {tv_id} on channel {ch['id']} — {ch['name']}")

        # --- Start the shared stream on THIS TV only.
        start_res = await page.evaluate(
            """async ({ tvId }) => {
                const { startLoungeStream } = await import('/src/lib/stream-admin.functions.ts');
                return startLoungeStream({ data: { tvId } });
            }""",
            {"tvId": tv_id},
        )
        print("startLoungeStream:", start_res)

        # --- Instrument: log every request, block any upstream attempt.
        seg_prefix = f"/api/sports-arena/tv/{tv_id}/seg"
        playlist_path = f"/api/sports-arena/tv/{tv_id}/playlist"
        requests_seen: list[dict] = []
        blocked_upstream: list[str] = []

        def on_request(request):
            requests_seen.append(
                {"url": request.url, "type": request.resource_type, "method": request.method}
            )

        page.on("request", on_request)

        async def block_upstream(route):
            blocked_upstream.append(route.request.url)
            await route.abort()

        # Match http(s)://<UPSTREAM_HOST>/**
        await context.route(re.compile(rf"^https?://{re.escape(UPSTREAM_HOST)}/"), block_upstream)

        # --- Open the lounge and pass the access gate.
        await page.goto(
            f"http://localhost:8080/lounge/{LOUNGE_SLUG}", wait_until="networkidle"
        )
        try:
            btn = page.get_by_role("button", name=re.compile(r"start.*preview", re.I))
            await btn.first.click(timeout=5000)
        except Exception as e:
            print("no preview gate visible (already unlocked?):", e)
        await page.wait_for_timeout(1500)
        await page.screenshot(path=str(SCREENSHOTS / "1_lounge.png"))

        # Let hls.js fetch the playlist + several segments.
        await page.wait_for_timeout(12_000)
        await page.screenshot(path=str(SCREENSHOTS / "2_playback.png"))

        # --- Stop the upstream stream (1-slot cap).
        try:
            await page.evaluate(
                """async ({ tvId }) => {
                    const { stopLoungeStream } = await import('/src/lib/stream-admin.functions.ts');
                    return stopLoungeStream({ data: { tvId } });
                }""",
                {"tvId": tv_id},
            )
        except Exception as e:
            print("stop stream failed (non-fatal):", e)

        # --- Assertions.
        playlist_hits = [r for r in requests_seen if playlist_path in r["url"]]
        seg_hits = [r for r in requests_seen if seg_prefix in r["url"]]
        upstream_hits = [
            r for r in requests_seen
            if UPSTREAM_HOST and UPSTREAM_HOST in r["url"]
        ]
        unsigned_seg_hits = [
            r for r in requests_seen
            if r["type"] in MEDIA_TYPES
            and SEG_LIKE_RE.search(urlparse(r["url"]).path)
            and seg_prefix not in r["url"]
        ]

        print(f"total requests:   {len(requests_seen)}")
        print(f"playlist hits:    {len(playlist_hits)}")
        print(f"/seg hits:        {len(seg_hits)}")
        print(f"upstream hits:    {len(upstream_hits)}")
        print(f"blocked upstream: {len(blocked_upstream)}")
        print(f"unsigned segs:    {len(unsigned_seg_hits)}")
        for r in requests_seen:
            if "/api/sports-arena/" in r["url"] or (UPSTREAM_HOST and UPSTREAM_HOST in r["url"]):
                print("  ·", r["method"], r["type"], r["url"][:140])
        for u in blocked_upstream[:5]:
            print("  BLOCKED ·", u[:140])
        for r in unsigned_seg_hits[:5]:
            print("  UNSIGNED ·", r["type"], r["url"][:140])

        assert playlist_hits, "player never fetched the signed playlist"
        assert seg_hits, "player never fetched a /seg segment — playback likely failed"
        assert not upstream_hits, (
            f"player made requests to upstream {UPSTREAM_HOST}: "
            f"{[r['url'][:120] for r in upstream_hits[:3]]}"
        )
        assert not blocked_upstream, (
            f"player ATTEMPTED upstream requests (blocked by test): "
            f"{[u[:120] for u in blocked_upstream[:3]]}"
        )
        assert not unsigned_seg_hits, (
            "player fetched segment-shaped URLs outside the /seg proxy: "
            f"{[r['url'][:140] for r in unsigned_seg_hits[:3]]}"
        )

        print("OK — no unsigned or upstream segment URLs were requested.")
        await browser.close()


asyncio.run(main())
