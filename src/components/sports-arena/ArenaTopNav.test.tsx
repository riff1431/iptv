import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

// Mock TanStack Link (no router in tests).
vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    Link: ({
      to,
      children,
      activeOptions: _activeOptions,
      activeProps: _activeProps,
      inactiveProps: _inactiveProps,
      preload: _preload,
      ...rest
    }: any) => (
      <a href={typeof to === "string" ? to : "#"} {...rest}>{children}</a>
    ),
  };
});

// Mutable user + profile row swapped per test.
type FakeUser = { id: string; email: string; user_metadata: Record<string, unknown> } | null;
let currentUser: FakeUser = null;
let profileRow: { display_name: string | null; avatar_url: string | null } | null = null;

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: currentUser }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: profileRow }),
        }),
      }),
    }),
  },
}));

async function renderNav() {
  const { ArenaTopNav } = await import("./ArenaTopNav");
  return render(<ArenaTopNav />);
}

function mockMatchMedia(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduced && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
  currentUser = null;
  profileRow = null;
  mockMatchMedia(false);
});

describe("ArenaTopNav – avatar sourcing", () => {
  it("uses user_metadata.avatar_url when present", async () => {
    currentUser = {
      id: "u1",
      email: "alex@example.com",
      user_metadata: { display_name: "Alex", avatar_url: "https://cdn.test/meta.png" },
    };
    profileRow = { display_name: "Alex From Profile", avatar_url: "https://cdn.test/profile.png" };

    const { container } = await renderNav();

    await waitFor(() => {
      const img = container.querySelector("img");
      expect(img?.getAttribute("src")).toBe("https://cdn.test/meta.png");
    });
  });

  it("falls back to profiles.avatar_url when user_metadata has none", async () => {
    currentUser = {
      id: "u2",
      email: "sam@example.com",
      user_metadata: { display_name: "Sam" }, // no avatar_url
    };
    profileRow = { display_name: null, avatar_url: "https://cdn.test/profile-sam.png" };

    const { container } = await renderNav();

    await waitFor(() => {
      const img = container.querySelector("img");
      expect(img?.getAttribute("src")).toBe("https://cdn.test/profile-sam.png");
    });
  });

  it("renders the initial when both metadata and profile avatar are missing", async () => {
    currentUser = {
      id: "u3",
      email: "jamie@example.com",
      user_metadata: { display_name: "Jamie" },
    };
    profileRow = { display_name: null, avatar_url: null };

    const { container } = await renderNav();

    await waitFor(() => expect(screen.getByText("J")).toBeInTheDocument());
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows a skeleton placeholder while the avatar image is loading", async () => {
    currentUser = {
      id: "u4",
      email: "riley@example.com",
      user_metadata: { display_name: "Riley", avatar_url: "https://cdn.test/riley.png" },
    };
    profileRow = null;

    const { container } = await renderNav();

    // Skeleton is present before the <img> fires onLoad.
    const skeleton = await screen.findByTestId("avatar-skeleton");
    expect(skeleton).toBeInTheDocument();

    const img = container.querySelector("img") as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.className).toContain("opacity-0");

    // Fire load; skeleton disappears and image becomes visible.
    img.dispatchEvent(new Event("load"));

    await waitFor(() => expect(screen.queryByTestId("avatar-skeleton")).toBeNull());
    expect((container.querySelector("img") as HTMLImageElement).className).toContain("opacity-100");
  });

  it("announces the loading state with correct ARIA attributes and clears them once loaded", async () => {
    currentUser = {
      id: "u8",
      email: "jordan@example.com",
      user_metadata: { display_name: "Jordan", avatar_url: "https://cdn.test/jordan.png" },
    };
    profileRow = null;

    const { container } = await renderNav();

    // Skeleton exposes a live status region announcing the loading state.
    const skeleton = await screen.findByTestId("avatar-skeleton");
    expect(skeleton.getAttribute("role")).toBe("status");
    expect(skeleton.getAttribute("aria-live")).toBe("polite");
    expect(skeleton.getAttribute("aria-label")).toBe("Loading avatar");

    // Assistive tech should also be told the wrapper is busy while loading.
    const wrapper = skeleton.parentElement as HTMLElement;
    expect(wrapper.getAttribute("aria-busy")).toBe("true");

    // The <img> stays decorative (empty alt) so the status region isn't duplicated.
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("alt")).toBe("");

    // Once the image loads, the status region is removed and aria-busy clears.
    img.dispatchEvent(new Event("load"));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(wrapper.getAttribute("aria-busy")).toBeNull();
  });

  it("skeleton and image share the avatar wrapper's fixed dimensions at every breakpoint", async () => {
    currentUser = {
      id: "u5",
      email: "morgan@example.com",
      user_metadata: { display_name: "Morgan", avatar_url: "https://cdn.test/morgan.png" },
    };
    profileRow = null;

    const { container } = await renderNav();

    const skeleton = await screen.findByTestId("avatar-skeleton");
    const wrapper = skeleton.parentElement as HTMLElement;
    const img = container.querySelector("img") as HTMLImageElement;

    // Wrapper is a fixed 7×7 (28px) box — no responsive width/height overrides.
    expect(wrapper.className).toMatch(/(^|\s)h-7(\s|$)/);
    expect(wrapper.className).toMatch(/(^|\s)w-7(\s|$)/);
    expect(wrapper.className).not.toMatch(/(sm|md|lg|xl|2xl):(h|w)-/);

    // Skeleton fills the wrapper via absolute inset-0.
    expect(skeleton.className).toContain("absolute");
    expect(skeleton.className).toContain("inset-0");

    // Image fills the wrapper via h-full w-full — so it matches the skeleton box exactly.
    expect(img.className).toContain("h-full");
    expect(img.className).toContain("w-full");
    expect(img.className).toContain("object-cover");

    // Wrapper clips overflow so a taller image can't spill past the skeleton box.
    expect(wrapper.className).toContain("overflow-hidden");
  });

  it("disables the skeleton pulse animation when prefers-reduced-motion is set", async () => {
    mockMatchMedia(true);
    currentUser = {
      id: "u6",
      email: "casey@example.com",
      user_metadata: { display_name: "Casey", avatar_url: "https://cdn.test/casey.png" },
    };
    profileRow = null;

    await renderNav();

    const skeleton = await screen.findByTestId("avatar-skeleton");
    expect(skeleton.getAttribute("data-reduced-motion")).toBe("true");
    expect(skeleton.className).not.toContain("animate-pulse");
  });

  it("keeps the skeleton pulse animation when prefers-reduced-motion is not set", async () => {
    mockMatchMedia(false);
    currentUser = {
      id: "u7",
      email: "drew@example.com",
      user_metadata: { display_name: "Drew", avatar_url: "https://cdn.test/drew.png" },
    };
    profileRow = null;

    await renderNav();

    const skeleton = await screen.findByTestId("avatar-skeleton");
    expect(skeleton.getAttribute("data-reduced-motion")).toBe("false");
    expect(skeleton.className).toContain("animate-pulse");
  });
});


