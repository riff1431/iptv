import { describe, it, expect } from "vitest";
import { saltPassword, PASSWORD_SALT } from "./auth-salt";

describe("auth-salt password salting utility", () => {
  it("salts a simple password correctly", () => {
    const raw = "123456";
    const salted = saltPassword(raw);
    expect(salted).toBe(`123456${PASSWORD_SALT}`);
  });

  it("does not re-salt a password that is already salted", () => {
    const alreadySalted = `123456${PASSWORD_SALT}`;
    const output = saltPassword(alreadySalted);
    expect(output).toBe(alreadySalted);
  });

  it("returns empty string or undefined as is", () => {
    expect(saltPassword("")).toBe("");
  });
});
