import { describe, it, expect } from "vitest";
import { canBuy, canSell, canTransferBack } from "@/lib/engine/eligibility";

describe("eligibility", () => {
  it("canBuy true when native >= amount + gas buffer", () => {
    expect(canBuy({ native: 100n, amount: 50n, gasBuffer: 10n })).toBe(true);
    expect(canBuy({ native: 100n, amount: 95n, gasBuffer: 10n })).toBe(false);
  });

  it("canSell true when token >= amount and gas covered", () => {
    expect(canSell({ tokenBal: 100n, amount: 50n, native: 5n, gasBuffer: 1n })).toBe(true);
    expect(canSell({ tokenBal: 40n, amount: 50n, native: 5n, gasBuffer: 1n })).toBe(false);
    expect(canSell({ tokenBal: 100n, amount: 50n, native: 0n, gasBuffer: 1n })).toBe(false);
  });

  it("canTransferBack respects dust buffer for native", () => {
    expect(canTransferBack({ balance: 100n, amount: 90n, buffer: 5n })).toBe(true);
    expect(canTransferBack({ balance: 100n, amount: 96n, buffer: 5n })).toBe(false);
  });
});
