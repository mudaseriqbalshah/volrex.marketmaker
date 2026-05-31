import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MarketMakerScheduler } from "@/lib/engine/schedulers/marketMaker";

describe("MarketMakerScheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("emits Buy when price is below the target band", async () => {
    const emit = vi.fn();
    // target = 1_000_000, price = 900_000 (below low=980_000 for tol=2%)
    const s = new MarketMakerScheduler({
      wallets: ["w1"],
      tokenAddress: "0xt",
      slippageBps: 200,
      intervalMs: 100,
      amountMin: "1",
      amountMax: "1",
      amountMode: "absolute",
      getPrice: vi.fn().mockResolvedValue(900_000n),
      unitToken: 10n ** 18n,
      targetPrice: 1_000_000n,
      toleranceBps: 200,
      emit,
      rng: () => 0.5,
    });
    s.start();
    await vi.advanceTimersByTimeAsync(150);
    expect(emit).toHaveBeenCalled();
    expect(emit.mock.calls[0]?.[0].kind).toBe("Buy");
    s.stop();
  });

  it("emits Sell when price is above the target band", async () => {
    const emit = vi.fn();
    const s = new MarketMakerScheduler({
      wallets: ["w1"],
      tokenAddress: "0xt",
      slippageBps: 200,
      intervalMs: 100,
      amountMin: "1",
      amountMax: "1",
      amountMode: "absolute",
      getPrice: vi.fn().mockResolvedValue(1_100_000n),
      unitToken: 10n ** 18n,
      targetPrice: 1_000_000n,
      toleranceBps: 200,
      emit,
      rng: () => 0.5,
    });
    s.start();
    await vi.advanceTimersByTimeAsync(150);
    expect(emit).toHaveBeenCalled();
    expect(emit.mock.calls[0]?.[0].kind).toBe("Sell");
    s.stop();
  });

  it("emits random Buy or Sell when price is within band", async () => {
    const emit = vi.fn();
    const s = new MarketMakerScheduler({
      wallets: ["w1"],
      tokenAddress: "0xt",
      slippageBps: 200,
      intervalMs: 100,
      amountMin: "1",
      amountMax: "1",
      amountMode: "absolute",
      getPrice: vi.fn().mockResolvedValue(1_000_000n),
      unitToken: 10n ** 18n,
      targetPrice: 1_000_000n,
      toleranceBps: 200,
      emit,
      rng: () => 0.3, // < 0.5 → Buy in neutral branch
    });
    s.start();
    await vi.advanceTimersByTimeAsync(150);
    expect(emit.mock.calls[0]?.[0].kind).toBe("Buy");
    s.stop();
  });

  it("captures target from first price tick when targetPrice is undefined", async () => {
    const emit = vi.fn();
    const onTick = vi.fn();
    const s = new MarketMakerScheduler({
      wallets: ["w1"],
      tokenAddress: "0xt",
      slippageBps: 200,
      intervalMs: 100,
      amountMin: "1",
      amountMax: "1",
      amountMode: "absolute",
      getPrice: vi.fn().mockResolvedValue(500_000n),
      unitToken: 10n ** 18n,
      toleranceBps: 200,
      emit,
      onTick,
      rng: () => 0.5,
    });
    s.start();
    await vi.advanceTimersByTimeAsync(150);
    expect(onTick.mock.calls[0]?.[0].target).toBe(500_000n);
    s.stop();
  });
});
