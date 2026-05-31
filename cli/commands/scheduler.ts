import type { Engine } from "../engine";
import { resolveWalletRange } from "../config";
import { pickRandomInRange } from "@/lib/range";
import { RandomScheduler } from "@/lib/engine/schedulers/random";
import { RoundRobinScheduler } from "@/lib/engine/schedulers/roundRobin";
import type { NewAction } from "@/lib/engine/types";

// Long-running command: starts a scheduler that keeps emitting actions
// until the process is killed (Ctrl+C). Worker drains in parallel.
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

  // Adapter: the scheduler emits NewAction; we forward to the queue.
  // pickRandomInRange handles single-value (min===max) by returning min.
  const emit = (a: NewAction) => {
    // Schedulers in lib/engine pre-fill amount as a fixed string. We
    // override it with our random range so each emission is jittered.
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
      emit,
    });
  } else {
    scheduler = new RoundRobinScheduler({
      wallets: walletIds,
      tokenAddress: token.address,
      buyRatio,
      slippageBps: token.defaultSlippageBps,
      cycleDelayMs: op.schedulerCycleDelayMs ?? 10000,
      amountPerWallet: min, // unused by emit override but required by the type
      eligibleBuy: () => true,
      eligibleSell: () => true,
      emit,
    });
  }
  scheduler.start();
  console.log(`${mode === "random" ? "Random" : "Round-robin"} scheduler started.`);
  console.log(
    `Targeting ${wallets.length} wallet${wallets.length === 1 ? "" : "s"}, ${amountMode} ${min}–${max}, buyRatio=${buyRatio}.`,
  );
  console.log("Press Ctrl+C to stop.");

  // Graceful shutdown on SIGINT/SIGTERM.
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

  // Block forever; the signal handler does the exit.
  await new Promise(() => undefined);
}
