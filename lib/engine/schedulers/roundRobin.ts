import type { NewAction } from "@/lib/engine/types";

export type RoundRobinOpts = {
  wallets: string[];
  tokenAddress: string;
  buyRatio: number;
  slippageBps: number;
  cycleDelayMs: number;
  amountPerWallet: string;
  eligibleBuy: (walletId: string, amount: string) => boolean;
  eligibleSell: (walletId: string, amount: string) => boolean;
  emit: (a: NewAction) => void;
  rng?: () => number;
};

export class RoundRobinScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private idx = 0;
  private rng: () => number;

  constructor(private opts: RoundRobinOpts) {
    this.rng = opts.rng ?? Math.random;
  }

  start(): void {
    this.scheduleNext();
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleNext(): void {
    this.timer = setTimeout(() => this.fire(), this.opts.cycleDelayMs);
  }

  private fire(): void {
    const n = this.opts.wallets.length;
    if (n === 0) return this.scheduleNext();
    const wallet = this.opts.wallets[this.idx % n] as string;
    this.idx += 1;
    const side: "Buy" | "Sell" = this.rng() < this.opts.buyRatio ? "Buy" : "Sell";
    const amount = this.opts.amountPerWallet;
    if (side === "Buy" && this.opts.eligibleBuy(wallet, amount)) {
      this.opts.emit({ kind: "Buy", walletId: wallet, params: { tokenAddress: this.opts.tokenAddress, amountNative: amount, slippageBps: this.opts.slippageBps } });
    } else if (side === "Sell" && this.opts.eligibleSell(wallet, amount)) {
      this.opts.emit({ kind: "Sell", walletId: wallet, params: { tokenAddress: this.opts.tokenAddress, amountToken: amount, slippageBps: this.opts.slippageBps } });
    }
    this.scheduleNext();
  }
}
