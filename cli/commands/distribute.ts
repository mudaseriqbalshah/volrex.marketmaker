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

  console.log(`Distributing to ${wallets.length} wallet${wallets.length === 1 ? "" : "s"} (range ${min}–${max} VLRX each)…`);
  const actions: NewAction[] = wallets.map((w) => ({
    kind: "TransferETH" as const,
    walletId: "admin",
    params: { toWalletId: w.label, amount: pickRandomInRange(min, max) },
  }));

  await engine.queue.enqueueBatch(actions);
  engine.worker.start();
  console.log(`Queued ${actions.length} TransferETH actions. Waiting for completion…`);
  await engine.waitDrained();
  console.log("All transfers complete.");
}
