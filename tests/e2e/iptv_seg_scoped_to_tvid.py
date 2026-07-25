"""
E2E: start previews on two different TV screens (same lounge, distinct
tvIds + channels) and confirm every segment request stays scoped to the
selected tvId path segment.

For each of two phases (TV A active, then TV B active) we assert:

  * at least one signed /seg request for the ACTIVE tvId happened
  * NO /seg request references the OTHER tvId's path
  * every media/xhr/fetch /seg URL's path segment == active tvId
  * the decoded upstream (`u=` param, base64url) references the ACTIVE
    channel id and never the other channel id

The IPTV provider is capped at one concurrent connection, so phases run
sequentially: start A → play → stop A → start B → play → stop B.
"""

import asyncio, base64, json, os, re, urllib.request
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright

SCREENSHOTS = Path(__file__).parent / "screenshots" / "iptv_seg_scoped_to_tvid"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)

XTREAM_URL = "http://cf.8knn.xyz"
XTREAM_USER = "d755c873c436"
XTREAM_PASS = "893e890abf"
LOUNGE_ID = "42cbd067-fe7a-4e3c-8274-546d632232e8"
LOUNGE_SLUG = "test"

# Matches /api/sports-arena/tv/<uuid>/seg
SEG_PATH_RE = re.compile(r"^/api/sports-arena/tv/([0-9a-f\-]{36})/seg$")
MEDIA_TYPES = {"xhr", "fetch", "media"}


def pick_two_channels():
    url = (
        f"{XTREAM_URL}/player_api.php?username={XTREAM_USER}"
        f"&password={XTREAM_PASS}&action=get_live_streams"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "VLC/3.0"})
    with urllib.request.urlopen(req, timeout=15) as r:
        streams = json.loads(r.read())
    assert isinstance(streams, list) and len(streams) >= 2
    picks = []
    seen: set[str] = set()
    for s in streams:
        cid = str(s.get("stream_id"))
        if cid in seen:
            continue
        seen.add(cid)
        picks.append({
            "id": cid,
            "name": str(s.get("name") or f"Channel {cid}"),
            "logo": s.get("stream_icon") or None,
        })
        if len(picks) == 2:
            return picks
    raise AssertionError("need two distinct channels")


async def save_tv(page, *, tv_id, slot, ch):
    return await page.evaluate(
        """async ({ id, lounge_id, slot, url, user, pw, ch }) => {
            const { saveTv } = await import('/src/lib/iptv-admin.functions.ts');
            return saveTv({ data: {
                id: id || undefined,
                lounge_id, slot,
                display_name: `Scoped E2E TV ${slot}`,
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


async def find_or_create(page, slot, ch):
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
        }""", {"tvId": tv_id})


async def stop(page, tv_id):
    try:
        await page.evaluate(
            """async ({ tvId }) => {
                const { stopLoungeStream } = await import('/src/lib/stream-admin.functions.ts');
                return stopLoungeStream({ data: { tvId } });
            }""", {"tvId": tv_id})
    except Exception as e:
        print(f"stop({tv_id}) non-fatal:", e)


def decode_u(u: str) -> str:
    padded = u + "=" * (-len(u) % 4)
    try:
        return base64.urlsafe_b64decode(padded).decode("utf-8", "replace")
    except Exception:
        return ""


def assert_scope(*, phase, requests, active_tv, other_tv, active_ch, other_ch):
    seg_active: list[str] = []
    seg_other: list[str] = []
    seg_stray_tvid: list[str] = []  # /seg under some third tvId — should not happen

    for r in requests:
        if r["type"] not in MEDIA_TYPES:
            continue
        path = urlparse(r["url"]).path
        m = SEG_PATH_RE.match(path)
        if not m:
            continue
        seen_tv = m.group(1)
        if seen_tv == active_tv:
            seg_active.append(r["url"])
        elif seen_tv == other_tv:
            seg_other.append(r["url"])
        else:
            seg_stray_tvid.append(r["url"])

    print(f"[{phase}] active-seg={len(seg_active)} other-seg={len(seg_other)} "
          f"stray-tvid-seg={len(seg_stray_tvid)}")

    assert seg_active, f"[{phase}] no /seg requests for active tv {active_tv}"
    assert not seg_other, (
        f"[{phase}] leak: /seg requests targeted OTHER tvId {other_tv}: "
        f"{[u[:120] for u in seg_other[:3]]}"
    )
    assert not seg_stray_tvid, (
        f"[{phase}] /seg requests targeted an unknown tvId: "
        f"{[u[:120] for u in seg_stray_tvid[:3]]}"
    )

    # Decoded upstream must match the ACTIVE channel and never the other.
    decoded_any = False
    for u in seg_active:
        val = parse_qs(urlparse(u).query).get("u", [""])[0]
        if not val:
            continue
        decoded = decode_u(val)
        if not decoded:
            continue
        decoded_any = True
        assert active_ch in decoded, (
            f"[{phase}] /seg upstream missing active channel {active_ch}: {decoded[:120]}"
        )
        assert other_ch not in decoded, (
            f"[{phase}] /seg upstream leaked OTHER channel {other_ch}: {decoded[:120]}"
        )
    assert decoded_any, f"[{phase}] could not decode any /seg upstream URL"


async def play_phase(page, phase, active_tv, other_tv, active_ch, other_ch):
    seen: list[dict] = []
    def on_req(r):
        seen.append({"url": r.url, "type": r.resource_type})
    page.on("request", on_req)
    try:
        await start(page, active_tv)
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
        page.remove_listener("request", on_req)
        await stop(page, active_tv)

    assert_scope(phase=phase, requests=seen,
                 active_tv=active_tv, other_tv=other_tv,
                 active_ch=active_ch, other_ch=other_ch)


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
        await page.goto("http://localhost:8080/admin/tvs", wait_until="networkidle")

        ch_a, ch_b = pick_two_channels()
        print(f"channel A: {ch_a['id']} — {ch_a['name']}")
        print(f"channel B: {ch_b['id']} — {ch_b['name']}")

        tv_a = await find_or_create(page, slot=1, ch=ch_a)
        tv_b = await find_or_create(page, slot=2, ch=ch_b)
        assert tv_a != tv_b
        print(f"TV A id={tv_a}  TV B id={tv_b}")

        await stop(page, tv_a); await stop(page, tv_b)

        await play_phase(page, "1_tvA_active", tv_a, tv_b, ch_a["id"], ch_b["id"])
        await play_phase(page, "2_tvB_active", tv_b, tv_a, ch_b["id"], ch_a["id"])

        print("OK — segment requests stayed scoped to the selected tvId in both phases.")
        await browser.close()


asyncio.run(main())
