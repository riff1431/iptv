"""E2E: arena navbar avatar renders for metadata-present and metadata-missing users.

Signs in as the shared demo user, then drives two cases:

1. metadata-present — set auth user_metadata.avatar_url to a data-URL, clear
   profiles.avatar_url. Navigate to /arena and assert the navbar <img> src
   equals the metadata URL (source of truth wins).
2. metadata-missing — clear auth user_metadata.avatar_url, set
   profiles.avatar_url to a different data-URL. Navigate to /arena and assert
   the navbar <img> src equals the profile URL (fallback path works).
"""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

SHOTS = Path("/tmp/browser/arena-navbar-avatar/shots")
SHOTS.mkdir(parents=True, exist_ok=True)

EMAIL = "user@demo.lovable.app"
PASSWORD = "TestPass!2026"

# 1x1 transparent PNGs (distinct bytes so the two URLs differ).
META_AVATAR = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)
PROFILE_AVATAR = (
    "data:image/gif;base64,"
    "R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=="
)

AVATAR_SELECTOR = 'header button:has(span.rounded-full) img'


async def sign_in(page):
    await page.goto("http://localhost:8080/auth", wait_until="domcontentloaded")
    await page.locator('input[type="email"]').fill(EMAIL)
    await page.locator('input[type="password"]').fill(PASSWORD)
    await page.get_by_role("button", name="Sign in", exact=False).click()
    await page.wait_for_url(lambda u: "/auth" not in u, timeout=15000)


async def apply_avatars(page, *, meta_avatar, profile_avatar):
    """Set (or clear) both auth user_metadata.avatar_url and profiles.avatar_url."""
    result = await page.evaluate(
        """async ({ metaAvatar, profileAvatar }) => {
          const { supabase } = await import('/src/integrations/supabase/client.ts');
          const upd = await supabase.auth.updateUser({ data: { avatar_url: metaAvatar } });
          const { data: userData } = await supabase.auth.getUser();
          const uid = userData?.user?.id;
          const prof = await supabase.from('profiles')
            .update({ avatar_url: profileAvatar })
            .eq('id', uid)
            .select('avatar_url')
            .maybeSingle();
          return {
            uid,
            updErr: upd.error?.message ?? null,
            profErr: prof.error?.message ?? null,
            profAvatar: prof.data?.avatar_url ?? null,
            metaAvatar: upd.data?.user?.user_metadata?.avatar_url ?? null,
          };
        }""",
        {"metaAvatar": meta_avatar, "profileAvatar": profile_avatar},
    )
    print("apply_avatars:", result)
    assert not result["updErr"], f"updateUser failed: {result['updErr']}"
    assert not result["profErr"], f"profiles update failed: {result['profErr']}"
    return result


async def read_avatar_src(page):
    await page.goto("http://localhost:8080/arena", wait_until="domcontentloaded")
    img = page.locator(AVATAR_SELECTOR)
    await img.first.wait_for(state="attached", timeout=10000)
    # Wait for the src to be populated (may briefly be empty during hydration).
    src = await img.first.get_attribute("src")
    for _ in range(20):
        if src:
            break
        await page.wait_for_timeout(150)
        src = await img.first.get_attribute("src")
    return src


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        console = []
        page.on("console", lambda m: console.append(f"[{m.type}] {m.text}"))

        await sign_in(page)
        await page.screenshot(path=str(SHOTS / "1_signed_in.png"))

        # Case 1: metadata present — should win over the profile fallback.
        await apply_avatars(page, meta_avatar=META_AVATAR, profile_avatar=PROFILE_AVATAR)
        src_meta = await read_avatar_src(page)
        await page.screenshot(path=str(SHOTS / "2_meta_present.png"))
        print("meta-present src:", (src_meta or "")[:60])
        assert src_meta == META_AVATAR, (
            f"metadata avatar should win. got={src_meta!r} expected={META_AVATAR!r}"
        )

        # Case 2: metadata missing — must fall back to profiles.avatar_url.
        await apply_avatars(page, meta_avatar=None, profile_avatar=PROFILE_AVATAR)
        src_profile = await read_avatar_src(page)
        await page.screenshot(path=str(SHOTS / "3_meta_missing.png"))
        print("meta-missing src:", (src_profile or "")[:60])
        assert src_profile == PROFILE_AVATAR, (
            f"profile avatar should render when metadata is missing. "
            f"got={src_profile!r} expected={PROFILE_AVATAR!r}"
        )

        print("\n--- CONSOLE (tail) ---")
        for m in console[-20:]:
            print(m)
        print("\nPASS")
        await browser.close()


asyncio.run(main())
