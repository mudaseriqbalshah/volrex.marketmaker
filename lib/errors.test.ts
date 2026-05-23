import { describe, it, expect } from "vitest";
import { classifyError, ErrorCode } from "@/lib/errors";

describe("classifyError", () => {
  it("returns nonce for nonce-related messages", () => {
    expect(classifyError(new Error("nonce too low"))).toBe(ErrorCode.Nonce);
    expect(classifyError(new Error("replacement transaction underpriced"))).toBe(ErrorCode.Nonce);
    expect(classifyError({ code: "NONCE_EXPIRED" })).toBe(ErrorCode.Nonce);
  });

  it("returns gas for gas-related errors", () => {
    expect(classifyError(new Error("transaction underpriced"))).toBe(ErrorCode.Gas);
    expect(classifyError(new Error("intrinsic gas too low"))).toBe(ErrorCode.Gas);
  });

  it("returns network for connectivity errors", () => {
    expect(classifyError({ code: "NETWORK_ERROR" })).toBe(ErrorCode.Network);
    expect(classifyError({ code: "TIMEOUT" })).toBe(ErrorCode.Network);
  });

  it("returns revert for execution reverts", () => {
    expect(classifyError({ code: "CALL_EXCEPTION", reason: "INSUFFICIENT_OUTPUT_AMOUNT" })).toBe(ErrorCode.Revert);
  });

  it("returns unknown for anything else", () => {
    expect(classifyError(new Error("what"))).toBe(ErrorCode.Unknown);
    expect(classifyError("string error")).toBe(ErrorCode.Unknown);
  });
});
