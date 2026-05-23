import { describe, it, expect, beforeEach } from "vitest";
import { writeEncrypted, readEncrypted, removeKey, hasKey } from "@/lib/storage";
import { deriveKey, randomBytes } from "@/lib/crypto";

describe("encrypted storage", () => {
  beforeEach(() => localStorage.clear());

  it("writes then reads back", async () => {
    const key = await deriveKey("p", randomBytes(16));
    await writeEncrypted("foo", { a: 1, b: "two" }, key);
    const value = await readEncrypted<{ a: number; b: string }>("foo", key);
    expect(value).toEqual({ a: 1, b: "two" });
  });

  it("hasKey reflects presence", async () => {
    const key = await deriveKey("p", randomBytes(16));
    expect(hasKey("missing")).toBe(false);
    await writeEncrypted("here", { x: 1 }, key);
    expect(hasKey("here")).toBe(true);
  });

  it("removeKey deletes", async () => {
    const key = await deriveKey("p", randomBytes(16));
    await writeEncrypted("gone", { x: 1 }, key);
    removeKey("gone");
    expect(hasKey("gone")).toBe(false);
  });

  it("reading missing key returns null", async () => {
    const key = await deriveKey("p", randomBytes(16));
    expect(await readEncrypted("nope", key)).toBeNull();
  });

  it("wrong key throws", async () => {
    const k1 = await deriveKey("a", randomBytes(16));
    const k2 = await deriveKey("b", randomBytes(16));
    await writeEncrypted("x", { v: 1 }, k1);
    await expect(readEncrypted("x", k2)).rejects.toThrow();
  });
});
