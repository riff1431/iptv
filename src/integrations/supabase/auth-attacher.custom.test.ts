import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Supabase client BEFORE importing the module under test.
const getSession = vi.fn();
const refreshSession = vi.fn();

vi.mock("./client", () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSession(...args),
      refreshSession: (...args: unknown[]) => refreshSession(...args),
    },
  },
}));

import { attachSupabaseAuthHardened } from "./auth-attacher.custom";

// Minimal shape the middleware calls: `next({ headers })`.
type NextArg = { headers?: Record<string, string> };
type NextFn = (arg: NextArg) => Promise<{ ok: true; headers?: Record<string, string> }>;

// Extract the client callback from the middleware instance. The
// `createMiddleware().client(fn)` chain stores `fn` on an internal options
// bag; we invoke it directly so we don't need the full Start runtime.
function getClientHandler() {
  const anyMw = attachSupabaseAuthHardened as unknown as {
    _options?: { client?: (ctx: { next: NextFn }) => Promise<unknown> };
    options?: { client?: (ctx: { next: NextFn }) => Promise<unknown> };
  };
  const handler = anyMw._options?.client ?? anyMw.options?.client;
  if (!handler) {
    throw new Error("Could not locate client handler on middleware instance");
  }
  return handler;
}

describe("attachSupabaseAuthHardened", () => {
  beforeEach(() => {
    getSession.mockReset();
    refreshSession.mockReset();
  });

  it("refreshes the session when the token is about to expire and attaches the new bearer", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    // Access token expires in 10s — inside the 30s skew window, so must refresh.
    getSession.mockResolvedValue({
      data: {
        session: {
          access_token: "old-token",
          expires_at: nowSec + 10,
        },
      },
    });
    refreshSession.mockResolvedValue({
      data: {
        session: {
          access_token: "fresh-token",
          expires_at: nowSec + 3600,
        },
      },
    });

    // Fake `next` — simulates the downstream RPC call. Returns success and
    // echoes back the headers it received so we can assert on them.
    const next: NextFn = vi.fn(async ({ headers }) => ({
      ok: true as const,
      headers,
    }));

    const handler = getClientHandler();
    const result = (await handler({ next })) as { ok: true; headers?: Record<string, string> };

    expect(getSession).toHaveBeenCalledTimes(1);
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    // The RPC "succeeded" and it saw the freshly-refreshed bearer, not the stale one.
    expect(result.ok).toBe(true);
    expect(result.headers).toEqual({ Authorization: "Bearer fresh-token" });
  });

  it("reuses the existing token when it is comfortably in the future", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    getSession.mockResolvedValue({
      data: {
        session: {
          access_token: "still-good",
          expires_at: nowSec + 3600,
        },
      },
    });

    const next: NextFn = vi.fn(async ({ headers }) => ({ ok: true as const, headers }));
    const result = (await getClientHandler()({ next })) as {
      ok: true;
      headers?: Record<string, string>;
    };

    expect(refreshSession).not.toHaveBeenCalled();
    expect(result.headers).toEqual({ Authorization: "Bearer still-good" });
  });

  it("sends no Authorization header (and never throws) when the user is signed out", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    refreshSession.mockResolvedValue({ data: { session: null } });

    const next: NextFn = vi.fn(async ({ headers }) => ({ ok: true as const, headers }));
    const result = (await getClientHandler()({ next })) as {
      ok: true;
      headers?: Record<string, string>;
    };

    expect(result.headers).toEqual({});
  });
});
