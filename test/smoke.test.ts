import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("crypto.subtle is available", () => {
    expect(globalThis.crypto.subtle).toBeDefined();
  });
});
