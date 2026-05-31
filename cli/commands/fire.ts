import type { Engine } from "../engine";
import { resolveWalletRange } from "../config";
import { pickRandomInRange } from "@/lib/range";
import type { NewAction } from "@/lib/engine/types";

export async function runFire(engine: Engine): Promise<void> {
  const op = engine.config.operation;
  const wallets = resolveWalletRange(engine.config, op.walletRange);
  if (wallets.length === 0) {
    console.log("No wallets in selected range.");
    return;
  }
  const side = op.side ?? "buy";
  const count = Math.max(1, op.count ?? 1);
  const amountMode = op.amountMode ?? "absolute";
  const min = op.amountMin ?? (amountMode === "percentage" ? "20" : "0.005");
  const max = op.amountMax ?? (amountMode === "percentage" ? "40" : "0.02");
  const token = engine.config.token;

  const kindAt = (i: number): "Buy" | "Sell" => {
    if (side === "buy") return "Buy";
    if (side === "sell") return "Sell";
    return i % 2 === 0 ? "Buy" : "Sell";
  };

  const actions: NewAction[] = [];
  let i = 0;
  for (let r = 0; r < count; r++) {
    for (const w of wallets) {
      const kind = kindAt(i++);
      const amount = pickRandomInRange(min, max);
      if (kind === "Buy") {
        actions.push({
          kind: "Buy",
          walletId: w.label,
          params: {
            tokenAddress: token.address,
            amountNative: amount,
            slippageBps: token.defaultSlippageBps,
            amountMode,
          },
        });
      } else {
        actions.push({
          kind: "Sell",
          walletId: w.label,
          params: {
            tokenAddress: token.address,
            amountToken: amount,
            slippageBps: token.defaultSlippageBps,
            amountMode,
          },
        });
      }
    }
  }

  console.log(
    `Queueing ${actions.length} ${side} action${actions.length === 1 ? "" : "s"} (${wallets.length} wallet${wallets.length === 1 ? "" : "s"} × ${count} reps, ${amountMode} ${min}–${max})…`,
  );
  await engine.queue.enqueueBatch(actions);
  engine.worker.start();
  console.log("Worker started. Waiting for completion…");
  await engine.waitDrained();
  console.log("All actions complete.");
}
