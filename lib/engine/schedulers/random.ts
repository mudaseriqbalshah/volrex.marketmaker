import type { NewAction } from "@/lib/engine/types";

export type RandomSchedulerOpts = {
  wallets: string[];
  tokenAddress: string;
  buyRatio: number;       // 0..1
  slippageBps: number;
  minDelayMs: number;
  maxDelayMs: number;
  minAmount: string;      // human-readable amount as string
  maxAmount: string;
  eligibleBuy: (walletId: string, amount: string) => boolean;
  eligibleSell: (walletId: string, amount: string) => boolean;
  emit: (a: NewAction) => void;
  rng?: () => number;
};

function uniform(min: number, max: number, rng: () => number): number {
  return min + rng() * (max - min);
}

function uniformDecimal(minStr: string, maxStr: string, rng: () => number): string {
  const min = Number(minStr);
  const max = Number(maxStr);
  return uniform(min, max, rng).toFixed(8);
}

export class RandomScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private rng: () => number;
  private opts: RandomSchedulerOpts;

  constructor(opts: RandomSchedulerOpts) {
    this.opts = opts;
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
    const delay = uniform(this.opts.minDelayMs, this.opts.maxDelayMs, this.rng);
    this.timer = setTimeout(() => this.fire(), delay);
  }

  private fire(): void {
    if (this.opts.wallets.length === 0) return this.scheduleNext();
    const wallet = this.opts.wallets[Math.floor(this.rng() * this.opts.wallets.length)] as string;
    const side: "Buy" | "Sell" = this.rng() < this.opts.buyRatio ? "Buy" : "Sell";
    const amount = uniformDecimal(this.opts.minAmount, this.opts.maxAmount, this.rng);
    if (side === "Buy") {
      if (this.opts.eligibleBuy(wallet, amount)) {
        this.opts.emit({ kind: "Buy", walletId: wallet, params: { tokenAddress: this.opts.tokenAddress, amountNative: amount, slippageBps: this.opts.slippageBps } });
      }
    } else {
      if (this.opts.eligibleSell(wallet, amount)) {
        this.opts.emit({ kind: "Sell", walletId: wallet, params: { tokenAddress: this.opts.tokenAddress, amountToken: amount, slippageBps: this.opts.slippageBps } });
      }
    }
    this.scheduleNext();
  }
}
