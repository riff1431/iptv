import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Regression: while `useAuth()` is still loading its initial session
 * (`user === null && loading === true`), UserNav must NOT render the
 * "Log In" / "Create Account" CTAs. Otherwise every soft navigation
 * flashes the signed-out header for a few hundred ms, which users
 * report as an auto-logout.
 */

const authState = {
  user: null as null | { id: string; email?: string },
  isAdmin: false,
  loading: true,
  signOut: vi.fn(async () => {}),
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState,
}));

vi.mock("@/hooks/useDirectMessages", () => ({
  useDirectMessages: () => ({ unreadCount: 0, threads: [] }),
}));

vi.mock("@/hooks/useNotifications", () => ({
  useNotifications: () => ({
    unreadCount: 0,
    notifications: [],
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
  }),
}));

vi.mock("@/hooks/useProfile", () => ({
  useProfile: () => ({ displayName: null, avatarUrl: null, initial: "?" }),
}));

vi.mock("@/lib/wallet-preferences", () => ({
  useAutoMarkReadOnDeepLink: () => [false, vi.fn()],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signOut: vi.fn(async () => ({ error: null })),
      getSession: vi.fn(async () => ({ data: { session: null } })),
    },
  },
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  );
  return {
    ...actual,
    useQueryClient: () => ({
      cancelQueries: vi.fn(async () => {}),
      clear: vi.fn(),
      invalidateQueries: vi.fn(async () => {}),
    }),
    useQuery: () => ({ data: undefined, isLoading: false, error: null }),
  };
});

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => (
    <a {...props}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
  useRouterState: () => ({ location: { pathname: "/", searchStr: "", hash: "", href: "/" } }),
}));

// Import AFTER the mocks are registered.
import { UserNav } from "./UserNav";

function textOf(container: HTMLElement) {
  return (container.textContent ?? "").toLowerCase();
}

describe("UserNav authLoading regression", () => {
  beforeEach(() => {
    cleanup();
    authState.user = null;
    authState.isAdmin = false;
    authState.loading = true;
  });

  it("does not render the signed-out CTA while auth is still loading", () => {
    const { container, queryByRole } = render(<UserNav />);
    const body = textOf(container);
    expect(body).not.toContain("log in");
    expect(body).not.toContain("create account");
    expect(queryByRole("button", { name: /log in/i })).toBeNull();
    expect(queryByRole("button", { name: /create account/i })).toBeNull();
    // The placeholder must be inert (aria-hidden) so screen readers do not
    // announce a phantom "sign in" affordance during hydration.
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it("renders the CTA once loading resolves with no user", () => {
    const { queryByRole, rerender } = render(<UserNav />);
    expect(queryByRole("button", { name: /log in/i })).toBeNull();

    act(() => {
      authState.loading = false;
    });
    rerender(<UserNav />);

    expect(queryByRole("button", { name: /log in/i })).not.toBeNull();
    expect(queryByRole("button", { name: /create account/i })).not.toBeNull();
  });

  it("stays CTA-free across repeated rerenders while loading (soft nav)", () => {
    const { queryByRole, rerender } = render(<UserNav />);
    for (let i = 0; i < 5; i++) {
      rerender(<UserNav />);
      expect(queryByRole("button", { name: /log in/i })).toBeNull();
      expect(queryByRole("button", { name: /create account/i })).toBeNull();
    }
  });
});
