"""E2E: arena navbar avatar skeleton placeholder behavior.

For both the metadata-present and metadata-missing paths, verifies that:
  1. While the avatar image is still loading, the skeleton placeholder
     (data-testid="avatar-skeleton") is visible AND the <img> is hidden
     via the opacity-0 class.
  2. Once the image finishes loading, the skeleton is removed from the DOM
     and the <img> becomes visible with the opacity-100 class.

Uses Playwright request interception to hold each avatar response open for
~1.2s so the loading state is observable deterministically.
"""
import asyncio
import base64
from pathlib import Path
from playwright.async_api import async_playwright

SHOTS = Path("/tmp/browser/arena-navbar-avatar-skeleton/shots")
SHOTS.mkdir(parents=True, exist_ok=True)

EMAIL = "user@demo.lovable.app"
PASSWORD = "TestPass!2026"

# Distinct URLs so we can independently delay each one. They just need to be
# reachable HTTP URLs — Playwright's route interception serves the response.
META_AVATAR = "http://localhost:8080/__e2e/meta-avatar.png"
PROFILE_AVATAR = "http://localhost:8080/__e2e/profile-avatar.png"

# 1x1 transparent PNG.
PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)
AVATAR_LOAD_DELAY_MS = 1200

AVATAR_WRAPPER = 'header button:has(span.rounded-full) span.rounded-full'
AVATAR_IMG = f'{AVATAR_WRAPPER} img'
SKELETON = '[data-testid="avatar-skeleton"]'


async def sign_in(page):
    await page.goto("http://localhost:8080/auth", wait_until="domcontentloaded")
    await page.locator('input[type="email"]').fill(EMAIL)
    await page.locator('input[type="password"]').fill(PASSWORD)
    await page.get_by_role("button", name="Sign in", exact=False).click()
    await page.wait_for_url(lambda u: "/auth" not in u, timeout=15000)


async def apply_avatars(page, *, meta_avatar, profile_avatar):
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
            updErr: upd.error?.message ?? null,
            profErr: prof.error?.message ?? null,
            metaAvatar: upd.data?.user?.user_metadata?.avatar_url ?? null,
            profAvatar: prof.data?.avatar_url ?? null,
          };
        }""",
        {"metaAvatar": meta_avatar, "profileAvatar": profile_avatar},
    )
    print("apply_avatars:", result)
    assert not result["updErr"], f"updateUser failed: {result['updErr']}"
    assert not result["profErr"], f"profiles update failed: {result['profErr']}"


async def _delayed_avatar_handler(route):
    """Hold the avatar response for AVATAR_LOAD_DELAY_MS then serve a PNG."""
    await asyncio.sleep(AVATAR_LOAD_DELAY_MS / 1000)
    await route.fulfill(
        status=200,
        headers={"content-type": "image/png", "cache-control": "no-store"},
        body=PNG_BYTES,
    )


async def assert_skeleton_lifecycle(page, *, expected_src, label):
    """Navigate to /arena and verify skeleton -> loaded transition."""
    # Fresh navigation so onLoad hasn't fired yet.
    await page.goto("http://localhost:8080/arena", wait_until="domcontentloaded")

    # 1. Skeleton attached while image is pending. Wait on the <img> first —
    # it only mounts once useAuth resolves and avatarUrl is set — and inspect
    # the skeleton in the same tick before it can be removed.
    img = page.locator(AVATAR_IMG).first
    await img.wait_for(state="attached", timeout=10000)
    skeleton = page.locator(SKELETON)
    await skeleton.first.wait_for(state="attached", timeout=5000)
    src = await img.get_attribute("src")
    img_class = await img.get_attribute("class") or ""
    print(f"[{label}] loading: src={src!r} classes={img_class!r}")
    assert src == expected_src, f"[{label}] wrong src while loading: {src!r}"
    assert "opacity-0" in img_class, (
        f"[{label}] <img> should start hidden (opacity-0). classes={img_class!r}"
    )
    await page.screenshot(path=str(SHOTS / f"{label}_1_loading.png"))

    # 2. Skeleton disappears + img becomes visible after load.
    await skeleton.first.wait_for(
        state="detached",
        timeout=AVATAR_LOAD_DELAY_MS + 5000,
    )
    img_class_after = await img.get_attribute("class") or ""
    print(f"[{label}] loaded: classes={img_class_after!r}")
    assert "opacity-100" in img_class_after, (
        f"[{label}] <img> should become visible (opacity-100). classes={img_class_after!r}"
    )
    assert await page.locator(SKELETON).count() == 0, (
        f"[{label}] skeleton should be gone after load"
    )
    await page.screenshot(path=str(SHOTS / f"{label}_2_loaded.png"))


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        # Delay both avatar URLs so the skeleton is observable in either case.
        await ctx.route(META_AVATAR, _delayed_avatar_handler)
        await ctx.route(PROFILE_AVATAR, _delayed_avatar_handler)

        page = await ctx.new_page()
        console = []
        page.on("console", lambda m: console.append(f"[{m.type}] {m.text}"))

        await sign_in(page)

        # Case A: metadata-present — <img> src should be META_AVATAR.
        await apply_avatars(
            page, meta_avatar=META_AVATAR, profile_avatar=PROFILE_AVATAR
        )
        await assert_skeleton_lifecycle(
            page, expected_src=META_AVATAR, label="meta_present"
        )

        # Case B: metadata-missing — <img> src should fall back to PROFILE_AVATAR.
        await apply_avatars(
            page, meta_avatar=None, profile_avatar=PROFILE_AVATAR
        )
        await assert_skeleton_lifecycle(
            page, expected_src=PROFILE_AVATAR, label="meta_missing"
        )

        print("\n--- CONSOLE (tail) ---")
        for m in console[-15:]:
            print(m)
        print("\nPASS")
        await browser.close()


asyncio.run(main())
