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

// ── Behavioural phase machine ────────────────────────────────────────
// Real markets don't trade at a constant rate with a fixed bias. They
// cycle through phases that look like:
//
//   push         strong directional trades, fast pace (price actually moves)
//   consolidate  balanced flow, slower pace (price wiggles)
//   pullback     brief counter-trend (mini reversal that catches stops)
//   burst        rapid-fire trades, normal direction (volume spike)
//
// Each phase has its own timing multiplier (faster/slower than the
// configured base interval), a bias adjustment vs the price-regime
// baseline, and a duration sampled from a range so transitions look
// organic instead of clock-like.
type Phase = "push" | "consolidate" | "pullback" | "burst";

const PHASE_WEIGHTS: { p: Phase; w: number }[] = [
  { p: "consolidate", w: 0.50 }, // half the time, mostly quiet
  { p: "push",        w: 0.30 },
  { p: "burst",       w: 0.15 },
  { p: "pullback",    w: 0.05 }, // rare, brief
];

function pickPhase(rng: () => number): Phase {
  const r = rng();
  let acc = 0;
  for (const { p, w } of PHASE_WEIGHTS) {
    acc += w;
    if (r < acc) return p;
  }
  return "consolidate";
}

// Phase-specific tick interval (relative to base). Lower = faster.
function phaseIntervalMs(phase: Phase, base: number, rng: () => number): number {
  switch (phase) {
    case "burst":       return Math.round(base * (0.2 + rng() * 0.4));  // 0.2–0.6×
    case "push":        return Math.round(base * (0.6 + rng() * 0.7));  // 0.6–1.3×
    case "consolidate": return Math.round(base * (0.9 + rng() * 1.8));  // 0.9–2.7×
    case "pullback":    return Math.round(base * (1.0 + rng() * 2.0));  // 1.0–3.0×
  }
}

// Phase duration in ms — how long this phase lasts before re-rolling.
function phaseDurationMs(phase: Phase, rng: () => number): number {
  // ranges in seconds
  const [lo, hi] =
    phase === "burst"    ? [10,  45]  :
    phase === "pullback" ? [20,  60]  :
    phase === "push"     ? [60, 240]  :
                           [90, 360]; // consolidate
  return Math.round((lo + rng() * (hi - lo)) * 1000);
}

// Phase modulator on top of the price-regime buy bias. Push amplifies
// the directional pressure; pullback inverts it; consolidate dampens.
function adjustBuyProb(phase: Phase, baseProb: number): number {
  switch (phase) {
    case "push":        return Math.min(0.97, baseProb + 0.15);
    case "pullback":    return 1 - baseProb;
    case "burst":       return baseProb;
    case "consolidate": return 0.5 + (baseProb - 0.5) * 0.4;
  }
}

// Trade size multiplier — power-law-ish so most trades are small with
// occasional bigger ones. Mirrors real volume distributions.
function sizeScale(rng: () => number): number {
  const r = rng();
  if (r < 0.80) return 0.5 + rng() * 0.8;   // 80%: small (0.5–1.3×)
  if (r < 0.97) return 1.5 + rng() * 2.0;   // 17%: medium (1.5–3.5×)
  return 3.5 + rng() * 4.0;                 // 3%: whale (3.5–7.5×)
}

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
  const rng = Math.random;

  // Behavioural phase state. Re-rolled every phaseDurationMs.
  let currentPhase: Phase = pickPhase(rng);
  let phaseEndsAt: number = Date.now() + phaseDurationMs(currentPhase, rng);
  let phaseTicksThisRound = 0;

  // ── Connectivity tracker ───────────────────────────────────────────
  // When the RPC drops we don't want to spam the console with one
  // identical error per tick. Track consecutive failures; log once when
  // we cross a threshold ("offline"), once again when the first success
  // returns ("back online"). The loop also adds backoff sleep on top
  // of the configured intervalMs so we don't hammer a down RPC.
  let consecutiveFailures = 0;
  let offlineSince: number | null = null;
  const OFFLINE_THRESHOLD = 3;       // ticks of failure before declaring offline
  const BACKOFF_MAX_MS = 30_000;     // cap added sleep at 30s
  const BACKOFF_STEP_MS = 2_000;     // 2s extra per failed tick after threshold

  function noteFailure(): void {
    consecutiveFailures += 1;
    if (consecutiveFailures === OFFLINE_THRESHOLD && offlineSince === null) {
      offlineSince = Date.now();
      console.error(
        `\n⚠  RPC seems unreachable (${consecutiveFailures} consecutive failed quotes). ` +
          `Bot is waiting — will resume automatically once connectivity returns.\n`,
      );
    }
  }
  function noteSuccess(): void {
    if (offlineSince !== null) {
      const downSec = Math.round((Date.now() - offlineSince) / 1000);
      console.log(`\n✓ Connectivity restored after ${downSec}s. Resuming normal pace.\n`);
      offlineSince = null;
    }
    consecutiveFailures = 0;
  }
  function backoffMs(): number {
    if (consecutiveFailures < OFFLINE_THRESHOLD) return 0;
    return Math.min(BACKOFF_MAX_MS, (consecutiveFailures - OFFLINE_THRESHOLD + 1) * BACKOFF_STEP_MS);
  }

  engine.worker.start();
  console.log(`\nRealistic MM started.`);
  console.log(`  ${markets.length} markets × ${totalWallets} wallets in a shared pool.`);
  console.log(`  Target ramps over ${cfg.durationDays} days. Base interval ${cfg.intervalMs}ms (jittered by phase).`);
  console.log(`  Tolerance band ±${cfg.toleranceBps}bps. Worker maxConcurrent=${engine.config.engine.maxConcurrent}.`);
  console.log(`  Behavioural phases: consolidate / push / burst / pullback (auto-cycled).`);
  console.log(`  Starting phase: ${currentPhase}.`);
  console.log(`  Press Ctrl+C to stop.\n`);

  let stopped = false;

  async function tick(): Promise<void> {
    // 1. Pick a random market.
    const mIdx = Math.floor(Math.random() * markets.length);
    const market = markets[mIdx]!;

    // 2. If we didn't capture the start price earlier (pool missing
    //    at boot), try again now. Same applies if the pool just got
    //    initialized between ticks. A quoteOut error here is also
    //    counted toward the connectivity tracker — could be either
    //    "pool still missing" or "RPC unreachable" — we can't tell
    //    locally, so we treat both as failures.
    if (market.startPrice === 0n) {
      try {
        market.startPrice = await quoteOut(router as never, market.unitToken, market.path);
        const multBps = BigInt(Math.round(Number(market.meta.targetMultiplier) * 10_000));
        market.endPrice = (market.startPrice * multBps) / 10_000n;
        console.log(
          `[${market.meta.token.symbol}] start price captured mid-run: ${formatUnits(market.startPrice, 18)} → end ${formatUnits(market.endPrice, 18)}`,
        );
        noteSuccess();
      } catch {
        noteFailure();
        return; // skip — pool still missing or RPC down
      }
    }

    // 3. Get current price from chain.
    let actualPrice: bigint;
    try {
      actualPrice = await quoteOut(router as never, market.unitToken, market.path);
      noteSuccess();
    } catch {
      noteFailure();
      return;
    }

    // 4. Compute the ramped target at "now".
    const elapsed = Math.min(1, (Date.now() - startedAt) / durationMs);
    const elapsedBps = BigInt(Math.round(elapsed * 10_000));
    const currentTarget =
      market.startPrice + ((market.endPrice - market.startPrice) * elapsedBps) / 10_000n;

    // 5. Decide side using a 2-step bias:
    //    (a) base bias from price-vs-target regime
    //    (b) modulated by current behavioural phase
    const tolBps = BigInt(cfg.toleranceBps);
    const lowBand = (currentTarget * (10_000n - tolBps)) / 10_000n;
    const highBand = (currentTarget * (10_000n + tolBps)) / 10_000n;
    let regime: "below" | "in-band" | "above";
    let baseBuyProb: number;
    if (actualPrice < lowBand) {
      regime = "below";
      baseBuyProb = cfg.buyBiasBelowBand ?? 0.8;
    } else if (actualPrice > highBand) {
      regime = "above";
      baseBuyProb = cfg.buyBiasAboveBand ?? 0.2;
    } else {
      regime = "in-band";
      baseBuyProb = cfg.buyBiasInBand ?? 0.5;
    }
    const buyProb = adjustBuyProb(currentPhase, baseBuyProb);
    const side: "Buy" | "Sell" = rng() < buyProb ? "Buy" : "Sell";

    // 6. Pick a random wallet from the entire pool.
    const wIdx = Math.floor(rng() * totalWallets);
    const walletId = engine.config.tradingWallets[wIdx]!.label;

    // 7. Build the action with a per-tick size scale (power-law-ish so
    //    most trades are small with occasional whales).
    const scale = sizeScale(rng);
    const scaledRange = (minStr: string, maxStr: string) => {
      const raw = Number(pickRandomInRange(minStr, maxStr));
      return (raw * scale).toFixed(8);
    };

    let action: NewAction;
    let amountStr: string;
    if (side === "Buy") {
      amountStr = scaledRange(cfg.buyMin, cfg.buyMax);
      const params: BuyParams = {
        tokenAddress: market.meta.token.address,
        amountNative: amountStr,
        slippageBps: market.meta.token.defaultSlippageBps,
        amountMode: cfg.buyMode,
      };
      action = { kind: "Buy", walletId, params };
    } else {
      amountStr = scaledRange(cfg.sellMin, cfg.sellMax);
      const params: SellParams = {
        tokenAddress: market.meta.token.address,
        amountToken: amountStr,
        slippageBps: market.meta.token.defaultSlippageBps,
        amountMode: cfg.sellMode,
      };
      action = { kind: "Sell", walletId, params };
    }

    const p = Number(actualPrice) / 1e18;
    const t = Number(currentTarget) / 1e18;
    const sizeTag = scale > 3 ? "WHALE" : scale > 1.5 ? "med" : "sm";
    console.log(
      `[${currentPhase.padEnd(11)}] [${market.meta.token.symbol.padEnd(4)}] price=${p.toFixed(10)} target=${t.toFixed(10)} (${regime}, buyP=${buyProb.toFixed(2)}) → ${side.toLowerCase()} ${walletId} amt=${amountStr} [${sizeTag}]`,
    );

    market.cache.tryEnqueue(action);
    phaseTicksThisRound += 1;
  }

  // Tick loop — uses a setTimeout chain so a slow tick doesn't pile
  // up overlapping calls. Interval per tick is phase-dependent so the
  // pace itself shifts as we cycle through phases (burst = fast,
  // consolidate = slow, etc).
  const loop = async () => {
    while (!stopped) {
      try {
        await tick();
      } catch (err) {
        console.error("tick error:", err instanceof Error ? err.message : String(err));
      }
      // Phase transition? Roll a new one if we've exceeded its duration.
      if (Date.now() >= phaseEndsAt) {
        const previousPhase = currentPhase;
        let next: Phase = pickPhase(rng);
        // Avoid immediately repeating the same phase too often — gives
        // a more varied tape. Re-roll once if same as last.
        if (next === previousPhase) next = pickPhase(rng);
        currentPhase = next;
        phaseEndsAt = Date.now() + phaseDurationMs(currentPhase, rng);
        console.log(
          `\n── PHASE ${previousPhase} → ${currentPhase} ` +
            `(${phaseTicksThisRound} ticks, next change in ~${Math.round((phaseEndsAt - Date.now()) / 1000)}s) ──\n`,
        );
        phaseTicksThisRound = 0;
      }
      const phaseSleep = phaseIntervalMs(currentPhase, cfg.intervalMs, rng);
      // Add exponential-ish backoff on top when we appear offline so we
      // stop hammering the down RPC. Cap at BACKOFF_MAX_MS per tick.
      const extra = backoffMs();
      await new Promise((r) => setTimeout(r, phaseSleep + extra));
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
