import { parseUnits } from "ethers";
import type { Engine } from "../engine";
import { resolveWalletRange } from "../config";
import { pickRandomInRange } from "@/lib/range";
import { RandomScheduler } from "@/lib/engine/schedulers/random";
import { RoundRobinScheduler } from "@/lib/engine/schedulers/roundRobin";
import { MarketMakerScheduler } from "@/lib/engine/schedulers/marketMaker";
import { routerContract, quoteOut } from "@/lib/router";
import type { NewAction } from "@/lib/engine/types";

// Long-running command. Worker drains the queue in parallel while the
// chosen scheduler emits new actions. Stops on SIGINT/SIGTERM.
export async function runScheduler(engine: Engine): Promise<void> {
  const op = engine.config.operation;
  const wallets = resolveWalletRange(engine.config, op.walletRange);
  if (wallets.length === 0) {
    console.log("No wallets in selected range.");
    return;
  }
  const token = engine.config.token;
  const mode = op.schedulerMode ?? "random";
  const buyRatio = op.schedulerBuyRatio ?? 0.55;
  const amountMode = op.amountMode ?? "absolute";
  const min = op.amountMin ?? (amountMode === "percentage" ? "20" : "0.005");
  const max = op.amountMax ?? (amountMode === "percentage" ? "40" : "0.02");

  engine.worker.start();
  console.log(`Worker started (max ${engine.config.engine.maxConcurrent} concurrent).`);

  // Each scheduler emits NewAction; we jitter the amount per emission so
  // back-to-back swaps don't carry the literal min value.
  const emitWithJitter = (a: NewAction) => {
    const jittered = { ...a };
    if (jittered.kind === "Buy") {
      jittered.params = { ...jittered.params, amountNative: pickRandomInRange(min, max), amountMode };
    } else if (jittered.kind === "Sell") {
      jittered.params = { ...jittered.params, amountToken: pickRandomInRange(min, max), amountMode };
    }
    void engine.queue.enqueue(jittered);
  };

  const walletIds = wallets.map((w) => w.label);

  let scheduler: { start: () => void; stop: () => void };
  if (mode === "random") {
    scheduler = new RandomScheduler({
      wallets: walletIds,
      tokenAddress: token.address,
      buyRatio,
      slippageBps: token.defaultSlippageBps,
      minDelayMs: op.schedulerMinDelayMs ?? 5000,
      maxDelayMs: op.schedulerMaxDelayMs ?? 15000,
      minAmount: min,
      maxAmount: max,
      eligibleBuy: () => true,
      eligibleSell: () => true,
      emit: emitWithJitter,
    });
  } else if (mode === "roundRobin") {
    scheduler = new RoundRobinScheduler({
      wallets: walletIds,
      tokenAddress: token.address,
      buyRatio,
      slippageBps: token.defaultSlippageBps,
      cycleDelayMs: op.schedulerCycleDelayMs ?? 10000,
      amountPerWallet: min,
      eligibleBuy: () => true,
      eligibleSell: () => true,
      emit: emitWithJitter,
    });
  } else {
    // marketMaker: price-aware. Reads pool price each interval and
    // defends a target band by emitting Buys when below and Sells when
    // above. Within the band the side is random.
    const router = routerContract(engine.config.chain.routerAddress, engine.provider);
    const unitToken = 10n ** BigInt(token.decimals);
    const path = [token.address, engine.config.chain.wethAddress];
    const targetPriceStr = op.mmTargetPrice;
    // targetPrice is native-per-1-token. parseUnits with native decimals (18).
    const target = targetPriceStr ? parseUnits(targetPriceStr, 18) : undefined;

    const getPrice = async (): Promise<bigint> => {
      // How much native do you get for selling 1 token? That's the price.
      return quoteOut(router as never, unitToken, path);
    };

    scheduler = new MarketMakerScheduler({
      wallets: walletIds,
      tokenAddress: token.address,
      slippageBps: token.defaultSlippageBps,
      intervalMs: op.mmIntervalMs ?? 8_000,
      amountMin: min,
      amountMax: max,
      amountMode,
      getPrice,
      unitToken,
      targetPrice: target,
      toleranceBps: op.mmToleranceBps ?? 200,
      emit: (a) => void engine.queue.enqueue(a), // already-jittered amounts
      onTick: ({ price, target: t, decision, walletId, amount }) => {
        const priceNative = Number(price) / 1e18;
        const targetNative = Number(t) / 1e18;
        console.log(
          `[mm] price=${priceNative.toFixed(8)} target=${targetNative.toFixed(8)} → ${decision} ${walletId} ${amount}`,
        );
      },
    });
  }

  scheduler.start();
  if (mode === "marketMaker") {
    console.log(`Market-maker scheduler started.`);
    console.log(
      `Targeting ${wallets.length} wallet${wallets.length === 1 ? "" : "s"}, ${amountMode} ${min}–${max}, target=${op.mmTargetPrice ?? "(auto: first observed price)"}, tolerance=${op.mmToleranceBps ?? 200}bps.`,
    );
  } else {
    console.log(`${mode === "random" ? "Random" : "Round-robin"} scheduler started.`);
    console.log(
      `Targeting ${wallets.length} wallet${wallets.length === 1 ? "" : "s"}, ${amountMode} ${min}–${max}, buyRatio=${buyRatio}.`,
    );
  }
  console.log("Press Ctrl+C to stop.");

  const shutdown = (sig: string) => {
    console.log(`\n${sig} received — stopping scheduler and draining queue…`);
    scheduler.stop();
    engine.worker.drain();
    void engine.waitDrained().then(() => {
      console.log("Queue drained. Exiting.");
      engine.shutdown();
      process.exit(0);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await new Promise(() => undefined);
}
