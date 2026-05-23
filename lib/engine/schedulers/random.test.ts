import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RandomScheduler } from "@/lib/engine/schedulers/random";

describe("RandomScheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("emits buy or sell respecting buyRatio", async () => {
    const emit = vi.fn();
    let rand = 0;
    const rng = () => { rand = (rand + 0.1) % 1; return rand; };
    const s = new RandomScheduler({
      wallets: ["w1", "w2"],
      tokenAddress: "0xt",
      buyRatio: 0.5, slippageBps: 100,
      minDelayMs: 100, maxDelayMs: 100,
      minAmount: "1", maxAmount: "1",
      eligibleBuy: () => true, eligibleSell: () => true,
      emit,
      rng,
    });
    s.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(emit).toHaveBeenCalled();
    const kinds = emit.mock.calls.map((c) => c[0].kind);
    expect(kinds.every((k) => k === "Buy" || k === "Sell")).toBe(true);
    s.stop();
  });

  it("skips ineligible wallets", async () => {
    const emit = vi.fn();
    const s = new RandomScheduler({
      wallets: ["w1"],
      tokenAddress: "0xt",
      buyRatio: 1, slippageBps: 100,
      minDelayMs: 100, maxDelayMs: 100,
      minAmount: "1", maxAmount: "1",
      eligibleBuy: () => false, eligibleSell: () => false,
      emit,
      rng: () => 0.5,
    });
    s.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(emit).not.toHaveBeenCalled();
    s.stop();
  });

  it("stop halts emissions", async () => {
    const emit = vi.fn();
    const s = new RandomScheduler({
      wallets: ["w1"],
      tokenAddress: "0xt",
      buyRatio: 1, slippageBps: 100,
      minDelayMs: 100, maxDelayMs: 100,
      minAmount: "1", maxAmount: "1",
      eligibleBuy: () => true, eligibleSell: () => true,
      emit, rng: () => 0.5,
    });
    s.start();
    s.stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(emit).not.toHaveBeenCalled();
  });
});
