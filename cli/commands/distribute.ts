import { parseEther, formatEther } from "ethers";
import type { Engine } from "../engine";
import { resolveWalletRange } from "../config";
import { pickRandomInRange } from "@/lib/range";
import type { NewAction } from "@/lib/engine/types";

export async function runDistribute(engine: Engine): Promise<void> {
  const op = engine.config.operation;
  const wallets = resolveWalletRange(engine.config, op.walletRange);
  const min = op.distributeMin ?? op.amountMin ?? "0.005";
  const max = op.distributeMax ?? op.amountMax ?? "0.02";

  if (wallets.length === 0) {
    console.log("No wallets in selected range.");
    return;
  }

  // Pre-flight balance check on the funding wallet. Estimate total
  // needed and warn / abort if the funding wallet can't cover it. Also
  // tell the user roughly how long the run will take, since transfers
  // from a single wallet (admin) serialize and the per-wallet cooldown
  // is enforced on every dispatch.
  const adminAddr = engine.addressById.get("admin")!;
  const adminBal = await engine.provider.getBalance(adminAddr);

  const minN = Number(min);
  const maxN = Number(max);
  if (!Number.isFinite(minN) || !Number.isFinite(maxN) || minN < 0 || maxN < 0) {
    console.error(`Invalid amount range: min=${min} max=${max}`);
    process.exit(1);
  }
  const lo = Math.min(minN, maxN);
  const hi = Math.max(minN, maxN);
  const meanPerTx = (lo + hi) / 2;
  const gasReservePerTx = 0.0005; // rough estimate for a value transfer
  const estTotal = wallets.length * (meanPerTx + gasReservePerTx);
  const estMin = wallets.length * (lo + gasReservePerTx);

  const adminBalNum = Number(formatEther(adminBal));
  console.log(`Funding wallet: ${adminAddr}`);
  console.log(`  balance:        ${adminBalNum.toFixed(4)} VLRX`);
  console.log(`  about to send:  ${wallets.length} transfers, ${lo}–${hi} VLRX each`);
  console.log(`  estimated need: ~${estTotal.toFixed(2)} VLRX (min-case ${estMin.toFixed(2)})`);

  if (adminBalNum < estMin) {
    console.error(`\n✗ Funding wallet has ${adminBalNum.toFixed(4)} VLRX but the minimum-case`);
    console.error(`  total is ${estMin.toFixed(2)} VLRX. Either:`);
    console.error(`    • reduce --min / --max (e.g. --min 0.01 --max 0.05)`);
    console.error(`    • shrink --range (e.g. --range 1-${Math.floor(adminBalNum / (lo + gasReservePerTx))})`);
    console.error(`    • top up the funding wallet first`);
    process.exit(1);
  }
  if (adminBalNum < estTotal) {
    console.warn(`⚠  Funding wallet may run out mid-run if random amounts skew high.`);
    console.warn(`   Some transfers near the end may fail with INSUFFICIENT_FUNDS.\n`);
  }

  // Rough ETA: per-wallet cooldown is the dominant pacing factor, since
  // all transfers come from the same admin wallet so they serialize.
  const cooldownMs = engine.config.engine.walletCooldownMs;
  const etaSec = Math.round((wallets.length * (cooldownMs + 1500)) / 1000);
  const etaMin = Math.floor(etaSec / 60);
  const etaSecRem = etaSec % 60;
  console.log(`  ETA:            ~${etaMin}m ${etaSecRem}s (cooldown ${cooldownMs}ms × ${wallets.length} + tx time)\n`);

  // Build all the actions in one shot.
  const actions: NewAction[] = wallets.map((w) => ({
    kind: "TransferETH" as const,
    walletId: "admin",
    params: { toWalletId: w.label, amount: pickRandomInRange(min, max) },
  }));

  await engine.queue.enqueueBatch(actions);
  engine.worker.start();
  console.log(`Queued ${actions.length} TransferETH actions. Waiting for completion…\n`);

  // Progress reporting every 5s. Counts the queue snapshot by status.
  let lastDone = 0;
  const progressTimer = setInterval(() => {
    const items = engine.queue.all();
    const done = items.filter((a) => a.kind === "TransferETH" && a.status === "done").length;
    const failed = items.filter((a) => a.kind === "TransferETH" && a.status === "failed").length;
    const queued = items.filter((a) => a.kind === "TransferETH" && a.status === "queued").length;
    const running = items.filter((a) => a.kind === "TransferETH" && a.status === "running").length;
    if (done !== lastDone || failed > 0 || queued > 0) {
      console.log(`  progress: done=${done} failed=${failed} running=${running} queued=${queued}`);
      lastDone = done;
    }
  }, 5_000);

  try {
    await engine.waitDrained();
  } finally {
    clearInterval(progressTimer);
  }

  // Final summary.
  const items = engine.queue.all();
  const done = items.filter((a) => a.kind === "TransferETH" && a.status === "done").length;
  const failed = items.filter((a) => a.kind === "TransferETH" && a.status === "failed").length;
  console.log(`\nAll transfers complete: ${done} succeeded, ${failed} failed.`);
  // Quote `parseEther` so eslint doesn't flag the unused import on older runs:
  void parseEther;
}
