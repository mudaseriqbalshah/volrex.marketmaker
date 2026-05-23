import type { ActionKind, ActionStatus } from "@/lib/engine/types";

export type LogEntry = {
  ts: number;
  walletId: string;
  kind: ActionKind;
  status: ActionStatus;
  txHash?: string;
  errorCode?: string;
  errorMessage?: string;
};

type Persist = (entries: LogEntry[]) => Promise<void>;

export class ActionLogger {
  private entries: LogEntry[];
  constructor(initial: LogEntry[], private persist: Persist, private maxEntries: number) {
    this.entries = [...initial];
  }

  all(): LogEntry[] {
    return [...this.entries];
  }

  async append(entry: LogEntry): Promise<void> {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries);
    await this.persist(this.all());
  }

  filter(q: { walletId?: string; kind?: ActionKind; status?: ActionStatus }): LogEntry[] {
    return this.entries.filter((e) => {
      if (q.walletId && e.walletId !== q.walletId) return false;
      if (q.kind && e.kind !== q.kind) return false;
      if (q.status && e.status !== q.status) return false;
      return true;
    });
  }

  async clear(): Promise<void> {
    this.entries = [];
    await this.persist([]);
  }
}
