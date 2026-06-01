import { parseEther, parseUnits, formatEther, formatUnits } from "ethers";
import type { Engine } from "../engine";
import { resolveWalletRange } from "../config";
import { pickRandomInRange } from "@/lib/range";
import { RandomScheduler } from "@/lib/engine/schedulers/random";
import { RoundRobinScheduler } from "@/lib/engine/schedulers/roundRobin";
import { MarketMakerScheduler } from "@/lib/engine/schedulers/marketMaker";
import { routerContract, quoteOut } from "@/lib/router";
import { erc20Contract, getErc20Balance } from "@/lib/erc20";
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

  // ── Balance cache + eligibility ──────────────────────────────────
  // Schedulers must NOT enqueue Buys against wallets that have no VLRX
  // for gas+swap, or Sells against wallets that hold zero of the token
  // — those guaranteed-revert actions just waste RPC and clutter logs.
  // We poll balances periodically and check from cache before each emit.
  const tokenContract = erc20Contract(token.address, engine.provider);
  type Bal = { native: bigint; tok: bigint; updatedAt: number };
  const cache = new Map<string, Bal>();

  async function refreshBalance(walletId: string): Promise<void> {
    const addr = engine.addressById.get(walletId);
    if (!addr) return;
    try {
      const [native, tok] = await Promise.all([
        engine.provider.getBalance(addr),
        getErc20Balance(tokenContract, addr),
      ]);
      cache.set(walletId, { native, tok, updatedAt: Date.now() });
    } catch {
      // ignore; next refresh will retry
    }
  }

  // Seed the cache so the first scheduler tick has data, and refresh
  // every `balancePollMs` (default 15s) afterwards. Stale cache is OK
  // for eligibility — at worst we'll skip a wallet that just received
  // funds; the next refresh picks it up.
  await Promise.all(wallets.map((w) => refreshBalance(w.label)));
  const balanceTimer = setInterval(() => {
    void Promise.all(wallets.map((w) => refreshBalance(w.label)));
  }, 15_000);

  // Reserve some native for gas so we don't queue Buys that drain the
  // wallet completely. Roughly: gas units (300k) × gasPrice × multiplier.
  const gasReserve = parseEther("0.001");

  function eligibleAbsoluteBuy(walletId: string, amountStr: string): boolean {
    const b = cache.get(walletId);
    if (!b) return false;
    let need: bigint;
    try { need = parseEther(amountStr); } catch { return false; }
    return b.native >= need + gasReserve;
  }
  function eligibleAbsoluteSell(walletId: string, amountStr: string): boolean {
    const b = cache.get(walletId);
    if (!b) return false;
    if (b.native < gasReserve) return false;
    let need: bigint;
    try { need = parseUnits(amountStr, token.decimals); } catch { return false; }
    return b.tok >= need;
  }
  function eligiblePercentageBuy(walletId: string): boolean {
    const b = cache.get(walletId);
    if (!b) return false;
    // Need at least enough native to cover gas + something to swap.
    return b.native > gasReserve;
  }
  function eligiblePercentageSell(walletId: string): boolean {
    const b = cache.get(walletId);
    if (!b) return false;
    return b.tok > 0n && b.native >= gasReserve;
  }

  // ── Emit wrapper ─────────────────────────────────────────────────
  // Replaces both jitter and eligibility logic from the previous
  // implementation. Builds the final amount, runs the right
  // eligibility check, and either enqueues or logs a skip.
  const emit = (a: NewAction) => {
    let amountStr: string;
    const isPercent = amountMode === "percentage";
    if (a.kind === "Buy") {
      amountStr = pickRandomInRange(min, max);
      if (isPercent ? !eligiblePercentageBuy(a.walletId) : !eligibleAbsoluteBuy(a.walletId, amountStr)) {
        const b = cache.get(a.walletId);
        const have = b ? formatEther(b.native) : "?";
        console.log(`  skip Buy  ${a.walletId} — insufficient native (have ${have} VLRX)`);
        return;
      }
      const jittered: NewAction = {
        ...a,
        params: { ...a.params, amountNative: amountStr, amountMode },
      };
      void engine.queue.enqueue(jittered);
    } else if (a.kind === "Sell") {
      amountStr = pickRandomInRange(min, max);
      if (isPercent ? !eligiblePercentageSell(a.walletId) : !eligibleAbsoluteSell(a.walletId, amountStr)) {
        const b = cache.get(a.walletId);
        const haveTok = b ? formatUnits(b.tok, token.decimals) : "?";
        console.log(`  skip Sell ${a.walletId} — insufficient ${token.symbol} (have ${haveTok})`);
        return;
      }
      const jittered: NewAction = {
        ...a,
        params: { ...a.params, amountToken: amountStr, amountMode },
      };
      void engine.queue.enqueue(jittered);
    } else {
      void engine.queue.enqueue(a);
    }
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
      eligibleBuy: () => true,  // gating happens inside our emit wrapper
      eligibleSell: () => true,
      emit,
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
      emit,
    });
  } else {
    // marketMaker: price-aware. Reads pool price each interval and
    // defends a target band by emitting Buys when below and Sells when
    // above. Within the band the side is random.
    const router = routerContract(engine.config.chain.routerAddress, engine.provider);
    const unitToken = 10n ** BigInt(token.decimals);
    const path = [token.address, engine.config.chain.wethAddress];
    const targetPriceStr = op.mmTargetPrice;
    const target = targetPriceStr ? parseUnits(targetPriceStr, 18) : undefined;

    const getPrice = async (): Promise<bigint> => quoteOut(router as never, unitToken, path);

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
      emit,  // shared emit with eligibility + jitter
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
    clearInterval(balanceTimer);
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
