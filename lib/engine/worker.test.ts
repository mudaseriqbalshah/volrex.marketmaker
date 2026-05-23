import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ActionQueue } from "@/lib/engine/queue";
import { Worker } from "@/lib/engine/worker";
import type { Action, NewAction } from "@/lib/engine/types";

const persist = vi.fn().mockResolvedValue(undefined);
const buy = (walletId: string): NewAction => ({
  kind: "Buy",
  walletId,
  params: { tokenAddress: "0xt", amountNative: "1", slippageBps: 100 },
});

describe("Worker", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("drains a queued action by calling dispatch, marks done on success", async () => {
    const q = new ActionQueue([], persist);
    const a = await q.enqueue(buy("w1"));
    const dispatch = vi.fn().mockResolvedValue({ txHash: "0xhash", receiptStatus: 1 });
    const w = new Worker({ queue: q, dispatch, maxConcurrent: 5, tickMs: 100 });
    w.start();
    await vi.advanceTimersByTimeAsync(150);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ id: a.id }));
    expect(q.get(a.id)?.status).toBe("done");
    expect(q.get(a.id)?.txHash).toBe("0xhash");
    w.stop();
  });

  it("processes only one action per wallet at a time", async () => {
    const q = new ActionQueue([], persist);
    await q.enqueue(buy("w1"));
    await q.enqueue(buy("w1"));
    let inFlight = 0;
    let maxSeen = 0;
    const dispatch = vi.fn().mockImplementation(async (_a: Action) => {
      inFlight += 1; maxSeen = Math.max(maxSeen, inFlight);
      await new Promise((r) => setTimeout(r, 50));
      inFlight -= 1;
      return { txHash: "0xh", receiptStatus: 1 };
    });
    const w = new Worker({ queue: q, dispatch, maxConcurrent: 5, tickMs: 10 });
    w.start();
    await vi.advanceTimersByTimeAsync(300);
    expect(maxSeen).toBe(1);
    w.stop();
  });

  it("processes wallets in parallel up to maxConcurrent", async () => {
    const q = new ActionQueue([], persist);
    await q.enqueue(buy("w1"));
    await q.enqueue(buy("w2"));
    await q.enqueue(buy("w3"));
    let inFlight = 0; let maxSeen = 0;
    const dispatch = vi.fn().mockImplementation(async () => {
      inFlight += 1; maxSeen = Math.max(maxSeen, inFlight);
      await new Promise((r) => setTimeout(r, 50));
      inFlight -= 1;
      return { txHash: "0xh", receiptStatus: 1 };
    });
    const w = new Worker({ queue: q, dispatch, maxConcurrent: 2, tickMs: 10 });
    w.start();
    await vi.advanceTimersByTimeAsync(200);
    expect(maxSeen).toBe(2);
    w.stop();
  });

  it("requeues on retriable failure (attempts < 3)", async () => {
    const q = new ActionQueue([], persist);
    const a = await q.enqueue(buy("w1"));
    let calls = 0;
    const dispatch = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls < 2) throw Object.assign(new Error("nonce too low"), { code: "NONCE_EXPIRED" });
      return { txHash: "0xh", receiptStatus: 1 };
    });
    const w = new Worker({ queue: q, dispatch, maxConcurrent: 5, tickMs: 10 });
    w.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(q.get(a.id)?.status).toBe("done");
    expect(q.get(a.id)?.attempts).toBeGreaterThanOrEqual(1);
    w.stop();
  });

  it("marks failed without retry on revert", async () => {
    const q = new ActionQueue([], persist);
    const a = await q.enqueue(buy("w1"));
    const dispatch = vi.fn().mockRejectedValue(Object.assign(new Error("call exception"), { code: "CALL_EXCEPTION", reason: "INSUFFICIENT_OUTPUT" }));
    const w = new Worker({ queue: q, dispatch, maxConcurrent: 5, tickMs: 10 });
    w.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(q.get(a.id)?.status).toBe("failed");
    expect(dispatch).toHaveBeenCalledTimes(1);
    w.stop();
  });

  it("drain mode finishes in-flight and stops taking new", async () => {
    const q = new ActionQueue([], persist);
    await q.enqueue(buy("w1"));
    const dispatch = vi.fn().mockResolvedValue({ txHash: "0xh", receiptStatus: 1 });
    const w = new Worker({ queue: q, dispatch, maxConcurrent: 5, tickMs: 10 });
    w.start();
    w.drain();
    await q.enqueue(buy("w2")); // post-drain
    await vi.advanceTimersByTimeAsync(200);
    expect(dispatch.mock.calls.some((c) => (c[0] as Action).walletId === "w2")).toBe(false);
    w.stop();
  });
});
