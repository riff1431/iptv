import { describe, expect, it } from "vitest";

import { getEmptyXtreamManifestError } from "./playlist";

describe("Xtream manifest response handling", () => {
  it("classifies an empty HTTP 458 response as an account/provider rejection", () => {
    expect(getEmptyXtreamManifestError(458, " \r\n")).toContain("connection limit");
  });

  it("allows a non-empty HTTP 458 manifest to continue through playlist rewriting", () => {
    expect(getEmptyXtreamManifestError(458, "#EXTM3U\nsegment.ts")).toBeNull();
  });

  it("does not reinterpret standard HTTP statuses", () => {
    expect(getEmptyXtreamManifestError(502, "")).toBeNull();
  });
});
