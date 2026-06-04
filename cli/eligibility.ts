import { parseEther, parseUnits, formatEther, formatUnits } from "ethers";
import type { Engine } from "./engine";
import type { TokenCfg } from "./config";
import { erc20Contract, getErc20Balance } from "@/lib/erc20";
import type { NewAction, BuyParams, SellParams } from "@/lib/engine/types";

// Per-token, per-wallet cached balance plus a refresh loop. Used by
// both the single-token scheduler and multi-mm to skip emissions
// against wallets that obviously can't fulfil the action — saves
// gas + cleans up the log.
export type BalanceCache = {
  refreshAll(): Promise<void>;
  startPolling(intervalMs?: number): void;
  stopPolling(): void;
  tryEnqueue(a: NewAction): void;
};

type Bal = { native: bigint; tok: bigint; updatedAt: number };

const GAS_RESERVE = parseEther("0.001");

export function createBalanceCache(
  engine: Engine,
  token: TokenCfg,
  walletLabels: string[],
  logPrefix = "",
): BalanceCache {
  const tokenContract = erc20Contract(token.address, engine.provider);
  const cache = new Map<string, Bal>();
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refreshOne(walletId: string): Promise<void> {
    const addr = engine.addressById.get(walletId);
    if (!addr) return;
    try {
      const [native, tok] = await Promise.all([
        engine.provider.getBalance(addr),
        getErc20Balance(tokenContract, addr),
      ]);
      cache.set(walletId, { native, tok, updatedAt: Date.now() });
    } catch {
      // Best-effort — next tick will retry. Common during cold-start
      // before the RPC has any data for a fresh wallet.
    }
  }

  async function refreshAll(): Promise<void> {
    await Promise.all(walletLabels.map((w) => refreshOne(w)));
  }

  // Refresh only the wallets we've already touched. Suitable for the
  // background poll in fully-lazy mode (e.g. 75k-wallet realistic-mm
  // where pre-polling all is impossible).
  async function refreshKnown(): Promise<void> {
    const keys = [...cache.keys()];
    if (keys.length === 0) return;
    await Promise.all(keys.map((w) => refreshOne(w)));
  }

  function startPolling(intervalMs = 15_000): void {
    if (timer !== null) return;
    // Always refresh only what's known to keep RPC load proportional
    // to actual usage, not configured wallet count.
    timer = setInterval(() => void refreshKnown(), intervalMs);
  }

  function stopPolling(): void {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }

  function eligibleAbsoluteBuy(walletId: string, amountStr: string): boolean {
    const b = cache.get(walletId);
    if (!b) return false;
    let need: bigint;
    try { need = parseEther(amountStr); } catch { return false; }
    return b.native >= need + GAS_RESERVE;
  }
  function eligibleAbsoluteSell(walletId: string, amountStr: string): boolean {
    const b = cache.get(walletId);
    if (!b) return false;
    if (b.native < GAS_RESERVE) return false;
    let need: bigint;
    try { need = parseUnits(amountStr, token.decimals); } catch { return false; }
    return b.tok >= need;
  }
  function eligiblePercentageBuy(walletId: string): boolean {
    const b = cache.get(walletId);
    if (!b) return false;
    return b.native > GAS_RESERVE;
  }
  function eligiblePercentageSell(walletId: string): boolean {
    const b = cache.get(walletId);
    if (!b) return false;
    return b.tok > 0n && b.native >= GAS_RESERVE;
  }

  // Lazy version: if the wallet isn't in the cache yet (large wallet
  // sets where pre-polling was skipped), fetch fresh in the background
  // and only enqueue once we have data. Stays fire-and-forget so the
  // scheduler's emit signature stays sync.
  function tryEnqueue(a: NewAction): void {
    void (async () => {
      if ((a.kind === "Buy" || a.kind === "Sell") && !cache.has(a.walletId)) {
        await refreshOne(a.walletId);
      }
      if (a.kind === "Buy") {
        const params = a.params as BuyParams;
        const m = params.amountMode ?? "absolute";
        const ok = m === "percentage"
          ? eligiblePercentageBuy(a.walletId)
          : eligibleAbsoluteBuy(a.walletId, params.amountNative);
        if (!ok) {
          const b = cache.get(a.walletId);
          const have = b ? formatEther(b.native) : "?";
          console.log(`${logPrefix}  skip Buy  ${a.walletId} — insufficient native (have ${have} VLRX)`);
          return;
        }
      } else if (a.kind === "Sell") {
        const params = a.params as SellParams;
        const m = params.amountMode ?? "absolute";
        const ok = m === "percentage"
          ? eligiblePercentageSell(a.walletId)
          : eligibleAbsoluteSell(a.walletId, params.amountToken);
        if (!ok) {
          const b = cache.get(a.walletId);
          const haveTok = b ? formatUnits(b.tok, token.decimals) : "?";
          console.log(`${logPrefix}  skip Sell ${a.walletId} — insufficient ${token.symbol} (have ${haveTok})`);
          return;
        }
      }
      void engine.queue.enqueue(a);
    })();
  }

  return { refreshAll, startPolling, stopPolling, tryEnqueue };
}
