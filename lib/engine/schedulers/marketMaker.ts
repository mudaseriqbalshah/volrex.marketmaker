import type { NewAction } from "@/lib/engine/types";

// Price-aware market-maker scheduler for AMMs.
//
// The strategy is intentionally simple: maintain price inside a band
// around a target. Every interval:
//   1. Read the current pool price via getPrice() (native per 1 token).
//   2. Compare to the target band [target * (1 - tol), target * (1 + tol)].
//   3. If below band → emit a Buy (push price up).
//      If above band → emit a Sell (push price down).
//      If within band → emit a random side (50/50) for natural-looking volume.
//   4. Pick a wallet by round-robin, jitter the amount in [amountMin, amountMax].
//
// targetPrice is captured on first tick if not provided up front — i.e.
// "defend the price observed when I started this scheduler."

export type MarketMakerOpts = {
  wallets: string[];
  tokenAddress: string;
  slippageBps: number;
  intervalMs: number;
  amountMin: string;
  amountMax: string;
  amountMode: "absolute" | "percentage";
  // Quote function: returns the amount of native (in wei) one would
  // receive for selling `unitToken` of the token. The MM uses this as
  // the canonical "price". You typically wire this to:
  //   getAmountsOut(unitToken, [tokenAddress, wethAddress])[1]
  getPrice: () => Promise<bigint>;
  // The unit amount of token used by getPrice. Should be 10**decimals
  // (i.e. exactly 1 token in the smallest unit).
  unitToken: bigint;
  // If undefined, the scheduler captures the price observed at the
  // first tick and uses that as the target.
  targetPrice?: bigint;
  // Band width as basis points. 200 = ±2%.
  toleranceBps: number;
  emit: (a: NewAction) => void;
  rng?: () => number;
  // Optional structured event log: each tick reports what it decided.
  onTick?: (info: {
    price: bigint;
    target: bigint;
    band: { low: bigint; high: bigint };
    decision: "buy" | "sell" | "neutral";
    walletId: string;
    amount: string;
  }) => void;
};

function uniformDecimal(minStr: string, maxStr: string, rng: () => number): string {
  const min = Number(minStr);
  const max = Number(maxStr);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return minStr;
  const v = min + rng() * (max - min);
  return v.toFixed(8);
}

export class MarketMakerScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private idx = 0;
  private rng: () => number;
  private target: bigint | null;

  constructor(private opts: MarketMakerOpts) {
    this.rng = opts.rng ?? Math.random;
    this.target = opts.targetPrice ?? null;
  }

  start(): void {
    this.scheduleNext();
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleNext(): void {
    this.timer = setTimeout(() => void this.tick(), this.opts.intervalMs);
  }

  private async tick(): Promise<void> {
    try {
      const price = await this.opts.getPrice();
      // Lazy-init target on first successful price read.
      if (this.target === null) this.target = price;
      const tolBps = BigInt(Math.max(0, Math.min(10_000, this.opts.toleranceBps)));
      const low = (this.target * (10_000n - tolBps)) / 10_000n;
      const high = (this.target * (10_000n + tolBps)) / 10_000n;

      let decision: "buy" | "sell" | "neutral";
      if (price < low) decision = "buy";
      else if (price > high) decision = "sell";
      else decision = "neutral";

      const wallets = this.opts.wallets;
      if (wallets.length > 0) {
        const walletId = wallets[this.idx % wallets.length] as string;
        this.idx += 1;
        const amount = uniformDecimal(this.opts.amountMin, this.opts.amountMax, this.rng);
        const slip = this.opts.slippageBps;
        const tokenAddress = this.opts.tokenAddress;
        const mode = this.opts.amountMode;

        let side: "buy" | "sell";
        if (decision === "neutral") {
          side = this.rng() < 0.5 ? "buy" : "sell";
        } else {
          side = decision;
        }

        const a: NewAction =
          side === "buy"
            ? {
                kind: "Buy",
                walletId,
                params: {
                  tokenAddress,
                  amountNative: amount,
                  slippageBps: slip,
                  amountMode: mode,
                },
              }
            : {
                kind: "Sell",
                walletId,
                params: {
                  tokenAddress,
                  amountToken: amount,
                  slippageBps: slip,
                  amountMode: mode,
                },
              };
        this.opts.emit(a);
        this.opts.onTick?.({ price, target: this.target, band: { low, high }, decision, walletId, amount });
      }
    } catch (err) {
      // Swallow price-fetch errors; we'll retry on the next tick. We
      // don't want one bad RPC call to kill the scheduler entirely.
      this.opts.onTick?.({
        price: 0n,
        target: this.target ?? 0n,
        band: { low: 0n, high: 0n },
        decision: "neutral",
        walletId: "",
        amount: `error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    this.scheduleNext();
  }
}
