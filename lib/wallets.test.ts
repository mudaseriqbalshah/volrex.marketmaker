import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Wallet } from "ethers";
import { makeSigner, BalanceWatcher } from "@/lib/wallets";

describe("makeSigner", () => {
  it("constructs a Wallet bound to provider", () => {
    const provider = {} as never;
    const w = Wallet.createRandom();
    const signer = makeSigner(w.privateKey, provider);
    expect(signer.address.toLowerCase()).toBe(w.address.toLowerCase());
  });
});

describe("BalanceWatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("polls native balances at the configured interval", async () => {
    const provider = {
      getBalance: vi.fn().mockResolvedValue(123n),
    };
    const watcher = new BalanceWatcher(provider as never, 1000);
    watcher.trackNative("0xabc");
    const updates: Array<{ addr: string; bal: bigint }> = [];
    watcher.onUpdate((u) => updates.push(u));
    watcher.start();
    await vi.advanceTimersByTimeAsync(1100);
    expect(provider.getBalance).toHaveBeenCalledWith("0xabc");
    expect(updates).toContainEqual({ addr: "0xabc", bal: 123n });
    watcher.stop();
  });

  it("stop halts further polling", async () => {
    const provider = { getBalance: vi.fn().mockResolvedValue(0n) };
    const watcher = new BalanceWatcher(provider as never, 1000);
    watcher.trackNative("0xabc");
    watcher.start();
    await vi.advanceTimersByTimeAsync(1100);
    const callsBefore = provider.getBalance.mock.calls.length;
    watcher.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(provider.getBalance.mock.calls.length).toBe(callsBefore);
  });
});
