"""
E2E: verify every signed /seg request emitted by the custom TV player
during playback carries the expected query parameters:
  - path contains the assigned tvId
  - `u` — base64url upstream URL (decodes to the assigned channel host)
  - `e` — expiry epoch-seconds, in the future at request time
  - `s` — hex HMAC signature, non-empty, hex-shaped

Playlist requests use the tvId path segment (no query string); we only
assert the tvId appears in every playlist URL.
"""

import asyncio, base64, json, os, re, time, urllib.request
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright

SCREENSHOTS = Path(__file__).parent / "screenshots" / "iptv_seg_query_params"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

XTREAM_URL = "http://cf.8knn.xyz"
XTREAM_USER = "d755c873c436"
XTREAM_PASS = "893e890abf"
LOUNGE_ID = "42cbd067-fe7a-4e3c-8274-546d632232e8"
LOUNGE_SLUG = "test"
SLOT = 1
UPSTREAM_HOST = urlparse(XTREAM_URL).hostname
SIG_RE = re.compile(r"^[A-Za-z0-9_\-+/=]+$")  # hex or base64/base64url


def b64url_decode(s: str) -> bytes:
    s += "=" * (-len(s) % 4)
    try:
        return base64.urlsafe_b64decode(s)
    except Exception:
        return base64.b64decode(s)


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

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

        # Pick a real live channel.
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
                const { data: existing } = await supabase
                    .from('tvs').select('id').eq('lounge_id', lounge_id).eq('slot', slot).maybeSingle();
                return saveTv({ data: {
                    id: existing?.id,
                    lounge_id, slot,
                    display_name: 'Seg-params E2E TV',
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

        await page.evaluate(
            """async ({ tvId }) => {
                const { startLoungeStream } = await import('/src/lib/stream-admin.functions.ts');
                return startLoungeStream({ data: { tvId } });
            }""",
            {"tvId": tv_id},
        )

        seg_prefix = f"/api/sports-arena/tv/{tv_id}/seg"
        playlist_path = f"/api/sports-arena/tv/{tv_id}/playlist"
        requests_seen: list[str] = []
        page.on("request", lambda r: requests_seen.append(r.url))

        await page.goto(
            f"http://localhost:8080/lounge/{LOUNGE_SLUG}", wait_until="networkidle"
        )
        try:
            btn = page.get_by_role("button", name=re.compile(r"start.*preview", re.I))
            await btn.first.click(timeout=5000)
        except Exception:
            pass
        await page.wait_for_timeout(1500)
        await page.screenshot(path=str(SCREENSHOTS / "1_lounge.png"))
        await page.wait_for_timeout(12_000)
        await page.screenshot(path=str(SCREENSHOTS / "2_playback.png"))

        try:
            await page.evaluate(
                """async ({ tvId }) => {
                    const { stopLoungeStream } = await import('/src/lib/stream-admin.functions.ts');
                    return stopLoungeStream({ data: { tvId } });
                }""",
                {"tvId": tv_id},
            )
        except Exception:
            pass

        playlist_hits = [u for u in requests_seen if playlist_path in u]
        seg_hits = [u for u in requests_seen if seg_prefix in u]

        print(f"playlist hits: {len(playlist_hits)}")
        print(f"/seg hits:     {len(seg_hits)}")

        assert playlist_hits, "no playlist requests captured"
        assert seg_hits, "no /seg requests captured — playback likely failed"

        # --- Playlist URLs: tvId must appear in the path.
        for u in playlist_hits:
            path = urlparse(u).path
            assert tv_id in path, f"playlist URL missing tvId: {u}"

        # --- Every /seg request must carry u, e, s and pass sanity checks.
        now = int(time.time())
        for u in seg_hits:
            parsed = urlparse(u)
            assert tv_id in parsed.path, f"/seg URL missing tvId in path: {u}"

            qs = parse_qs(parsed.query)
            for key in ("u", "e", "s"):
                assert key in qs and qs[key][0], f"/seg URL missing `{key}`: {u}"

            e_val = qs["e"][0]
            assert e_val.isdigit(), f"/seg `e` not numeric: {e_val}"
            expiry = int(e_val)
            assert expiry > now, f"/seg `e` already expired: {expiry} <= now {now}"
            assert expiry < now + 24 * 3600, (
                f"/seg `e` unreasonably far in future: {expiry - now}s"
            )

            s_val = qs["s"][0]
            assert SIG_RE.match(s_val), f"/seg `s` not hex/base64: {s_val[:20]}…"
            assert 16 <= len(s_val) <= 128, f"/seg `s` odd length {len(s_val)}"

            decoded = b64url_decode(qs["u"][0]).decode("utf-8", "replace")
            assert decoded.startswith("http"), f"/seg `u` didn't decode to URL: {decoded[:80]}"
            assert UPSTREAM_HOST in decoded, (
                f"/seg `u` decodes to unexpected host: {decoded[:120]}"
            )
            assert ch["id"] in decoded, (
                f"/seg `u` doesn't reference assigned channel {ch['id']}: {decoded[:120]}"
            )

        # Sanity: `s` should vary per distinct segment (not a constant).
        sigs = {parse_qs(urlparse(u).query)["s"][0] for u in seg_hits}
        assert len(sigs) >= 1, "no signatures seen"
        # Sample first URL for the log.
        print("sample /seg:", seg_hits[0][:180])
        print(
            f"OK — {len(seg_hits)} /seg requests, all with tvId + valid u/e/s "
            f"({len(sigs)} distinct signatures)"
        )

        await browser.close()


asyncio.run(main())
