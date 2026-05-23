import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RoundRobinScheduler } from "@/lib/engine/schedulers/roundRobin";

describe("RoundRobinScheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("cycles through wallets in order", async () => {
    const emit = vi.fn();
    const s = new RoundRobinScheduler({
      wallets: ["w1", "w2", "w3"],
      tokenAddress: "0xt",
      buyRatio: 1, slippageBps: 100,
      cycleDelayMs: 100,
      amountPerWallet: "1",
      eligibleBuy: () => true, eligibleSell: () => true,
      emit,
      rng: () => 0.5,
    });
    s.start();
    await vi.advanceTimersByTimeAsync(450);
    expect(emit.mock.calls.length).toBeGreaterThanOrEqual(3);
    const wallets = emit.mock.calls.slice(0, 3).map((c) => c[0].walletId);
    expect(new Set(wallets).size).toBe(3);
    s.stop();
  });

  it("skips ineligible wallets but continues cycle", async () => {
    const emit = vi.fn();
    const s = new RoundRobinScheduler({
      wallets: ["w1", "w2"],
      tokenAddress: "0xt",
      buyRatio: 1, slippageBps: 100,
      cycleDelayMs: 100,
      amountPerWallet: "1",
      eligibleBuy: (id) => id === "w2",
      eligibleSell: () => true,
      emit,
      rng: () => 0,
    });
    s.start();
    await vi.advanceTimersByTimeAsync(300);
    const wallets = emit.mock.calls.map((c) => c[0].walletId);
    expect(wallets.every((w) => w === "w2")).toBe(true);
    s.stop();
  });
});
