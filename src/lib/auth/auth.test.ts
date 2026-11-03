import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";
import { clearFailures, recordFailure, retryAfter } from "./rate-limit";
import { safeNext } from "./next-path";

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const hash = await hashPassword("correct-horse-battery");
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(hash).not.toContain("correct-horse");
    expect(await verifyPassword("correct-horse-battery", hash)).toBe(true);
    expect(await verifyPassword("correct-horse-batterY", hash)).toBe(false);
  });

  it("salts every hash and rejects malformed input", async () => {
    expect(await hashPassword("same-password!")).not.toBe(await hashPassword("same-password!"));
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
  });
});

describe("safeNext", () => {
  it("allows only same-site relative paths", () => {
    expect(safeNext("/flow/wf_1?x=1")).toBe("/flow/wf_1?x=1");
    // Browsers treat "/\host" like "//host" (protocol-relative).
    for (const bad of ["https://evil.test", "//evil.test", String.raw`/\evil.test`, "javascript:alert(1)", null, ""]) {
      expect(safeNext(bad)).toBe("/");
    }
  });
});

describe("login rate limit", () => {
  it("locks a key after 5 failures for 15 minutes", () => {
    const key = `test-${Math.random()}`;
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) recordFailure(key, t0);
    expect(retryAfter(key, t0)).toBe(0);
    recordFailure(key, t0);
    expect(retryAfter(key, t0 + 1000)).toBe(899);
    expect(retryAfter(key, t0 + 15 * 60_000 + 1)).toBe(0);
    clearFailures(key);
    expect(retryAfter(key, t0)).toBe(0);
  });
});
