"""
End-to-end test: wire the provided Xtream IPTV subscription into a TV slot
and verify the playlist proxy returns a rewritten HLS manifest.

The subscription is capped at 1 concurrent connection, so we do NOT stream
video from a headed viewer AND the shared session at the same time. We only
verify:
  1. Admin can save Xtream creds for a TV via the server fn the UI calls.
  2. The playlist proxy returns 200 with a rewritten M3U pointing at /seg?.
  3. All segment URIs route through our signed proxy (no upstream leak).
"""

import asyncio, json, os, re, urllib.request
from pathlib import Path
from playwright.async_api import async_playwright

SCREENSHOTS = Path(__file__).parent / "screenshots" / "iptv_xtream_playback"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

XTREAM_URL = "http://cf.8knn.xyz"
XTREAM_USER = "d755c873c436"
XTREAM_PASS = "893e890abf"
LOUNGE_ID = "42cbd067-fe7a-4e3c-8274-546d632232e8"  # "Test" lounge
SLOT = 1


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        # Restore signed-in session.
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

        # Go to /admin/tvs and confirm the page renders.
        await page.goto("http://localhost:8080/admin/tvs", wait_until="networkidle")
        await page.screenshot(path=str(SCREENSHOTS / "1_admin_tvs.png"))

        # Call the saveTv server fn directly through the running app so we
        # exercise the exact validator that failed before the schema fix.
        save_res = await page.evaluate(
            """async ({ lounge_id, slot, url, user, pass }) => {
                const { saveTv } = await import('/src/lib/iptv-admin.functions.ts');
                const { supabase } = await import('/src/integrations/supabase/client.ts');
                const { data: existing } = await supabase
                    .from('tvs').select('id').eq('lounge_id', lounge_id).eq('slot', slot).maybeSingle();
                return saveTv({ data: {
                    id: existing?.id,
                    lounge_id, slot,
                    display_name: 'IPTV E2E TV',
                    provider_name: 'Xtream E2E',
                    server_url: url,
                    username: user,
                    password: pass,
                    connection_type: 'xtream',
                    enabled: true,
                } });
            }""",
            {
                "lounge_id": LOUNGE_ID,
                "slot": SLOT,
                "url": XTREAM_URL,
                "user": XTREAM_USER,
                "pass": XTREAM_PASS,
            },
        )
        print("saveTv result:", save_res)
        assert save_res and save_res.get("id"), f"saveTv failed: {save_res}"
        tv_id = save_res["id"]

        # Pick a channel directly from the upstream Xtream API (bypasses the
        # server fn so we don't try to marshal thousands of rows over CDP).
        streams_url = (
            f"{XTREAM_URL}/player_api.php?username={XTREAM_USER}"
            f"&password={XTREAM_PASS}&action=get_live_streams"
        )
        req = urllib.request.Request(streams_url, headers={"User-Agent": "VLC/3.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            streams = json.loads(r.read())
        assert isinstance(streams, list) and streams, "no live streams from provider"
        chosen = {
            "id": str(streams[0]["stream_id"]),
            "name": str(streams[0].get("name") or f"Channel {streams[0]['stream_id']}"),
            "logo": streams[0].get("stream_icon") or None,
        }
        print(f"chose channel {chosen['id']} — {chosen['name']}")

        # Persist channel selection.
        save_res_2 = await page.evaluate(
            """async ({ tvId, lounge_id, slot, url, user, ch }) => {
                const { saveTv } = await import('/src/lib/iptv-admin.functions.ts');
                return saveTv({ data: {
                    id: tvId, lounge_id, slot,
                    server_url: url, username: user,
                    connection_type: 'xtream',
                    selected_channel_id: String(ch.id),
                    selected_channel_name: ch.name,
                    selected_channel_logo: ch.logo || null,
                    enabled: true,
                } });
            }""",
            {
                "tvId": tv_id,
                "lounge_id": LOUNGE_ID,
                "slot": SLOT,
                "url": XTREAM_URL,
                "user": XTREAM_USER,
                "ch": chosen,
            },
        )
        print("channel-selection save:", save_res_2)
        assert save_res_2 and save_res_2.get("id") == tv_id

        # Hit the playlist proxy with the browser session bearer.
        access_token = os.environ["LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN"]
        proxy = await page.evaluate(
            """async ({ tvId, token }) => {
                const res = await fetch(`/api/sports-arena/tv/${tvId}/playlist`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                return { status: res.status, ct: res.headers.get('content-type'), body: await res.text() };
            }""",
            {"tvId": tv_id, "token": access_token},
        )
        print("playlist status:", proxy["status"], "ct:", proxy["ct"])
        print("playlist body (first 600):", proxy["body"][:600])
        assert proxy["status"] == 200, f"playlist proxy failed: {proxy['status']} {proxy['body'][:200]}"
        assert proxy["body"].startswith("#EXTM3U"), "response is not an HLS manifest"

        # Every non-comment URI must go through our /seg proxy — no upstream leak.
        leaked = []
        for line in proxy["body"].splitlines():
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            if not s.startswith(f"/api/sports-arena/tv/{tv_id}/seg?"):
                leaked.append(s[:120])
        assert not leaked, f"upstream URIs leaked into playlist: {leaked[:3]}"

        # Also check tags with URI="..." are rewritten (keys, maps, media).
        for m in re.finditer(r'URI="([^"]+)"', proxy["body"]):
            u = m.group(1)
            assert u.startswith(f"/api/sports-arena/tv/{tv_id}/seg?"), f"tag URI not rewritten: {u[:120]}"

        await page.screenshot(path=str(SCREENSHOTS / "2_after_save.png"))
        print("OK — Xtream sub wired, proxy returned rewritten manifest with",
              sum(1 for l in proxy["body"].splitlines() if l and not l.startswith("#")),
              "segment URIs.")

        await browser.close()


asyncio.run(main())
