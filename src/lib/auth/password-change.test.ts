import { beforeAll, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

process.env.REQORA_DB_PATH = ":memory:";

let store: typeof import("./store");
beforeAll(async () => {
  store = await import("./store");
});

describe("updatePassword", () => {
  it("stores the new hash and signs out every session except the current one", async () => {
    const user = store.insertUser({ email: "pw@example.com", name: "PW", passwordHash: await hashPassword("old-password-1") });
    const here = store.createSession(user.id, 60_000);
    const elsewhere = store.createSession(user.id, 60_000);
    const other = store.insertUser({ email: "other@example.com", name: "O", passwordHash: "x" });
    const otherSession = store.createSession(other.id, 60_000);

    store.updatePassword(user.id, await hashPassword("new-password-2"), here.token);

    expect(await verifyPassword("new-password-2", store.passwordHashOf(user.id)!)).toBe(true);
    expect(await verifyPassword("old-password-1", store.passwordHashOf(user.id)!)).toBe(false);
    expect(store.userForSession(here.token)?.id).toBe(user.id);
    expect(store.userForSession(elsewhere.token)).toBeUndefined();
    expect(store.userForSession(otherSession.token)?.id).toBe(other.id); // other users unaffected
  });
});
