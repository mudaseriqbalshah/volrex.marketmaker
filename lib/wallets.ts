import { Wallet, type JsonRpcProvider } from "ethers";

export function makeSigner(privateKey: string, provider: JsonRpcProvider): Wallet {
  return new Wallet(privateKey, provider);
}

type Update = { addr: string; bal: bigint };
type Listener = (u: Update) => void;

export class BalanceWatcher {
  private addresses = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners: Listener[] = [];

  constructor(private provider: Pick<JsonRpcProvider, "getBalance">, private intervalMs: number) {}

  trackNative(addr: string): void {
    this.addresses.add(addr);
  }

  untrack(addr: string): void {
    this.addresses.delete(addr);
  }

  onUpdate(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    for (const addr of this.addresses) {
      try {
        const bal = await this.provider.getBalance(addr);
        for (const l of this.listeners) l({ addr, bal });
      } catch {
        // swallow; balance polling is best-effort
      }
    }
  }
}
