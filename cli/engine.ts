import { Wallet } from "ethers";
import { makeProvider } from "@/lib/chain";
import { erc20Contract, getErc20Metadata } from "@/lib/erc20";
import { makeDispatch } from "@/lib/engine/dispatch";
import { ActionQueue } from "@/lib/engine/queue";
import { Worker } from "@/lib/engine/worker";
import { ActionLogger } from "@/lib/logger";
import type { Config } from "./config";
import { CliState } from "./state";

// Bootstrap an engine instance — queue, worker, dispatch — from a CLI
// config. Returns helpers to drive operations and shut down cleanly.
export async function bootstrap(cfg: Config, state: CliState) {
  const provider = makeProvider({
    rpcUrls: cfg.chain.rpcUrls,
    chainId: cfg.chain.chainId,
    name: `chain-${cfg.chain.chainId}`,
  });

  // Build wallet → signer mapping. The funding wallet uses id "admin".
  const signers = new Map<string, Wallet>();
  const addressById = new Map<string, string>();

  const admin = new Wallet(cfg.fundingWallet.privateKey, provider);
  signers.set("admin", admin);
  addressById.set("admin", admin.address);

  for (const w of cfg.tradingWallets) {
    const s = new Wallet(w.privateKey, provider);
    signers.set(w.label, s);
    addressById.set(w.label, s.address);
  }

  // Token decimals cache.
  const decimalsCache = new Map<string, number>();
  const tokenDecimals = async (addr: string): Promise<number> => {
    const cached = decimalsCache.get(addr);
    if (cached !== undefined) return cached;
    const m = await getErc20Metadata(erc20Contract(addr, provider));
    decimalsCache.set(addr, m.decimals);
    return m.decimals;
  };
  // Pre-cache active token's decimals.
  decimalsCache.set(cfg.token.address, cfg.token.decimals);

  const baseDispatch = makeDispatch({
    provider,
    getSigner: (id) => {
      const s = signers.get(id);
      if (!s) throw new Error(`no signer for wallet id ${id}`);
      return s;
    },
    getAddressByWalletId: (id) => {
      const a = addressById.get(id);
      if (!a) throw new Error(`no address for wallet id ${id}`);
      return a;
    },
    routerAddress: cfg.chain.routerAddress,
    wethAddress: cfg.chain.wethAddress,
    gasMultiplier: cfg.engine.gasMultiplier,
    txTimeoutMs: cfg.engine.txTimeoutMs,
    tokenDecimals,
  });

  // Logger writes each entry to log.jsonl.
  const logger = new ActionLogger([], async (entries) => {
    // Append-only file — only the last appended entry needs writing each
    // call, but ActionLogger gives the full snapshot. Take the last one.
    const last = entries[entries.length - 1];
    if (last) await state.appendLog(last);
  }, 10_000);

  // Dispatch wraps baseDispatch with logging + readable error extraction.
  const dispatch = async (a: Parameters<typeof baseDispatch>[0]) => {
    try {
      const result = await baseDispatch(a);
      await logger.append({
        ts: Date.now(),
        walletId: a.walletId,
        kind: a.kind,
        status: "done",
        txHash: result.txHash,
      });
      console.log(`✓ ${a.kind} ${a.walletId} → ${result.txHash}`);
      return result;
    } catch (err: unknown) {
      const e = err as { code?: string; reason?: string; shortMessage?: string; message?: string };
      const msg = e.reason ?? e.shortMessage ?? e.message ?? String(err);
      const code = e.code ?? "UNKNOWN";
      await logger.append({
        ts: Date.now(),
        walletId: a.walletId,
        kind: a.kind,
        status: "failed",
        errorCode: code,
        errorMessage: msg,
      });
      console.error(`✗ ${a.kind} ${a.walletId} [${code}] ${msg}`);
      throw err;
    }
  };

  // Hydrate queue from state and wire up persistence.
  const initial = await state.loadQueue();
  const queue = new ActionQueue(
    initial,
    async (snap) => {
      await state.saveQueue(snap);
    },
    10_000,
  );

  const worker = new Worker({
    queue,
    dispatch,
    maxConcurrent: cfg.engine.maxConcurrent,
    tickMs: 500,
    cooldownMs: cfg.engine.walletCooldownMs,
  });

  return {
    provider,
    queue,
    worker,
    logger,
    signers,
    addressById,
    config: cfg,
    state,
    tokenDecimals,
    // Convenience: wait until the queue is fully drained (no queued or
    // running items). Used by one-shot commands so the CLI exits only
    // after every action has resolved.
    async waitDrained(): Promise<void> {
      while (true) {
        const items = queue.all();
        const pending = items.filter((a) => a.status === "queued" || a.status === "running");
        if (pending.length === 0) return;
        await new Promise((r) => setTimeout(r, 500));
      }
    },
    shutdown(): void {
      worker.stop();
    },
  };
}

export type Engine = Awaited<ReturnType<typeof bootstrap>>;
