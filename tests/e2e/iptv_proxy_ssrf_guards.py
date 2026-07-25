"""
End-to-end test: the /api/public/iptv/playlist proxy must refuse SSRF-adjacent
inputs with a clear 4xx response before any upstream fetch happens.

We hit the running dev server directly (no browser needed) and assert each
malicious URL variant produces a 400 with a descriptive JSON error, while a
well-formed public URL is accepted past validation (we don't care whether
the upstream succeeds — only that validation lets it through, i.e. we get a
non-400 status like 200/502/504).
"""

import asyncio
import json
from urllib.parse import quote

from playwright.async_api import async_playwright

BASE = "http://localhost:8080/api/public/iptv/playlist"


# (label, raw url param, expected status, substring that must appear in error)
BLOCKED_CASES: list[tuple[str, str, int, str]] = [
    # Scheme allowlist
    ("file scheme", "file:///etc/passwd", 400, "http(s)"),
    ("ftp scheme", "ftp://example.com/x.m3u", 400, "http(s)"),
    ("gopher scheme", "gopher://example.com/", 400, "http(s)"),
    ("javascript scheme", "javascript:alert(1)", 400, "http(s)"),
    ("data scheme", "data:text/plain,hello", 400, "http(s)"),

    # Credentials in URL
    ("basic auth userinfo", "http://user:pass@example.com/x.m3u", 400, "credentials"),
    ("user-only userinfo", "http://admin@example.com/x.m3u", 400, "credentials"),

    # Port allowlist
    ("ssh port", "http://example.com:22/x.m3u", 400, "Port"),
    ("redis port", "http://example.com:6379/x.m3u", 400, "Port"),
    ("postgres port", "http://example.com:5432/x.m3u", 400, "Port"),

    # Private / loopback / metadata IPs
    ("ipv4 loopback", "http://127.0.0.1/x.m3u", 400, "not allowed"),
    ("ipv4 zero", "http://0.0.0.0/x.m3u", 400, "not allowed"),
    ("rfc1918 10/8", "http://10.0.0.1/x.m3u", 400, "not allowed"),
    ("rfc1918 192.168", "http://192.168.1.1/x.m3u", 400, "not allowed"),
    ("rfc1918 172.16", "http://172.16.0.5/x.m3u", 400, "not allowed"),
    ("cgnat 100.64", "http://100.64.0.1/x.m3u", 400, "not allowed"),
    ("aws metadata", "http://169.254.169.254/latest/meta-data/", 400, "not allowed"),
    ("gcp metadata host", "http://metadata.google.internal/x", 400, "not allowed"),
    ("ipv6 loopback", "http://[::1]/x.m3u", 400, "not allowed"),
    ("ipv6 link-local", "http://[fe80::1]/x.m3u", 400, "not allowed"),
    ("ipv6 ula", "http://[fd00::1]/x.m3u", 400, "not allowed"),
    ("ipv4-mapped ipv6", "http://[::ffff:127.0.0.1]/x.m3u", 400, "not allowed"),

    # DNS rebinding shorthand / numeric encodings (URL parser accepts these
    # and would resolve to loopback / private space).
    ("decimal ipv4 loopback", "http://2130706433/x.m3u", 400, "not allowed"),
    ("hex ipv4 loopback", "http://0x7f000001/x.m3u", 400, "not allowed"),
    ("localhost hostname", "http://localhost/x.m3u", 400, "not allowed"),
    ("mDNS .local", "http://router.local/x.m3u", 400, "not allowed"),

    # URL hygiene
    ("control char in url", "http://example.com/\x00bad", 400, "control"),
    ("whitespace in url", "http://example.com/ path", 400, "control"),

    # Missing param
    ("missing url", "", 400, "Missing"),
]


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context()
        req = ctx.request

        failures: list[str] = []

        for label, raw, expected_status, needle in BLOCKED_CASES:
            if raw == "":
                url = BASE  # no query param at all
            else:
                url = f"{BASE}?url={quote(raw, safe='')}"
            resp = await req.get(url)
            body_text = await resp.text()
            try:
                body = json.loads(body_text)
                err = body.get("error", "")
            except Exception:
                err = body_text
            ok = resp.status == expected_status and needle.lower() in err.lower()
            marker = "OK" if ok else "FAIL"
            print(f"[{marker}] {label:28s} status={resp.status} err={err!r}")
            if not ok:
                failures.append(
                    f"{label}: expected {expected_status} containing {needle!r}, "
                    f"got {resp.status} {err!r}"
                )

        # Sanity: a well-formed public URL must PASS validation. We don't own
        # example.com's response, so we just require the status is not 400
        # (upstream may return anything else including 200/502/504).
        ok_url = f"{BASE}?url={quote('https://example.com/does-not-exist.m3u', safe='')}"
        ok_resp = await ctx.request.get(ok_url)
        print(f"[sanity] public https url status={ok_resp.status}")
        if ok_resp.status == 400:
            failures.append(
                f"validation wrongly rejected a well-formed public https URL: "
                f"{await ok_resp.text()}"
            )

        await browser.close()

        if failures:
            print("\n--- FAILURES ---")
            for f in failures:
                print(" -", f)
            raise SystemExit(1)
        print(f"\nOK — {len(BLOCKED_CASES)} malicious inputs rejected with 4xx.")


asyncio.run(main())
