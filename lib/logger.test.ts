import { describe, it, expect, beforeEach, vi } from "vitest";
import { ActionLogger } from "@/lib/logger";
import type { LogEntry } from "@/lib/logger";

const persist = vi.fn().mockResolvedValue(undefined);

describe("ActionLogger", () => {
  beforeEach(() => persist.mockClear());

  it("append adds entries", async () => {
    const l = new ActionLogger([], persist, 1000);
    await l.append({ ts: 1, walletId: "w1", kind: "Buy", status: "done", txHash: "0xabc" });
    expect(l.all()).toHaveLength(1);
    expect(persist).toHaveBeenCalledWith(l.all());
  });

  it("caps total entries to maxEntries", async () => {
    const l = new ActionLogger([], persist, 3);
    for (let i = 0; i < 5; i++) await l.append({ ts: i, walletId: "w", kind: "Buy", status: "done" });
    expect(l.all()).toHaveLength(3);
    expect(l.all()[0]?.ts).toBe(2); // oldest dropped
  });

  it("filter narrows by wallet/kind/status", async () => {
    const l = new ActionLogger([], persist, 100);
    await l.append({ ts: 1, walletId: "w1", kind: "Buy", status: "done" });
    await l.append({ ts: 2, walletId: "w2", kind: "Sell", status: "failed" });
    await l.append({ ts: 3, walletId: "w1", kind: "Sell", status: "done" });
    expect(l.filter({ walletId: "w1" })).toHaveLength(2);
    expect(l.filter({ kind: "Sell" })).toHaveLength(2);
    expect(l.filter({ status: "failed" })).toHaveLength(1);
  });

  it("hydrate accepts initial entries", () => {
    const initial: LogEntry[] = [{ ts: 1, walletId: "w1", kind: "Buy", status: "done" }];
    const l = new ActionLogger(initial, persist, 100);
    expect(l.all()).toHaveLength(1);
  });
});
