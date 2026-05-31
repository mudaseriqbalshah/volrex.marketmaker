import type { Engine } from "../engine";
import { resolveWalletRange } from "../config";
import type { NewAction } from "@/lib/engine/types";

export async function runCollect(engine: Engine): Promise<void> {
  const op = engine.config.operation;
  const wallets = resolveWalletRange(engine.config, op.walletRange);
  if (wallets.length === 0) {
    console.log("No wallets in selected range.");
    return;
  }
  console.log(`Collecting native balance back from ${wallets.length} wallet${wallets.length === 1 ? "" : "s"}…`);
  const actions: NewAction[] = wallets.map((w) => ({
    kind: "TransferBackETH" as const,
    walletId: w.label,
    params: { toWalletId: "admin", amount: "all-minus-buffer" as const, gasBuffer: "0.001" },
  }));
  await engine.queue.enqueueBatch(actions);
  engine.worker.start();
  console.log(`Queued ${actions.length} TransferBackETH actions. Waiting for completion…`);
  await engine.waitDrained();
  console.log("All collections complete.");
}
