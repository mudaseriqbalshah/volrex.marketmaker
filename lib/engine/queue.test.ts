import { describe, it, expect, beforeEach, vi } from "vitest";
import { ActionQueue } from "@/lib/engine/queue";
import type { NewAction } from "@/lib/engine/types";

const persist = vi.fn().mockResolvedValue(undefined);
const buy: NewAction = { kind: "Buy", walletId: "w1", params: { tokenAddress: "0xt", amountNative: "1.0", slippageBps: 100 } };

describe("ActionQueue", () => {
  beforeEach(() => persist.mockClear());

  it("enqueue assigns id + queued status", async () => {
    const q = new ActionQueue([], persist);
    const a = await q.enqueue(buy);
    expect(a.id).toMatch(/.+/);
    expect(a.status).toBe("queued");
    expect(a.attempts).toBe(0);
    expect(persist).toHaveBeenCalled();
  });

  it("oldestQueuedFor returns oldest queued action for a wallet", async () => {
    const q = new ActionQueue([], persist);
    await q.enqueue(buy);
    await q.enqueue({ ...buy, walletId: "w2" });
    await q.enqueue(buy);
    const next = q.oldestQueuedFor("w1");
    expect(next?.walletId).toBe("w1");
  });

  it("markRunning / markDone update the action", async () => {
    const q = new ActionQueue([], persist);
    const a = await q.enqueue(buy);
    await q.markRunning(a.id);
    expect(q.get(a.id)?.status).toBe("running");
    await q.markDone(a.id, "0xhash");
    expect(q.get(a.id)?.status).toBe("done");
    expect(q.get(a.id)?.txHash).toBe("0xhash");
  });

  it("markFailed records error", async () => {
    const q = new ActionQueue([], persist);
    const a = await q.enqueue(buy);
    await q.markFailed(a.id, { code: "revert", message: "INSUFFICIENT_OUTPUT" });
    expect(q.get(a.id)?.status).toBe("failed");
    expect(q.get(a.id)?.lastError?.code).toBe("revert");
  });

  it("requeue resets to queued and increments attempts", async () => {
    const q = new ActionQueue([], persist);
    const a = await q.enqueue(buy);
    await q.markRunning(a.id);
    await q.markFailed(a.id, { code: "nonce", message: "low" });
    await q.requeue(a.id);
    const cur = q.get(a.id);
    expect(cur?.status).toBe("queued");
    expect(cur?.attempts).toBe(1);
  });

  it("hydrate restores from snapshot", () => {
    const q = new ActionQueue(
      [
        { id: "x", kind: "Buy", walletId: "w1", params: { tokenAddress: "0xt", amountNative: "1", slippageBps: 100 }, createdAt: 1, status: "queued", attempts: 0 },
      ],
      persist,
    );
    expect(q.all()).toHaveLength(1);
    expect(q.get("x")?.kind).toBe("Buy");
  });

  it("isWalletBusy returns true while a wallet has a running action", async () => {
    const q = new ActionQueue([], persist);
    const a = await q.enqueue(buy);
    expect(q.isWalletBusy("w1")).toBe(false);
    await q.markRunning(a.id);
    expect(q.isWalletBusy("w1")).toBe(true);
  });
});
