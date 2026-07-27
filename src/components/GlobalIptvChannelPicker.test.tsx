import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { resolvePlayback } = vi.hoisted(() => ({
  resolvePlayback: vi.fn(),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-start")>();
  return {
    ...actual,
    useServerFn: () => resolvePlayback,
  };
});

vi.mock("@/hooks/useIptvPlaylist", () => ({
  useIptvPlaylist: () => ({
    data: [
      {
        id: "1536581",
        name: "PRIME: NBA TV HDTV",
        logo: null,
        group: "PRIME SPORTS",
        tvgId: null,
        tvgName: null,
        url: "",
      },
      {
        id: "325025",
        name: "US: BEIN SPORTS HD",
        logo: null,
        group: "US SPORTS",
        tvgId: null,
        tvgName: null,
        url: "",
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/components/HlsPlayer", () => ({
  HlsPlayer: ({ src }: { src: string | null }) => (
    <div data-testid="provider-preview">{src ?? "no-preview"}</div>
  ),
}));

import { GlobalIptvChannelPicker } from "./GlobalIptvChannelPicker";

beforeEach(() => {
  localStorage.clear();
  resolvePlayback.mockReset();
  resolvePlayback.mockResolvedValue({
    url: "/api/public/iptv/channel/1536581/playlist?access=test",
  });
});

afterEach(cleanup);

describe("GlobalIptvChannelPicker", () => {
  it("loads configured-provider channels and resolves preview through the secure relay", async () => {
    const onPick = vi.fn();
    const onOpenChange = vi.fn();
    render(<GlobalIptvChannelPicker open onOpenChange={onOpenChange} onPick={onPick} />);

    expect(screen.getByText(/Pick a channel from your provider/i)).toBeTruthy();
    expect(screen.getByText(/2 cached provider channels available/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /PRIME: NBA TV HDTV/i }));

    await waitFor(() =>
      expect(resolvePlayback).toHaveBeenCalledWith({
        data: { channelId: "1536581" },
      }),
    );
    expect(await screen.findByTestId("provider-preview")).toHaveTextContent(
      "/api/public/iptv/channel/1536581/playlist?access=test",
    );

    fireEvent.click(screen.getByRole("button", { name: /Use this channel/i }));
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "1536581",
        name: "PRIME: NBA TV HDTV",
        categories: ["PRIME SPORTS"],
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
