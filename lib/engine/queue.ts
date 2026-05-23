import type { Action, ActionStatus, NewAction } from "@/lib/engine/types";

export type Persist = (snapshot: Action[]) => Promise<void>;

function newId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class ActionQueue {
  private items: Map<string, Action> = new Map();

  constructor(initial: Action[], private persist: Persist) {
    for (const a of initial) this.items.set(a.id, a);
  }

  all(): Action[] {
    return [...this.items.values()];
  }

  get(id: string): Action | undefined {
    return this.items.get(id);
  }

  async enqueue(na: NewAction): Promise<Action> {
    const a = { ...(na as object), id: newId(), createdAt: Date.now(), status: "queued" as ActionStatus, attempts: 0 } as Action;
    this.items.set(a.id, a);
    await this.flush();
    return a;
  }

  private byWallet(walletId: string): Action[] {
    return [...this.items.values()].filter((a) => a.walletId === walletId);
  }

  oldestQueuedFor(walletId: string): Action | undefined {
    return this.byWallet(walletId)
      .filter((a) => a.status === "queued")
      .sort((a, b) => a.createdAt - b.createdAt)[0];
  }

  isWalletBusy(walletId: string): boolean {
    return this.byWallet(walletId).some((a) => a.status === "running");
  }

  async markRunning(id: string): Promise<void> {
    const a = this.items.get(id);
    if (!a) return;
    a.status = "running";
    a.startedAt = Date.now();
    await this.flush();
  }

  async markDone(id: string, txHash: string): Promise<void> {
    const a = this.items.get(id);
    if (!a) return;
    a.status = "done";
    a.txHash = txHash;
    a.completedAt = Date.now();
    await this.flush();
  }

  async markFailed(id: string, error: { code: string; message: string }): Promise<void> {
    const a = this.items.get(id);
    if (!a) return;
    a.status = "failed";
    a.lastError = error;
    a.completedAt = Date.now();
    await this.flush();
  }

  async requeue(id: string): Promise<void> {
    const a = this.items.get(id);
    if (!a) return;
    a.status = "queued";
    a.attempts += 1;
    a.startedAt = undefined;
    a.completedAt = undefined;
    await this.flush();
  }

  async remove(id: string): Promise<void> {
    this.items.delete(id);
    await this.flush();
  }

  private async flush(): Promise<void> {
    await this.persist(this.all());
  }
}
