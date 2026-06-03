import { parseUnits, formatUnits } from "ethers";
import type { Engine } from "../engine";
import { resolveWalletRange, type MarketCfg } from "../config";
import { MarketMakerScheduler } from "@/lib/engine/schedulers/marketMaker";
import { routerContract, quoteOut } from "@/lib/router";
import { createBalanceCache } from "../eligibility";

// Multi-market market-maker. One scheduler per entry in
// config.markets, all running concurrently inside this single process,
// each pushing actions onto the shared queue. The worker drains the
// queue with the normal per-wallet cooldown rules.
//
// Each market gets its own wallet slice so the schedulers never
// dispatch from the same wallet at the same time — no nonce conflicts.
export async function runMultiMM(engine: Engine): Promise<void> {
  const markets = engine.config.markets ?? [];
  if (markets.length === 0) {
    console.error("config.markets is empty — add at least one market entry");
    process.exit(1);
  }

  // Sanity check: overlapping wallet ranges across markets would cause
  // multiple schedulers to push actions to the same wallet, defeating
  // the nonce-isolation point.
  validateNoOverlap(markets, engine);

  const wethAddress = engine.config.chain.wethAddress;
  const router = routerContract(engine.config.chain.routerAddress, engine.provider);

  // Build one scheduler per market.
  const schedulers: Array<{ stop: () => void }> = [];
  const caches: ReturnType<typeof createBalanceCache>[] = [];

  for (let i = 0; i < markets.length; i++) {
    const m = markets[i]!;
    const wallets = resolveWalletRange(engine.config, m.walletRange);
    if (wallets.length === 0) {
      console.warn(`[${m.token.symbol}] empty wallet range — skipping`);
      continue;
    }
    const walletLabels = wallets.map((w) => w.label);
    const unitToken = 10n ** BigInt(m.token.decimals);
    const path = [m.token.address, wethAddress];

    const getPrice = async (): Promise<bigint> => quoteOut(router as never, unitToken, path);

    // Resolve initial target. Three modes:
    //   1. mmTargetPrice set        → parse as native-per-token literal
    //   2. mmTargetMultiplier set    → multiply currentPrice once at start
    //   3. neither                  → undefined, scheduler captures on first tick
    let targetPrice: bigint | undefined;
    if (m.mmTargetPrice) {
      targetPrice = parseUnits(m.mmTargetPrice, 18);
      console.log(`[${m.token.symbol}] target = ${m.mmTargetPrice} VLRX/token (literal)`);
    } else if (m.mmTargetMultiplier) {
      try {
        const current = await getPrice();
        const multBps = BigInt(Math.round(Number(m.mmTargetMultiplier) * 10_000));
        targetPrice = (current * multBps) / 10_000n;
        console.log(
          `[${m.token.symbol}] current = ${formatUnits(current, 18)} VLRX → target = ${formatUnits(targetPrice, 18)} VLRX (× ${m.mmTargetMultiplier})`,
        );
      } catch {
        console.warn(
          `[${m.token.symbol}] pool not yet quotable — scheduler will auto-capture on first successful tick`,
        );
      }
    } else {
      console.log(`[${m.token.symbol}] target = auto-capture from first tick`);
    }

    // Per-market balance cache. Seeded synchronously so the very
    // first emission has data. Refreshes in the background.
    const cache = createBalanceCache(engine, m.token, walletLabels, `[${m.token.symbol}]`);
    await cache.refreshAll();
    cache.startPolling(15_000);
    caches.push(cache);

    // Pre-seed the decimals cache used by dispatch.ts so it doesn't
    // round-trip to the chain on every action.
    await engine.tokenDecimals(m.token.address);

    const scheduler = new MarketMakerScheduler({
      wallets: walletLabels,
      tokenAddress: m.token.address,
      slippageBps: m.token.defaultSlippageBps,
      intervalMs: m.mmIntervalMs ?? 8_000,
      amountMin: m.amountMin ?? "0.005",
      amountMax: m.amountMax ?? "0.02",
      amountMode: m.amountMode ?? "absolute",
      buyAmountMode: m.mmBuyMode,
      buyAmountMin: m.mmBuyMin,
      buyAmountMax: m.mmBuyMax,
      sellAmountMode: m.mmSellMode,
      sellAmountMin: m.mmSellMin,
      sellAmountMax: m.mmSellMax,
      getPrice,
      unitToken,
      targetPrice,
      toleranceBps: m.mmToleranceBps ?? 200,
      emit: cache.tryEnqueue,
      onTick: ({ price, target: t, decision, walletId, amount }) => {
        const p = Number(price) / 1e18;
        const tt = Number(t) / 1e18;
        console.log(
          `[${m.token.symbol}] price=${p.toFixed(10)} target=${tt.toFixed(10)} → ${decision} ${walletId} ${amount}`,
        );
      },
    });
    scheduler.start();
    schedulers.push(scheduler);
    console.log(`[${m.token.symbol}] scheduler started on ${walletLabels.length} wallets (${walletLabels[0]}..${walletLabels[walletLabels.length - 1]})`);
  }

  engine.worker.start();
  console.log(
    `\nMulti-MM running ${schedulers.length} market${schedulers.length === 1 ? "" : "s"} concurrently. Worker max concurrency: ${engine.config.engine.maxConcurrent}.`,
  );
  console.log("Press Ctrl+C to stop.\n");

  const shutdown = (sig: string) => {
    console.log(`\n${sig} received — stopping schedulers and draining queue…`);
    for (const s of schedulers) s.stop();
    for (const c of caches) c.stopPolling();
    engine.worker.drain();
    void engine.waitDrained().then(() => {
      console.log("All schedulers stopped, queue drained. Exiting.");
      engine.shutdown();
      process.exit(0);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await new Promise(() => undefined);
}

// Throws on any overlap between wallet ranges across markets. The
// 'all' literal counts as a full overlap with everything else.
function validateNoOverlap(markets: MarketCfg[], engine: Engine): void {
  const total = engine.config.tradingWallets.length;
  const claimed = new Map<number, string>(); // wallet index 1-based -> market symbol
  for (const m of markets) {
    let lo: number;
    let hi: number;
    if (m.walletRange === "all") {
      lo = 1;
      hi = total;
    } else {
      [lo, hi] = m.walletRange;
    }
    for (let i = lo; i <= hi; i++) {
      const existing = claimed.get(i);
      if (existing) {
        console.error(
          `Wallet ${i} is claimed by both ${existing} and ${m.token.symbol}. Markets must use non-overlapping walletRange.`,
        );
        process.exit(1);
      }
      claimed.set(i, m.token.symbol);
    }
  }
}
