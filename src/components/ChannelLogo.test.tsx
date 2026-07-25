import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ChannelLogo } from "./ChannelLogo";

afterEach(cleanup);

describe("ChannelLogo", () => {
  it("renders the placeholder when src is null", () => {
    const { container } = render(<ChannelLogo src={null} />);
    expect(container.querySelector("img")).toBeNull();
    // lucide-react renders an <svg> for the Tv fallback icon.
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders the placeholder when src is undefined", () => {
    const { container } = render(<ChannelLogo src={undefined} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders the <img> when a src is provided", () => {
    render(<ChannelLogo src="https://example.com/logo.png" alt="Logo" />);
    expect(screen.getByAltText("Logo")).toBeTruthy();
  });

  it("falls back to the placeholder when the image fails to load", () => {
    const { container } = render(
      <ChannelLogo src="https://example.com/broken.png" alt="Logo" />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    fireEvent.error(img!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
