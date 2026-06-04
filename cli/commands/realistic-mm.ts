import { formatUnits } from "ethers";
import type { Engine } from "../engine";
import { routerContract, quoteOut } from "@/lib/router";
import { createBalanceCache } from "../eligibility";
import { pickRandomInRange } from "@/lib/range";
import type { NewAction, BuyParams, SellParams } from "@/lib/engine/types";
import type { RealisticMarketCfg } from "../config";

// Realistic shared-pool market maker.
//
// Differences from `multi-mm`:
//   • There is no wallet-range per market. ANY of the 75k trading
//     wallets can buy or sell ANY market on any tick. The pick is
//     uniform-random (wallet, market) per tick.
//   • Each market's target ramps linearly from the price observed
//     at startup → startPrice × targetMultiplier over durationDays.
//     So instead of slamming the price up 25% immediately, the
//     target creeps upward — and the scheduler keeps emitting Buys
//     whenever actual lags the moving target.
//   • One scheduler timer for everything. The shared queue + worker
//     drain in parallel as before.
//
// This produces price action that looks like "natural drift" because
// each block has a mix of buyers and sellers, and the buy bias only
// shows up over hours/days when summed.

type MarketRuntime = {
  meta: RealisticMarketCfg;
  unitToken: bigint;
  path: [string, string];
  startPrice: bigint;       // 0n until first successful quote
  endPrice: bigint;         // startPrice × multiplier
  cache: ReturnType<typeof createBalanceCache>;
};

export async function runRealisticMM(engine: Engine): Promise<void> {
  const cfgMaybe = engine.config.realisticMM;
  if (!cfgMaybe) {
    console.error("config.realisticMM is missing — see mm.config.example.yaml for the schema");
    process.exit(1);
    return;
  }
  if (!cfgMaybe.markets || cfgMaybe.markets.length === 0) {
    console.error("config.realisticMM.markets is empty");
    process.exit(1);
    return;
  }
  const cfg = cfgMaybe; // non-nullable from here on

  const totalWallets = engine.config.tradingWallets.length;
  if (totalWallets === 0) {
    console.error("No trading wallets configured. Run `mm gen-wallets --wallet-count N` first.");
    process.exit(1);
  }

  const router = routerContract(engine.config.chain.routerAddress, engine.provider);
  const wethAddress = engine.config.chain.wethAddress;

  // Per-market runtime state. Each gets its own balance cache so the
  // eligibility check can use the right token contract. Caches are
  // fully lazy — no upfront pre-poll; entries appear as wallets are
  // picked.
  const markets: MarketRuntime[] = [];
  for (const m of cfg.markets) {
    const unitToken = 10n ** BigInt(m.token.decimals);
    const path: [string, string] = [m.token.address, wethAddress];

    let startPrice = 0n;
    try {
      startPrice = await quoteOut(router as never, unitToken, path);
    } catch {
      // pool may not exist yet — we'll retry per-tick
    }
    const multBps = BigInt(Math.round(Number(m.targetMultiplier) * 10_000));
    const endPrice = startPrice === 0n ? 0n : (startPrice * multBps) / 10_000n;

    const cache = createBalanceCache(engine, m.token, [], `[${m.token.symbol}]`);
    cache.startPolling(60_000);
    await engine.tokenDecimals(m.token.address); // pre-warm decimals cache

    if (startPrice === 0n) {
      console.warn(`[${m.token.symbol}] pool not quotable yet — will retry on each tick`);
    } else {
      console.log(
        `[${m.token.symbol}] start=${formatUnits(startPrice, 18)} → end=${formatUnits(endPrice, 18)} (× ${m.targetMultiplier})`,
      );
    }

    markets.push({ meta: m, unitToken, path, startPrice, endPrice, cache });
  }

  const startedAt = Date.now();
  const durationMs = cfg.durationDays * 24 * 60 * 60 * 1000;

  engine.worker.start();
  console.log(`\nRealistic MM started.`);
  console.log(`  ${markets.length} markets × ${totalWallets} wallets in a shared pool.`);
  console.log(`  Target ramps over ${cfg.durationDays} days. Tick every ${cfg.intervalMs}ms.`);
  console.log(`  Tolerance band ±${cfg.toleranceBps}bps. Worker maxConcurrent=${engine.config.engine.maxConcurrent}.`);
  console.log(`  Press Ctrl+C to stop.\n`);

  let stopped = false;

  async function tick(): Promise<void> {
    // 1. Pick a random market.
    const mIdx = Math.floor(Math.random() * markets.length);
    const market = markets[mIdx]!;

    // 2. If we didn't capture the start price earlier (pool missing
    //    at boot), try again now. Same applies if the pool just got
    //    initialized between ticks.
    if (market.startPrice === 0n) {
      try {
        market.startPrice = await quoteOut(router as never, market.unitToken, market.path);
        const multBps = BigInt(Math.round(Number(market.meta.targetMultiplier) * 10_000));
        market.endPrice = (market.startPrice * multBps) / 10_000n;
        console.log(
          `[${market.meta.token.symbol}] start price captured mid-run: ${formatUnits(market.startPrice, 18)} → end ${formatUnits(market.endPrice, 18)}`,
        );
      } catch {
        return; // skip — pool still missing
      }
    }

    // 3. Get current price from chain.
    let actualPrice: bigint;
    try {
      actualPrice = await quoteOut(router as never, market.unitToken, market.path);
    } catch {
      return;
    }

    // 4. Compute the ramped target at "now".
    const elapsed = Math.min(1, (Date.now() - startedAt) / durationMs);
    const elapsedBps = BigInt(Math.round(elapsed * 10_000));
    const currentTarget =
      market.startPrice + ((market.endPrice - market.startPrice) * elapsedBps) / 10_000n;

    // 5. Decide side based on price vs target band.
    const tolBps = BigInt(cfg.toleranceBps);
    const lowBand = (currentTarget * (10_000n - tolBps)) / 10_000n;
    const highBand = (currentTarget * (10_000n + tolBps)) / 10_000n;
    let side: "Buy" | "Sell";
    if (actualPrice < lowBand) side = "Buy";
    else if (actualPrice > highBand) side = "Sell";
    else side = Math.random() < 0.5 ? "Buy" : "Sell";

    // 6. Pick a random wallet from the entire pool.
    const wIdx = Math.floor(Math.random() * totalWallets);
    const walletId = engine.config.tradingWallets[wIdx]!.label;

    // 7. Build the action.
    let action: NewAction;
    if (side === "Buy") {
      const params: BuyParams = {
        tokenAddress: market.meta.token.address,
        amountNative: pickRandomInRange(cfg.buyMin, cfg.buyMax),
        slippageBps: market.meta.token.defaultSlippageBps,
        amountMode: cfg.buyMode,
      };
      action = { kind: "Buy", walletId, params };
    } else {
      const params: SellParams = {
        tokenAddress: market.meta.token.address,
        amountToken: pickRandomInRange(cfg.sellMin, cfg.sellMax),
        slippageBps: market.meta.token.defaultSlippageBps,
        amountMode: cfg.sellMode,
      };
      action = { kind: "Sell", walletId, params };
    }

    const p = Number(actualPrice) / 1e18;
    const t = Number(currentTarget) / 1e18;
    const decision = actualPrice < lowBand ? "below" : actualPrice > highBand ? "above" : "in-band";
    console.log(
      `[${market.meta.token.symbol}] price=${p.toFixed(10)} target=${t.toFixed(10)} (${decision}) → ${side.toLowerCase()} ${walletId}`,
    );

    market.cache.tryEnqueue(action);
  }

  // Tick loop — uses setTimeout chain so a slow tick doesn't pile up
  // overlapping calls (which is what setInterval would do).
  const loop = async () => {
    while (!stopped) {
      try {
        await tick();
      } catch (err) {
        console.error("tick error:", err instanceof Error ? err.message : String(err));
      }
      await new Promise((r) => setTimeout(r, cfg.intervalMs));
    }
  };
  void loop();

  // Shutdown handlers.
  const shutdown = (sig: string) => {
    console.log(`\n${sig} received — stopping ticks, draining queue…`);
    stopped = true;
    for (const m of markets) m.cache.stopPolling();
    engine.worker.drain();
    void engine.waitDrained().then(() => {
      console.log("Done.");
      engine.shutdown();
      process.exit(0);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await new Promise(() => undefined);
}
