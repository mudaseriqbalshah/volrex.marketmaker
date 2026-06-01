import { parseEther, formatEther } from "ethers";
import type { Engine } from "../engine";
import { resolveWalletRange } from "../config";
import { pickRandomInRange } from "@/lib/range";
import type { NewAction } from "@/lib/engine/types";

export type DistributeOpts = {
  // When true, bypass the queue/worker and submit transfers directly
  // with consecutive nonces from admin, several at a time. Much faster
  // than the queue path because we don't wait for each tx to mine
  // before broadcasting the next.
  parallel?: boolean;
  // Number of in-flight broadcasts at once. Default 25. Tune lower if
  // the RPC complains about rate limits, higher if you have a beefy
  // RPC and want max throughput.
  batchSize?: number;
};

export async function runDistribute(engine: Engine, opts: DistributeOpts = {}): Promise<void> {
  const op = engine.config.operation;
  const wallets = resolveWalletRange(engine.config, op.walletRange);
  const min = op.distributeMin ?? op.amountMin ?? "0.005";
  const max = op.distributeMax ?? op.amountMax ?? "0.02";

  if (wallets.length === 0) {
    console.log("No wallets in selected range.");
    return;
  }

  // ── Upfront balance check ───────────────────────────────────────
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
  const gasReservePerTx = 0.0005;
  const estTotal = wallets.length * (meanPerTx + gasReservePerTx);
  const estMin = wallets.length * (lo + gasReservePerTx);

  const adminBalNum = Number(formatEther(adminBal));
  console.log(`Funding wallet: ${adminAddr}`);
  console.log(`  balance:        ${adminBalNum.toFixed(4)} VLRX`);
  console.log(`  about to send:  ${wallets.length} transfers, ${lo}–${hi} VLRX each`);
  console.log(`  estimated need: ~${estTotal.toFixed(2)} VLRX (min-case ${estMin.toFixed(2)})`);
  console.log(`  mode:           ${opts.parallel ? "PARALLEL (consecutive nonces, batched)" : "serial (via queue)"}`);

  if (adminBalNum < estMin) {
    console.error(`\n✗ Funding wallet has ${adminBalNum.toFixed(4)} VLRX but the minimum-case`);
    console.error(`  total is ${estMin.toFixed(2)} VLRX. Either reduce --min/--max, shrink`);
    console.error(`  --range, or top up the funding wallet first.`);
    process.exit(1);
  }
  if (adminBalNum < estTotal) {
    console.warn(`⚠  Funding wallet may run out mid-run if random amounts skew high.`);
    console.warn(`   Some transfers near the end may fail with INSUFFICIENT_FUNDS.\n`);
  }

  if (opts.parallel) {
    await fastDistribute(engine, wallets, min, max, opts.batchSize ?? 25);
    return;
  }

  // ── Slow serial path: queue + worker ────────────────────────────
  // (Original behaviour. Each admin tx is dispatched one at a time
  // by the worker, with walletCooldownMs between dispatches.)
  const cooldownMs = engine.config.engine.walletCooldownMs;
  const etaSec = Math.round((wallets.length * (cooldownMs + 1500)) / 1000);
  const etaMin = Math.floor(etaSec / 60);
  const etaSecRem = etaSec % 60;
  console.log(`  ETA:            ~${etaMin}m ${etaSecRem}s (cooldown ${cooldownMs}ms × ${wallets.length} + tx time)\n`);

  const actions: NewAction[] = wallets.map((w) => ({
    kind: "TransferETH" as const,
    walletId: "admin",
    params: { toWalletId: w.label, amount: pickRandomInRange(min, max) },
  }));

  await engine.queue.enqueueBatch(actions);
  engine.worker.start();
  console.log(`Queued ${actions.length} TransferETH actions. Waiting for completion…\n`);

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

  const items = engine.queue.all();
  const done = items.filter((a) => a.kind === "TransferETH" && a.status === "done").length;
  const failed = items.filter((a) => a.kind === "TransferETH" && a.status === "failed").length;
  console.log(`\nAll transfers complete: ${done} succeeded, ${failed} failed.`);
}

// ── Fast parallel path ────────────────────────────────────────────
// Pre-fetches admin's nonce, builds N txs with consecutive nonces
// (N, N+1, N+2, ...), submits them in batches concurrently. The chain
// orders them by nonce so they mine in order. Failure of one doesn't
// block the others as long as the broadcast succeeded.
async function fastDistribute(
  engine: Engine,
  wallets: { label: string }[],
  min: string,
  max: string,
  batchSize: number,
): Promise<void> {
  const admin = engine.signers.get("admin")!;
  const startNonce = await engine.provider.getTransactionCount(admin.address, "pending");
  const fee = await engine.provider.getFeeData();
  const baseGas = fee.gasPrice ?? 1n;
  const mult = engine.config.engine.gasMultiplier;
  const gasPrice = (baseGas * BigInt(Math.round(mult * 100))) / 100n;

  const txDescriptors = wallets.map((w, i) => {
    const amount = pickRandomInRange(min, max);
    return {
      walletLabel: w.label,
      nonce: startNonce + i,
      to: engine.addressById.get(w.label)!,
      value: parseEther(amount),
      amountStr: amount,
    };
  });

  console.log(
    `\nPARALLEL mode: ${txDescriptors.length} txs, nonces ${startNonce}–${startNonce + txDescriptors.length - 1}, batches of ${batchSize}\n`,
  );

  const t0 = Date.now();
  let succeeded = 0;
  let failed = 0;
  const txHashes: string[] = [];

  for (let i = 0; i < txDescriptors.length; i += batchSize) {
    const batch = txDescriptors.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (d) => {
        const tx = await admin.sendTransaction({
          to: d.to,
          value: d.value,
          nonce: d.nonce,
          gasPrice,
          gasLimit: 21000n,
        });
        return { ...d, hash: tx.hash };
      }),
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        succeeded += 1;
        txHashes.push(r.value.hash);
        console.log(
          `  ✓ nonce=${r.value.nonce} → ${r.value.walletLabel} ${r.value.amountStr} VLRX (${r.value.hash.slice(0, 12)}…)`,
        );
      } else {
        failed += 1;
        const err = r.reason as { message?: string; code?: string };
        console.error(`  ✗ broadcast failed: [${err.code ?? "?"}] ${err.message ?? String(r.reason)}`);
      }
    }
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `\nBroadcast: ${succeeded}/${txDescriptors.length} succeeded in ${dt}s. ${failed} failed.`,
  );

  if (txHashes.length > 0) {
    console.log("Waiting for the last broadcasted tx to confirm (proxy for the rest)…");
    try {
      const last = await engine.provider.waitForTransaction(txHashes[txHashes.length - 1]!);
      console.log(`Last tx mined in block ${last?.blockNumber ?? "?"}. All earlier txs should have mined too.`);
    } catch (err) {
      console.warn(`Could not confirm last tx: ${err instanceof Error ? err.message : String(err)}`);
      console.warn("Check the explorer with the tx hashes above.");
    }
  }
}
