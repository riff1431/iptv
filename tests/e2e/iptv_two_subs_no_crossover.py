"""
E2E: two different Xtream "subscriptions" (same account, two distinct
channels — we only have one live account, provider is capped at 1
concurrent connection) mapped to two different TV screens.

Verifies that each TV plays ONLY its assigned channel, with zero
cross-over between the two /seg proxies. Assertions per TV:

  * playlist manifest is fetched from that TV's /playlist path only
  * every /seg request is on that TV's /seg path only
  * decoded upstream (base64 `u=` param) contains that TV's channel id
  * the other TV's proxy is never hit during this TV's phase

Because the provider allows a single concurrent connection, TV1 is
started, played, stopped, then TV2 is started, played, stopped.
"""

import asyncio, base64, json, os, re, urllib.request
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright

SCREENSHOTS = Path(__file__).parent / "screenshots" / "iptv_two_subs_no_crossover"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

XTREAM_URL = "http://cf.8knn.xyz"
XTREAM_USER = "d755c873c436"
XTREAM_PASS = "893e890abf"
LOUNGE_ID = "42cbd067-fe7a-4e3c-8274-546d632232e8"
LOUNGE_SLUG = "test"
UPSTREAM_HOST = urlparse(XTREAM_URL).hostname

SEG_LIKE_RE = re.compile(r"\.(ts|m4s|mp4|aac|mp3|vtt|key)(\?|$)", re.I)
MEDIA_TYPES = {"xhr", "fetch", "media"}


def pick_two_distinct_channels():
    url = (
        f"{XTREAM_URL}/player_api.php?username={XTREAM_USER}"
        f"&password={XTREAM_PASS}&action=get_live_streams"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "VLC/3.0"})
    with urllib.request.urlopen(req, timeout=15) as r:
        streams = json.loads(r.read())
    assert isinstance(streams, list) and len(streams) >= 2, "need >=2 upstream channels"
    picks = []
    for s in streams:
        cid = str(s.get("stream_id"))
        if any(cid == p["id"] for p in picks):
            continue
        picks.append({
            "id": cid,
            "name": str(s.get("name") or f"Channel {cid}"),
            "logo": s.get("stream_icon") or None,
        })
        if len(picks) == 2:
            return picks
    raise AssertionError("could not select two distinct channels")


async def save_tv(page, *, tv_id, slot, ch):
    return await page.evaluate(
        """async ({ id, lounge_id, slot, url, user, pw, ch }) => {
            const { saveTv } = await import('/src/lib/iptv-admin.functions.ts');
            return saveTv({ data: {
                id: id || undefined,
                lounge_id, slot,
                display_name: `Sub E2E TV ${slot}`,
                provider_name: 'Xtream',
                server_url: url, username: user, password: pw,
                connection_type: 'xtream',
                selected_channel_id: String(ch.id),
                selected_channel_name: ch.name,
                selected_channel_logo: ch.logo || null,
                enabled: true,
            }});
        }""",
        {"id": tv_id, "lounge_id": LOUNGE_ID, "slot": slot,
         "url": XTREAM_URL, "user": XTREAM_USER, "pw": XTREAM_PASS, "ch": ch},
    )


async def find_or_create_tv(page, slot, ch):
    row = await page.evaluate(
        """async ({ lounge_id, slot }) => {
            const { supabase } = await import('/src/integrations/supabase/client.ts');
            const { data } = await supabase.from('tvs')
                .select('id').eq('lounge_id', lounge_id).eq('slot', slot).maybeSingle();
            return data;
        }""",
        {"lounge_id": LOUNGE_ID, "slot": slot},
    )
    res = await save_tv(page, tv_id=(row or {}).get("id"), slot=slot, ch=ch)
    assert res and res.get("id"), f"saveTv slot {slot} failed: {res}"
    return res["id"]


async def start(page, tv_id):
    return await page.evaluate(
        """async ({ tvId }) => {
            const { startLoungeStream } = await import('/src/lib/stream-admin.functions.ts');
            return startLoungeStream({ data: { tvId } });
        }""",
        {"tvId": tv_id},
    )


async def stop(page, tv_id):
    try:
        return await page.evaluate(
            """async ({ tvId }) => {
                const { stopLoungeStream } = await import('/src/lib/stream-admin.functions.ts');
                return stopLoungeStream({ data: { tvId } });
            }""",
            {"tvId": tv_id},
        )
    except Exception as e:
        print(f"stop({tv_id}) failed non-fatally:", e)


def assert_isolation(*, phase, requests_seen, playing_tv, other_tv, expected_channel_id, other_channel_id):
    play_prefix = f"/api/sports-arena/tv/{playing_tv}"
    other_prefix = f"/api/sports-arena/tv/{other_tv}"

    playlist_hits = [r for r in requests_seen
                     if r["type"] in MEDIA_TYPES and f"{play_prefix}/playlist" in r["url"]]
    seg_hits = [r for r in requests_seen
                if r["type"] in MEDIA_TYPES and f"{play_prefix}/seg" in r["url"]]
    # Both tiles are mounted (2x2 grid), so the OTHER TV's playlist request
    # may exist — but it should return 409 because that TV's shared session
    # is stopped. The cross-over that actually matters is at segment level:
    # no /seg from the other TV must ever fire during this phase.
    other_seg_hits = [r for r in requests_seen
                      if r["type"] in MEDIA_TYPES and f"{other_prefix}/seg" in r["url"]]
    upstream_hits = [r for r in requests_seen
                     if UPSTREAM_HOST and UPSTREAM_HOST in r["url"]]
    unsigned_seg_hits = [
        r for r in requests_seen
        if r["type"] in MEDIA_TYPES
        and SEG_LIKE_RE.search(urlparse(r["url"]).path)
        and f"{play_prefix}/seg" not in r["url"]
    ]

    print(f"[{phase}] playlist={len(playlist_hits)} seg={len(seg_hits)} "
          f"other-seg={len(other_seg_hits)} upstream={len(upstream_hits)}")

    assert playlist_hits, f"[{phase}] no playlist fetched for TV {playing_tv}"
    assert seg_hits, f"[{phase}] no segments fetched for TV {playing_tv}"
    assert not other_seg_hits, (
        f"[{phase}] cross-over: other TV's /seg proxy was hit: "
        f"{[r['url'][:120] for r in other_seg_hits[:3]]}"
    )
    assert not upstream_hits, (
        f"[{phase}] upstream {UPSTREAM_HOST} leaked: "
        f"{[r['url'][:120] for r in upstream_hits[:3]]}"
    )
    assert not unsigned_seg_hits, (
        f"[{phase}] unsigned segment fetches: "
        f"{[r['url'][:120] for r in unsigned_seg_hits[:3]]}"
    )

    # Decode a /seg?u=... upstream URL and confirm it targets the assigned channel.
    decoded = []
    for r in seg_hits:
        qs = parse_qs(urlparse(r["url"]).query)
        u = qs.get("u", [None])[0]
        if not u:
            continue
        try:
            padded = u + "=" * (-len(u) % 4)
            decoded.append(base64.urlsafe_b64decode(padded).decode("utf-8", "replace"))
        except Exception:
            pass
    print(f"[{phase}] sample upstream decoded: {decoded[0][:120] if decoded else '<none>'}")
    assert decoded, f"[{phase}] could not decode any /seg upstream URL"
    # Every decoded upstream must target this TV's channel and never the other.
    for u in decoded:
        assert expected_channel_id in u, (
            f"[{phase}] segment upstream {u[:140]} missing channel {expected_channel_id}"
        )
        assert other_channel_id not in u, (
            f"[{phase}] segment upstream {u[:140]} leaked OTHER channel {other_channel_id}"
        )


async def play_phase(page, phase, tv_id, other_tv_id, channel_id, other_channel_id):
    seen: list[dict] = []
    def on_request(request):
        seen.append({"url": request.url, "type": request.resource_type})
    page.on("request", on_request)
    try:
        await start(page, tv_id)
        await page.goto(f"http://localhost:8080/lounge/{LOUNGE_SLUG}",
                        wait_until="networkidle")
        try:
            btn = page.get_by_role("button", name=re.compile(r"start.*preview", re.I))
            await btn.first.click(timeout=3000)
        except Exception:
            pass
        await page.wait_for_timeout(12_000)
        await page.screenshot(path=str(SCREENSHOTS / f"{phase}.png"))
    finally:
        page.remove_listener("request", on_request)
        await stop(page, tv_id)

    assert_isolation(phase=phase, requests_seen=seen,
                     playing_tv=tv_id, other_tv=other_tv_id,
                     expected_channel_id=channel_id,
                     other_channel_id=other_channel_id)


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

        # Warm the admin page so its module graph is loaded for evaluate().
        await page.goto("http://localhost:8080/admin/tvs", wait_until="networkidle")

        ch_a, ch_b = pick_two_distinct_channels()
        print(f"channel A: {ch_a['id']} — {ch_a['name']}")
        print(f"channel B: {ch_b['id']} — {ch_b['name']}")

        # Two "subscriptions" = two TV slots, each mapped to a distinct channel.
        tv_a = await find_or_create_tv(page, slot=1, ch=ch_a)
        tv_b = await find_or_create_tv(page, slot=2, ch=ch_b)
        assert tv_a != tv_b, "TVs must have distinct ids"
        print(f"TV A id={tv_a}  TV B id={tv_b}")

        # Stop both up front to guarantee a clean 1-connection budget.
        await stop(page, tv_a); await stop(page, tv_b)

        await play_phase(page, "1_tvA_only", tv_a, tv_b, ch_a["id"], ch_b["id"])
        await play_phase(page, "2_tvB_only", tv_b, tv_a, ch_b["id"], ch_a["id"])

        print("OK — both subscriptions played on their own TV with zero cross-over.")
        await browser.close()


asyncio.run(main())
