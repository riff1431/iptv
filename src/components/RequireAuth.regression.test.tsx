import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { RequireAuth } from "./RequireAuth";

const navigate = vi.fn();
let location = {
  pathname: "/dashboard",
  searchStr: "",
  hash: "",
  href: "/dashboard",
};
const authState = {
  user: null as null | { id: string },
  loading: false,
  roles: [] as string[],
  isAdmin: false,
};

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location }),
  ClientOnly: ({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) => children,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => authState,
}));

function setLocation(next: Partial<typeof location>) {
  location = { ...location, ...next };
}

describe("RequireAuth redirect loop regression", () => {
  beforeEach(() => {
    navigate.mockClear();
    location = { pathname: "/dashboard", searchStr: "", hash: "", href: "/dashboard" };
    authState.user = null;
    authState.loading = false;
    authState.roles = [];
    authState.isAdmin = false;
  });

  it("only fires the redirect once when unauthenticated, even across rerenders", () => {
    const { rerender } = render(
      <RequireAuth>
        <div>secret</div>
      </RequireAuth>,
    );

    // Multiple rerenders (as would happen during route exit animations) must
    // not stack navigate() calls into an infinite loop.
    for (let i = 0; i < 5; i++) {
      rerender(
        <RequireAuth>
          <div>secret</div>
        </RequireAuth>,
      );
    }

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith({
      to: "/auth",
      search: { redirect: "/dashboard" },
      replace: true,
    });
  });

  it("does not re-navigate when pathname changes after the redirect has fired", () => {
    const { rerender } = render(
      <RequireAuth>
        <div>secret</div>
      </RequireAuth>,
    );
    expect(navigate).toHaveBeenCalledTimes(1);

    act(() => {
      setLocation({ pathname: "/auth", href: "/auth" });
    });
    rerender(
      <RequireAuth>
        <div>secret</div>
      </RequireAuth>,
    );
    rerender(
      <RequireAuth>
        <div>secret</div>
      </RequireAuth>,
    );

    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("waits for loading before redirecting", () => {
    authState.loading = true;
    const { rerender } = render(
      <RequireAuth>
        <div>secret</div>
      </RequireAuth>,
    );
    expect(navigate).not.toHaveBeenCalled();

    act(() => {
      authState.loading = false;
    });
    rerender(
      <RequireAuth>
        <div>secret</div>
      </RequireAuth>,
    );
    rerender(
      <RequireAuth>
        <div>secret</div>
      </RequireAuth>,
    );

    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("only fires the forbidden redirect once when role gate fails", () => {
    authState.user = { id: "u1" };
    authState.roles = [];
    authState.isAdmin = false;

    const { rerender } = render(
      <RequireAuth role="admin">
        <div>secret</div>
      </RequireAuth>,
    );
    for (let i = 0; i < 5; i++) {
      rerender(
        <RequireAuth role="admin">
          <div>secret</div>
        </RequireAuth>,
      );
    }

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith({ to: "/forbidden", replace: true });
  });

  it("preserves pathname, search, and hash in the redirect target", () => {
    setLocation({
      pathname: "/wallet",
      searchStr: "?tab=history&sort=desc",
      hash: "#tx-42",
      href: "/wallet?tab=history&sort=desc#tx-42",
    });
    render(
      <RequireAuth>
        <div>secret</div>
      </RequireAuth>,
    );
    expect(navigate).toHaveBeenCalledWith({
      to: "/auth",
      search: { redirect: "/wallet?tab=history&sort=desc#tx-42" },
      replace: true,
    });
  });

  it("falls back to / when already on /auth to avoid nesting", () => {
    setLocation({ pathname: "/auth", searchStr: "", hash: "", href: "/auth" });
    render(
      <RequireAuth>
        <div>secret</div>
      </RequireAuth>,
    );
    expect(navigate).toHaveBeenCalledWith({
      to: "/auth",
      search: {},
      replace: true,
    });
  });

  it("falls back to / when the current URL already carries a redirect param", () => {
    setLocation({
      pathname: "/dashboard",
      searchStr: "?redirect=%2Fwallet",
      hash: "",
      href: "/dashboard?redirect=%2Fwallet",
    });
    render(
      <RequireAuth>
        <div>secret</div>
      </RequireAuth>,
    );
    expect(navigate).toHaveBeenCalledWith({
      to: "/auth",
      search: {},
      replace: true,
    });
  });

  it("caps excessively long redirect targets", () => {
    const longSearch = "?q=" + "a".repeat(1000);
    setLocation({
      pathname: "/search",
      searchStr: longSearch,
      hash: "",
      href: "/search" + longSearch,
    });
    render(
      <RequireAuth>
        <div>secret</div>
      </RequireAuth>,
    );
    const call = navigate.mock.calls[0][0] as {
      search: { redirect?: string };
    };
    expect(call.search.redirect).toBeDefined();
    expect(call.search.redirect!.length).toBeLessThanOrEqual(512);
  });
});
