"""
E2E: verify the custom TV player (HlsTile on /lounge/<slug>) requests
ONLY our signed /api/sports-arena/tv/<tvId>/seg proxy for segment URIs
during playback — no upstream host or unsigned segment fetch leaks.

Flow:
  1. Sign-in via injected Supabase session.
  2. Persist Xtream creds + a live channel on TV slot 1 (server fn).
  3. Start the shared stream for that TV only.
  4. Open /lounge/test with request interception enabled.
  5. Let the tile play for ~12s while collecting all network requests.
  6. Assert: every segment/key/map/media request goes through /seg?, and no
     request touches the upstream provider host.
  7. Stop the stream (provider is capped at 1 concurrent connection).
"""

import asyncio, json, os, re, urllib.request
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright

SCREENSHOTS = Path(__file__).parent / "screenshots" / "iptv_seg_proxy_only"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

XTREAM_URL = "http://cf.8knn.xyz"
XTREAM_USER = "d755c873c436"
XTREAM_PASS = "893e890abf"
LOUNGE_ID = "42cbd067-fe7a-4e3c-8274-546d632232e8"  # "Test"
LOUNGE_SLUG = "test"
SLOT = 1

UPSTREAM_HOST = urlparse(XTREAM_URL).hostname  # cf.8knn.xyz

# Anything that looks like an HLS byte-stream fetch. .m3u8 (the playlist
# itself) is served via /playlist so we exclude it from the /seg check.
SEG_LIKE_RE = re.compile(r"\.(ts|m4s|mp4|aac|mp3|vtt|key)(\?|$)", re.I)


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        storage_key = os.environ["LOVABLE_BROWSER_SUPABASE_STORAGE_KEY"]
        session_json = os.environ["LOVABLE_BROWSER_SUPABASE_SESSION_JSON"]
        access_token = os.environ["LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN"]
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

        # --- Save creds + selected channel via the same server fn the UI uses.
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

        saved = await page.evaluate(
            """async ({ lounge_id, slot, url, user, pw, ch }) => {
                const { saveTv } = await import('/src/lib/iptv-admin.functions.ts');
                const { supabase } = await import('/src/integrations/supabase/client.ts');
                const { data: existing } = await supabase
                    .from('tvs').select('id').eq('lounge_id', lounge_id).eq('slot', slot).maybeSingle();
                return saveTv({ data: {
                    id: existing?.id,
                    lounge_id, slot,
                    display_name: 'Seg-proxy E2E TV',
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
        print(f"tv {tv_id} configured on channel {ch['id']} — {ch['name']}")

        # --- Start the shared stream on THIS TV only.
        start_res = await page.evaluate(
            """async ({ tvId }) => {
                const { startLoungeStream } = await import('/src/lib/stream-admin.functions.ts');
                return startLoungeStream({ data: { tvId } });
            }""",
            {"tvId": tv_id},
        )
        print("startLoungeStream:", start_res)

        # --- Instrument the viewer page and open the lounge.
        seg_prefix = f"/api/sports-arena/tv/{tv_id}/seg"
        playlist_path = f"/api/sports-arena/tv/{tv_id}/playlist"
        requests_seen: list[dict] = []

        def on_request(request):
            requests_seen.append(
                {"url": request.url, "type": request.resource_type, "method": request.method}
            )

        page.on("request", on_request)

        await page.goto(
            f"http://localhost:8080/lounge/{LOUNGE_SLUG}", wait_until="networkidle"
        )
        # Access gate — start the free preview so LoungeGrid mounts.
        try:
            btn = page.get_by_role("button", name=re.compile(r"start.*preview", re.I))
            await btn.first.click(timeout=5000)
        except Exception as e:
            print("no preview gate visible (already unlocked?):", e)
        await page.wait_for_timeout(1500)
        await page.screenshot(path=str(SCREENSHOTS / "1_lounge.png"))

        # Give hls.js time to fetch the playlist + several segments.
        await page.wait_for_timeout(12_000)
        await page.screenshot(path=str(SCREENSHOTS / "2_playback.png"))

        # --- Stop upstream ASAP (1-slot subscription cap).
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
        seg_hits = [
            r for r in requests_seen
            if seg_prefix in r["url"] and "/seg?" in r["url"] or seg_prefix + "?" in r["url"]
        ]
        upstream_hits = [
            r for r in requests_seen
            if UPSTREAM_HOST and UPSTREAM_HOST in r["url"]
        ]
        # Any segment-shaped URL that DIDN'T route through our proxy. Limit
        # to media/xhr/fetch — Vite serves plenty of .ts *modules* over HTTP.
        MEDIA_TYPES = {"xhr", "fetch", "media"}
        unsigned_seg_hits = [
            r for r in requests_seen
            if r["type"] in MEDIA_TYPES
            and SEG_LIKE_RE.search(urlparse(r["url"]).path)
            and f"/api/sports-arena/tv/{tv_id}/seg" not in r["url"]
        ]

        print(f"total requests: {len(requests_seen)}")
        print(f"playlist hits:  {len(playlist_hits)}")
        print(f"/seg hits:      {len(seg_hits)}")
        print(f"upstream hits:  {len(upstream_hits)}")
        for r in requests_seen:
            if "/api/sports-arena/" in r["url"] or (UPSTREAM_HOST and UPSTREAM_HOST in r["url"]):
                print("  ·", r["method"], r["type"], r["url"][:140])

        assert playlist_hits, "player never fetched the signed playlist"
        assert seg_hits, "player never fetched a /seg segment — playback likely failed"
        assert not upstream_hits, (
            f"player leaked upstream requests to {UPSTREAM_HOST}: "
            f"{[r['url'][:120] for r in upstream_hits[:3]]}"
        )
        assert not unsigned_seg_hits, (
            "player fetched segment-shaped URLs outside the /seg proxy: "
            f"{[r['url'][:140] for r in unsigned_seg_hits[:3]]}"
        )

        print("OK — every segment request went through the signed /seg proxy.")
        await browser.close()


asyncio.run(main())
