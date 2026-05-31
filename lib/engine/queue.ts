import type { Action, ActionStatus, NewAction } from "@/lib/engine/types";

export type Persist = (snapshot: Action[]) => Promise<void>;

function newId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class ActionQueue {
  private items: Map<string, Action> = new Map();

  // Maximum total items to keep. When exceeded, the OLDEST completed
  // items (done/failed) are auto-trimmed on flush. Queued / running items
  // are never dropped. Prevents unbounded growth that makes persist slow
  // and the Actions table sluggish to render.
  constructor(initial: Action[], private persist: Persist, private maxKept: number = 1000) {
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

  // Bulk-add many actions with a single persist call. Much faster than
  // awaiting enqueue() in a loop for large batches (one encrypt + write
  // instead of N).
  async enqueueBatch(nas: NewAction[]): Promise<Action[]> {
    if (nas.length === 0) return [];
    const now = Date.now();
    const added: Action[] = nas.map((na) => ({
      ...(na as object),
      id: newId(),
      createdAt: now,
      status: "queued" as ActionStatus,
      attempts: 0,
    } as Action));
    for (const a of added) this.items.set(a.id, a);
    await this.flush();
    return added;
  }

  // Remove every action regardless of status. Used by the "Clear all"
  // button on the Actions page when the user wants to start fresh.
  async clear(): Promise<void> {
    this.items.clear();
    await this.flush();
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

  // Remove many items in one persist call. Much faster than awaiting
  // remove() in a loop for large bulk operations like "Clear queued"
  // when the queue has hundreds of items.
  async removeMany(ids: string[]): Promise<number> {
    let removed = 0;
    for (const id of ids) {
      if (this.items.delete(id)) removed += 1;
    }
    if (removed > 0) await this.flush();
    return removed;
  }

  // Filter-and-remove. Returns the count removed. One persist call.
  async removeWhere(predicate: (a: Action) => boolean): Promise<number> {
    const toDelete: string[] = [];
    for (const a of this.items.values()) {
      if (predicate(a)) toDelete.push(a.id);
    }
    return this.removeMany(toDelete);
  }

  private trimIfOverCap(): void {
    if (this.items.size <= this.maxKept) return;
    // Drop the oldest done/failed first; never drop queued/running.
    const finished = [...this.items.values()]
      .filter((a) => a.status === "done" || a.status === "failed")
      .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));
    let toRemove = this.items.size - this.maxKept;
    for (const a of finished) {
      if (toRemove <= 0) break;
      this.items.delete(a.id);
      toRemove -= 1;
    }
  }

  private async flush(): Promise<void> {
    this.trimIfOverCap();
    await this.persist(this.all());
  }
}
