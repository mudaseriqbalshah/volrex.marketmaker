import type { Action } from "@/lib/engine/types";
import type { ActionQueue } from "@/lib/engine/queue";
import { classifyError, ErrorCode, toClassified } from "@/lib/errors";

export type Dispatch = (a: Action) => Promise<{ txHash: string; receiptStatus: number }>;

export type WorkerOpts = {
  queue: ActionQueue;
  dispatch: Dispatch;
  maxConcurrent: number;
  tickMs: number;
};

const MAX_ATTEMPTS = 3;

export class Worker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = new Set<string>(); // wallet ids
  private draining = false;

  constructor(private opts: WorkerOpts) {}

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.tick(), this.opts.tickMs);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  drain(): void {
    this.draining = true;
  }

  resume(): void {
    this.draining = false;
  }

  isDraining(): boolean {
    return this.draining;
  }

  private tick(): void {
    if (this.draining) return;
    if (this.inFlight.size >= this.opts.maxConcurrent) return;
    const seenWallets = new Set<string>();
    for (const a of this.opts.queue.all()) {
      if (a.status !== "queued") continue;
      if (this.inFlight.has(a.walletId)) continue;
      if (this.opts.queue.isWalletBusy(a.walletId)) continue;
      if (seenWallets.has(a.walletId)) continue;
      seenWallets.add(a.walletId);
      if (this.inFlight.size >= this.opts.maxConcurrent) break;
      void this.run(a);
    }
  }

  private async run(a: Action): Promise<void> {
    this.inFlight.add(a.walletId);
    try {
      await this.opts.queue.markRunning(a.id);
      const { txHash, receiptStatus } = await this.opts.dispatch(a);
      if (receiptStatus === 0) {
        await this.opts.queue.markFailed(a.id, { code: ErrorCode.Revert, message: "tx mined but reverted" });
        // revert is not retriable — return without requeueing
        return;
      }
      await this.opts.queue.markDone(a.id, txHash);
    } catch (e) {
      const classified = toClassified(e);
      await this.opts.queue.markFailed(a.id, classified);
      const code = classifyError(e);
      const retriable = code === ErrorCode.Network || code === ErrorCode.Nonce || code === ErrorCode.Gas;
      const cur = this.opts.queue.get(a.id);
      if (retriable && cur && cur.attempts < MAX_ATTEMPTS) {
        await this.opts.queue.requeue(a.id);
      }
    } finally {
      this.inFlight.delete(a.walletId);
    }
  }
}
