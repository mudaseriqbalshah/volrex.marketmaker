import { describe, it, expect, vi } from "vitest";
import { LocalNonceTracker } from "@/lib/nonce";

function mockProviderWith(count: number) {
  return { getTransactionCount: vi.fn().mockResolvedValue(count) } as const;
}

describe("LocalNonceTracker", () => {
  it("first next() fetches from provider", async () => {
    const p = mockProviderWith(5);
    const t = new LocalNonceTracker(p as never, "0xabc");
    expect(await t.next()).toBe(5);
    expect(p.getTransactionCount).toHaveBeenCalledWith("0xabc", "pending");
  });

  it("subsequent next() increments locally without provider call", async () => {
    const p = mockProviderWith(5);
    const t = new LocalNonceTracker(p as never, "0xabc");
    await t.next();
    expect(await t.next()).toBe(6);
    expect(await t.next()).toBe(7);
    expect(p.getTransactionCount).toHaveBeenCalledTimes(1);
  });

  it("resync() refetches from provider", async () => {
    const p = { getTransactionCount: vi.fn().mockResolvedValueOnce(5).mockResolvedValueOnce(10) };
    const t = new LocalNonceTracker(p as never, "0xabc");
    await t.next();
    await t.resync();
    expect(await t.next()).toBe(10);
  });
});
