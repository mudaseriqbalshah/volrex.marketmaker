import { parseEther, formatEther, JsonRpcProvider, Network, Wallet, type TransactionReceipt } from "ethers";
import type { Engine } from "../engine";
import { resolveWalletRange } from "../config";
import { pickRandomInRange } from "@/lib/range";
import type { NewAction } from "@/lib/engine/types";

// ethers v6's provider.waitForTransaction has been observed to time out
// against this network even when the tx is definitely mined. Polling
// getTransactionReceipt directly is simpler and reliable — we control
// the interval and bail explicitly when the receipt comes back.
async function pollForReceipt(
  provider: JsonRpcProvider,
  hash: string,
  timeoutMs: number,
  intervalMs = 1500,
): Promise<TransactionReceipt | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const receipt = await provider.getTransactionReceipt(hash);
      if (receipt !== null) return receipt;
    } catch {
      // ignore transient RPC errors; retry on next tick
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

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
// (N, N+1, N+2, ...), submits them in batches concurrently to a SINGLE
// RPC node, then waits for every receipt.
//
// Important: we deliberately do NOT use engine.provider here — that's
// the round-robin proxy across all configured RPC URLs, and using it
// means consecutive txs from the same wallet land on different nodes.
// Each node has its own mempool view, so by the time one block is
// proposed only a subset of our txs have actually reached the
// proposer. Result: some txs mine, others get stuck in stale mempools
// until cross-node sync catches up.
//
// Sticking to a single node gives consistent ordering and lets us
// reliably wait for receipts via the same node that received them.
async function fastDistribute(
  engine: Engine,
  wallets: { label: string }[],
  min: string,
  max: string,
  batchSize: number,
): Promise<void> {
  const chainId = engine.config.chain.chainId;
  const rpcUrl = engine.config.chain.rpcUrls[0];
  if (!rpcUrl) {
    console.error("No RPC URL configured");
    process.exit(1);
  }
  const network = new Network(`chain-${chainId}`, chainId);
  const stickyProvider = new JsonRpcProvider(rpcUrl, network, { staticNetwork: network });
  const stickyAdmin = new Wallet(engine.config.fundingWallet.privateKey, stickyProvider);

  const startNonce = await stickyProvider.getTransactionCount(stickyAdmin.address, "pending");
  const fee = await stickyProvider.getFeeData();
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
    `\nPARALLEL mode: ${txDescriptors.length} txs, nonces ${startNonce}–${startNonce + txDescriptors.length - 1}, batches of ${batchSize}`,
  );
  console.log(`Using single RPC for consistency: ${rpcUrl}\n`);

  const t0 = Date.now();
  let broadcastFailed = 0;
  const broadcasted: Array<{
    walletLabel: string;
    nonce: number;
    hash: string;
    amountStr: string;
  }> = [];

  for (let i = 0; i < txDescriptors.length; i += batchSize) {
    const batch = txDescriptors.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (d) => {
        const tx = await stickyAdmin.sendTransaction({
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
        broadcasted.push({
          walletLabel: r.value.walletLabel,
          nonce: r.value.nonce,
          hash: r.value.hash,
          amountStr: r.value.amountStr,
        });
        console.log(
          `  ✓ broadcast nonce=${r.value.nonce} → ${r.value.walletLabel} ${r.value.amountStr} VLRX (${r.value.hash.slice(0, 12)}…)`,
        );
      } else {
        broadcastFailed += 1;
        const err = r.reason as { message?: string; code?: string };
        console.error(`  ✗ broadcast failed: [${err.code ?? "?"}] ${err.message ?? String(r.reason)}`);
      }
    }
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `\nBroadcast phase: ${broadcasted.length}/${txDescriptors.length} accepted by RPC in ${dt}s. ${broadcastFailed} rejected.`,
  );

  if (broadcasted.length === 0) {
    console.log("Nothing to wait for. Exiting.");
    return;
  }

  // Cheap completion check first: poll admin's "latest" (i.e. mined)
  // nonce until it has advanced past every tx we broadcast. Way faster
  // than per-tx receipt polling and avoids hammering the RPC.
  const timeoutMs = engine.config.engine.txTimeoutMs;
  const lastNonce = broadcasted[broadcasted.length - 1]!.nonce;
  const expectedMinedCount = lastNonce + 1;
  console.log(
    `Waiting for admin's mined nonce to reach ${expectedMinedCount} (per-tx timeout ${timeoutMs / 1000}s)…`,
  );
  const overallStart = Date.now();
  let currentMinedNonce = 0;
  while (Date.now() - overallStart < timeoutMs) {
    try {
      currentMinedNonce = await stickyProvider.getTransactionCount(stickyAdmin.address, "latest");
      if (currentMinedNonce >= expectedMinedCount) break;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (currentMinedNonce >= expectedMinedCount) {
    console.log(
      `All ${broadcasted.length} txs mined (admin nonce now ${currentMinedNonce}). Fetching receipts…\n`,
    );
  } else {
    console.warn(
      `\nAdmin nonce only advanced to ${currentMinedNonce} (expected ≥ ${expectedMinedCount}). Some txs may still be pending. Fetching whatever receipts are available…\n`,
    );
  }

  // Per-tx receipt fetch (parallel, direct polling — no
  // waitForTransaction). Per-tx timeout is short because by now most
  // are already mined.
  const receiptResults = await Promise.allSettled(
    broadcasted.map(async (b) => {
      const receipt = await pollForReceipt(stickyProvider, b.hash, 10_000);
      return { ...b, receipt };
    }),
  );

  let mined = 0;
  let reverted = 0;
  let pending = 0;
  for (const r of receiptResults) {
    if (r.status === "fulfilled") {
      if (r.value.receipt && r.value.receipt.status === 1) {
        mined += 1;
        console.log(
          `  ✓ mined nonce=${r.value.nonce} → ${r.value.walletLabel} in block ${r.value.receipt.blockNumber}`,
        );
      } else if (r.value.receipt && r.value.receipt.status === 0) {
        reverted += 1;
        console.error(`  ✗ reverted nonce=${r.value.nonce} → ${r.value.walletLabel} (${r.value.hash})`);
      } else {
        pending += 1;
        console.warn(`  ⏳ no receipt yet nonce=${r.value.nonce} → ${r.value.walletLabel} (${r.value.hash})`);
      }
    } else {
      pending += 1;
      const err = r.reason as { message?: string };
      console.warn(`  ⏳ receipt poll error: ${err.message ?? String(r.reason)}`);
    }
  }

  console.log(`\nDone: mined=${mined} reverted=${reverted} pending/unknown=${pending}.`);
  if (pending > 0) {
    console.log(
      "Pending txs may still mine later. If they don't, they're stuck — wait or run `mm distribute` again to overwrite.",
    );
  }
}
