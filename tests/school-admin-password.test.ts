import { describe, it, expect } from "vitest";
import { scryptSync } from "node:crypto";
import { hashPassword, verifyPassword } from "../src/auth/password.js";
describe("School admin password security", () => {
  it("uses the exact native scrypt parameters, salt and output size", async () => {
    const password = "Qa-Control!2026";
    const first = await hashPassword(password),
      second = await hashPassword(password);
    expect(first).not.toBe(second);
    const [algorithm, salt, hash] = first.split("$");
    expect(algorithm).toBe("scrypt");
    expect(Buffer.from(salt, "base64url")).toHaveLength(16);
    expect(Buffer.from(hash, "base64url")).toHaveLength(64);
    expect(
      scryptSync(password, Buffer.from(salt, "base64url"), 64, {
        N: 16384,
        r: 8,
        p: 1,
        maxmem: 64 * 1024 * 1024,
      }).toString("base64url"),
    ).toBe(hash);
    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword("Wrong-Password", first)).toBe(false);
  });
  it("fails closed on corrupt hash formats and repeated characters", async () => {
    for (const hash of [
      "",
      "scrypt",
      "scrypt$bad$bad",
      "argon2$bad$bad",
      "scrypt$" + "x".repeat(10000) + "$bad",
    ])
      expect(await verifyPassword("Qa-Control!2026", hash)).toBe(false);
    for (const value of [
      "a".repeat(8),
      "\n".repeat(8),
      "😀".repeat(8),
      "PASSWORD123",
    ])
      await expect(hashPassword(value)).rejects.toThrow();
  });
});
