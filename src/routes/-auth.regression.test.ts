import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (rel: string) =>
  readFileSync(resolve(__dirname, "..", rel), "utf8");

describe("Auth page redirection and onboarding flow regression", () => {
  const route = read("routes/auth.tsx");

  it("forces newly signed up users to go to the dashboard directly, ignoring the redirect search query", () => {
    // Mode signup target must be /dashboard
    expect(route).toMatch(/const target = mode === "signup" \? "\/dashboard" : \(safeRedirect \?\? fallback\);/);
  });

  it("switches to the sign-in mode/card if email verification is required upon signup", () => {
    // SignUpCard success branches must switch to signin mode via onSwitch() if data.session is missing
    expect(route).toMatch(/if \(data\.session\) \{[\s\S]*?toast\.success\("Account created — welcome to PGX!"\);[\s\S]*?\} else \{[\s\S]*?toast\.success\("Account created — check your email to confirm."\);[\s\S]*?onSwitch\(\);[\s\S]*?\}/);
  });
});
