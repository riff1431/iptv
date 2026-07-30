import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ArenaHeader } from "./ArenaHeader";

// jsdom lacks scrollTo/pointer APIs used by Radix dialog.
(Element.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {};
(HTMLElement.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false;

// The dialog fetches live lounges to derive dynamic content. Stub the server fn.
vi.mock("@/lib/lounges.public.functions", () => ({
  publicLoungesQuery: () => ({
    queryKey: ["publicLounges"],
    queryFn: async () => [],
    staleTime: 0,
  }),
}));

// TanStack's <Link> requires a router; render a plain anchor for the test.
vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    Link: ({ to, hash, children, ...rest }: any) => (
      <a href={hash ? `${to}#${hash}` : to} {...rest}>{children}</a>
    ),
  };
});


function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => cleanup());


describe("ArenaHeader – How to Play dialog integration", () => {
  it("opens the dialog when the button is clicked", async () => {
    renderWithClient(<ArenaHeader />);
    const button = screen.getByRole("button", { name: /how to play/i });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(button);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(/How to Play the Arena/i)).toBeInTheDocument();
  });

  it("returns focus to the trigger button after closing", async () => {
    renderWithClient(<ArenaHeader />);
    const button = screen.getByRole("button", { name: /how to play/i }) as HTMLButtonElement;

    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog");

    // Radix renders a close (X) button inside the dialog content.
    const closeBtn = screen.getByRole("button", { name: /close/i });
    fireEvent.click(closeBtn);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(button));

  });
});

describe("ArenaHeader – compact toolbar variant", () => {
  it("renders the provided title + leading node and drops the hero brand", () => {
    renderWithClient(
      <ArenaHeader
        liveGames={3}
        viewers={500}
        title="Lakers vs Celtics"
        leading={<a href="/arena">Back</a>}
      />,
    );

    // Page name + back button are rendered.
    expect(screen.getByText(/Lakers vs Celtics/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back/i })).toBeInTheDocument();
    // The big "Sports Arena" hero title is gone in compact mode.
    expect(screen.queryByText(/^Sports Arena$/)).toBeNull();
    // Live stats still render with the passed counts.
    expect(screen.getByText(/3 Games Live/i)).toBeInTheDocument();
    expect(screen.getByText(/500/)).toBeInTheDocument();
  });
});
