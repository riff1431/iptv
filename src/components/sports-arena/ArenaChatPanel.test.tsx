import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act, fireEvent } from "@testing-library/react";

// jsdom lacks scrollTo on Element — patch before any render.
(Element.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {};

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "viewer" } }),
}));

// Mutable messages array so each test controls what useLoungeChat returns.
let currentMessages: Array<{ id: string; user_id: string; body: string; created_at: string }> = [];
vi.mock("@/hooks/useLoungeChat", () => ({
  useLoungeChat: () => ({
    messages: currentMessages,
    loading: false,
    send: vi.fn().mockResolvedValue(undefined),
  }),
}));
// Mutable profile rows returned by supabase.from("profiles").select().in()
let profileRows: Array<{ id: string; display_name: string | null; avatar_url: string | null }> = [];

vi.mock("@/integrations/supabase/client", () => {
  const channelMock = {
    on: () => channelMock,
    subscribe: () => channelMock,
    unsubscribe: () => {},
    track: () => Promise.resolve("ok"),
    untrack: () => Promise.resolve("ok"),
  };
  return {
    supabase: {
      from: () => ({
        select: () => ({
          in: (_col: string, _ids: string[]) => ({
            then: (resolve: (r: { data: typeof profileRows }) => void) => {
              resolve({ data: profileRows });
              return Promise.resolve({ data: profileRows });
            },
          }),
        }),
      }),
      channel: () => channelMock,
      removeChannel: () => Promise.resolve(),
    },
  };
});

vi.mock("@/components/tips/TipComposerDialog", () => ({
  TipComposerDialog: () => null,
}));

import { ArenaChatPanel } from "./ArenaChatPanel";

function msg(user_id: string, id = "m-" + user_id): { id: string; user_id: string; body: string; created_at: string } {
  return { id, user_id, body: "hello", created_at: new Date("2024-01-01T12:00:00Z").toISOString() };
}

describe("ArenaChatPanel avatar rendering", () => {
  beforeEach(() => {
    currentMessages = [];
    profileRows = [];
  });
  afterEach(() => cleanup());

  it("renders an <img> with profile.avatar_url when the profile has one", async () => {
    currentMessages = [msg("user-a")];
    profileRows = [{ id: "user-a", display_name: "Alice Anderson", avatar_url: "https://cdn.example.com/a.png" }];

    render(<ArenaChatPanel loungeId="lounge-1" />);

    const img = await screen.findByAltText("Alice Anderson's avatar") as HTMLImageElement;
    expect(img.tagName).toBe("IMG");
    expect(img.src).toBe("https://cdn.example.com/a.png");
    expect(img.className).toMatch(/rounded-full/);
    expect(img.className).toMatch(/bg-gradient-to-br/);
  });

  it("falls back to initials + gradient when avatar_url is null", async () => {
    currentMessages = [msg("user-b")];
    profileRows = [{ id: "user-b", display_name: "Bob Brown", avatar_url: null }];

    render(<ArenaChatPanel loungeId="lounge-1" />);

    await screen.findByText("Bob Brown");
    expect(screen.queryByAltText("Bob Brown's avatar")).toBeNull();

    // Initials rendered
    const initials = screen.getByText("BB");
    expect(initials.className).toMatch(/rounded-full/);
    expect(initials.className).toMatch(/bg-gradient-to-br/);
  });

  it("falls back to initials from user_id slice when profile is missing entirely", async () => {
    currentMessages = [msg("abcdef1234")];
    profileRows = []; // no profile returned

    render(<ArenaChatPanel loungeId="lounge-1" />);

    // name defaults to user_id.slice(0,6) => "abcdef", initials => "AB"
    await screen.findByText("abcdef");
    expect(screen.queryByAltText(/avatar/i)).toBeNull();
    expect(screen.getByText("AB")).toBeInTheDocument();
  });

  it("hides broken avatar image via onError so gradient fallback shows", async () => {
    currentMessages = [msg("user-c")];
    profileRows = [{ id: "user-c", display_name: "Cara Cole", avatar_url: "https://cdn.example.com/broken.png" }];

    render(<ArenaChatPanel loungeId="lounge-1" />);

    const img = await screen.findByAltText("Cara Cole's avatar") as HTMLImageElement;
    expect(img.style.display).toBe("");

    act(() => {
      fireEvent.error(img);
    });

    await waitFor(() => expect(img.style.display).toBe("none"));
  });

  it("assigns deterministic gradient palette classes based on user_id", async () => {
    currentMessages = [msg("user-b")];
    profileRows = [{ id: "user-b", display_name: "Bob Brown", avatar_url: null }];

    render(<ArenaChatPanel loungeId="lounge-1" />);
    const el = await screen.findByText("BB");
    // one of the five palette entries must be present
    expect(el.className).toMatch(/from-\[oklch/);
    expect(el.className).toMatch(/to-\[oklch/);
  });
});
