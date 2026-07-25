import { describe, expect, it } from "vitest";
import { parseM3U } from "./m3u-parser";

describe("parseM3U", () => {
  it("parses a basic playlist", () => {
    const text = `#EXTM3U\n#EXTINF:-1 tvg-id="c1" tvg-name="Chan One" tvg-logo="https://l/1.png" group-title="News",Chan One\nhttps://s/1.m3u8\n#EXTINF:-1,Chan Two\nhttps://s/2.m3u8\n`;
    const out = parseM3U(text);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      name: "Chan One",
      logo: "https://l/1.png",
      group: "News",
      tvgId: "c1",
      url: "https://s/1.m3u8",
    });
    expect(out[1]).toMatchObject({ name: "Chan Two", group: null, url: "https://s/2.m3u8" });
  });

  it("handles CRLF, comments, blank lines, empty input", () => {
    expect(parseM3U("")).toEqual([]);
    const text = "#EXTM3U\r\n\r\n# a comment\r\n#EXTINF:-1,Only\r\nhttps://s/x.m3u8\r\n";
    const out = parseM3U(text);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Only");
  });

  it("gives unique ids per channel", () => {
    const text = `#EXTM3U\n#EXTINF:-1,A\nhttps://s/a\n#EXTINF:-1,A\nhttps://s/b\n`;
    const out = parseM3U(text);
    expect(new Set(out.map((c) => c.id)).size).toBe(2);
  });
});
