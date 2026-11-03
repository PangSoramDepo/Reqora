import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { scrub } from "../workflows/runner";
import { decrypt, encrypt } from "./crypto";

const key = randomBytes(32);

describe("secret encryption", () => {
  it("round-trips and never stores plaintext", () => {
    const sealed = encrypt("sk_live_abc123", "reqora:variable:production:STRIPE", key);
    expect(sealed).not.toContain("sk_live");
    expect(decrypt(sealed, "reqora:variable:production:STRIPE", key)).toBe("sk_live_abc123");
  });

  it("uses a fresh IV per encryption", () => {
    expect(encrypt("same", "ctx", key)).not.toBe(encrypt("same", "ctx", key));
  });

  it("rejects ciphertext moved to another variable or environment", () => {
    const sealed = encrypt("value", "reqora:variable:production:A", key);
    expect(() => decrypt(sealed, "reqora:variable:staging:A", key)).toThrow();
    expect(() => decrypt(sealed, "reqora:variable:production:B", key)).toThrow();
  });

  it("rejects tampered ciphertext and wrong keys", () => {
    const sealed = Buffer.from(encrypt("value", "ctx", key), "base64");
    sealed[sealed.length - 1] ^= 1;
    expect(() => decrypt(sealed.toString("base64"), "ctx", key)).toThrow();
    expect(() => decrypt(encrypt("value", "ctx", key), "ctx", randomBytes(32))).toThrow();
  });
});

describe("scrub", () => {
  it("removes secret values anywhere in nested output", () => {
    const run = { steps: [{ output: { body: { echo: "Bearer sk_live_abc123", list: ["sk_live_abc123"] }, status: 200 } }] };
    expect(scrub(run, ["sk_live_abc123"])).toEqual({
      steps: [{ output: { body: { echo: "Bearer [secret]", list: ["[secret]"] }, status: 200 } }],
    });
  });
});
