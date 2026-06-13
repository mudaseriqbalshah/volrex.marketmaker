import type { Action } from "@/lib/engine/types";
import type { Contract, JsonRpcProvider, Wallet } from "ethers";
import { parseEther, parseUnits } from "ethers";
import { erc20Contract, getErc20Allowance, getErc20Balance } from "@/lib/erc20";
import { routerContract } from "@/lib/router";
import type { RouterCtx } from "@/lib/engine/executors";
import { executeApprove, executeBuy, executeSell, executeTransferETH, executeTransferToken } from "@/lib/engine/executors";
import { LocalNonceTracker } from "@/lib/nonce";
import { notifyIndexer } from "@/lib/indexer";

// Apply a percentage (string "0".."100") to a bigint balance.
// Uses 4-decimal precision internally so 33.33% works correctly.
function applyPercentage(balance: bigint, percentageStr: string): bigint {
  const pct = Number(percentageStr);
  if (!Number.isFinite(pct) || pct <= 0) return 0n;
  const clamped = Math.min(pct, 100);
  // Scale to int with 4 decimals (e.g. 33.3333% -> 333333). Divide by 1_000_000.
  const scaled = BigInt(Math.round(clamped * 10_000));
  return (balance * scaled) / 1_000_000n;
}

export type DispatchDeps = {
  provider: JsonRpcProvider;
  getSigner: (walletId: string) => Wallet;
  getAddressByWalletId: (walletId: string) => string;
  routerAddress: string;
  wethAddress: string;
  gasMultiplier: number;
  // Max ms to wait for broadcast + each phase of confirmation. If exceeded,
  // a TIMEOUT error is thrown and the worker abandons this action and
  // moves to the next one (after resyncing the nonce).
  txTimeoutMs: number;
  tokenDecimals: (tokenAddress: string) => Promise<number>;
};

export function makeDispatch(deps: DispatchDeps): (a: Action) => Promise<{ txHash: string; receiptStatus: number }> {
  const nonceTrackers = new Map<string, LocalNonceTracker>();
  const getNonceTracker = (signer: Wallet) => {
    let t = nonceTrackers.get(signer.address);
    if (!t) { t = new LocalNonceTracker(deps.provider, signer.address); nonceTrackers.set(signer.address, t); }
    return t;
  };

  return async (a: Action) => {
    const signer = deps.getSigner(a.walletId);
    const tracker = getNonceTracker(signer);
    try {
      const nonce = await tracker.next();
      const fee = await deps.provider.getFeeData();
      const gasPrice = fee.gasPrice ?? 1n;
      const gasMultiplier = deps.gasMultiplier;
      const txTimeoutMs = deps.txTimeoutMs;

      switch (a.kind) {
        case "TransferETH":
        case "TransferBackETH": {
          const to = deps.getAddressByWalletId(a.params.toWalletId);
          const amount = a.params.amount === "all-minus-buffer"
            ? (await deps.provider.getBalance(signer.address)) - parseEther(a.params.gasBuffer ?? "0.001")
            : parseEther(a.params.amount);
          return await executeTransferETH({ signer, nonce, gasPrice, gasMultiplier, txTimeoutMs }, { to, amount });
        }
        case "TransferToken":
        case "TransferBackToken": {
          const to = deps.getAddressByWalletId(a.params.toWalletId);
          const decimals = await deps.tokenDecimals(a.params.tokenAddress);
          const amount = parseUnits(a.params.amount, decimals);
          const makeErc20 = (addr: string) => erc20Contract(addr, signer);
          return await executeTransferToken({ signer, nonce, gasPrice, gasMultiplier, txTimeoutMs, makeErc20 }, { tokenAddress: a.params.tokenAddress, to, amount });
        }
        case "Approve": {
          const makeErc20 = (addr: string) => erc20Contract(addr, signer);
          return await executeApprove({ signer, nonce, gasPrice, gasMultiplier, txTimeoutMs, makeErc20 }, { tokenAddress: a.params.tokenAddress, spender: a.params.spender, amount: BigInt(a.params.amount) });
        }
        case "Buy": {
          const router = routerContract(deps.routerAddress, signer) as unknown as RouterCtx["router"];
          let amountNative: bigint;
          if (a.params.amountMode === "percentage") {
            const balance = await deps.provider.getBalance(signer.address);
            const reserve = parseEther(a.params.gasReserve ?? "0.001");
            const spendable = balance > reserve ? balance - reserve : 0n;
            amountNative = applyPercentage(spendable, a.params.amountNative);
            if (amountNative === 0n) throw new Error(`Buy %: not enough native balance after gas reserve (have ${balance}, reserve ${reserve})`);
          } else {
            amountNative = parseEther(a.params.amountNative);
          }
          const result = await executeBuy({ signer, nonce, gasPrice, gasMultiplier, txTimeoutMs, router, wethAddress: deps.wethAddress }, { tokenAddress: a.params.tokenAddress, amountNative, slippageBps: a.params.slippageBps });
          // Ping the indexer so the swap appears in the UI within seconds
          // instead of after the next minute's cron tick. Fire-and-forget.
          if (result.receiptStatus === 1) notifyIndexer("Buy");
          return result;
        }
        case "Sell": {
          const router = routerContract(deps.routerAddress, signer) as unknown as RouterCtx["router"];
          const tokenC = erc20Contract(a.params.tokenAddress, signer);
          const decimals = await deps.tokenDecimals(a.params.tokenAddress);
          let amountToken: bigint;
          if (a.params.amountMode === "percentage") {
            const balance = await getErc20Balance(tokenC, signer.address);
            amountToken = applyPercentage(balance, a.params.amountToken);
            if (amountToken === 0n) throw new Error(`Sell %: wallet has no token balance for ${a.params.tokenAddress}`);
          } else {
            amountToken = parseUnits(a.params.amountToken, decimals);
          }
          const allowance = await getErc20Allowance(tokenC, signer.address, deps.routerAddress);

          let sellNonce = nonce;
          if (allowance < amountToken) {
            const makeErc20 = (addr: string) => erc20Contract(addr, signer);
            await executeApprove({ signer, nonce, gasPrice, gasMultiplier, txTimeoutMs, makeErc20 }, { tokenAddress: a.params.tokenAddress, spender: deps.routerAddress, amount: (1n << 256n) - 1n });
            sellNonce = await tracker.next();
          }
          const result = await executeSell({ signer, nonce: sellNonce, gasPrice, gasMultiplier, txTimeoutMs, router, wethAddress: deps.wethAddress }, { tokenAddress: a.params.tokenAddress, amountToken, slippageBps: a.params.slippageBps });
          if (result.receiptStatus === 1) notifyIndexer("Sell");
          return result;
        }
      }
    } catch (err) {
      // Any failure (timeout, nonce mismatch, revert, network) might leave
      // our local nonce out of sync with the chain. Resync so the next
      // dispatch from this wallet fetches the real pending nonce instead
      // of incrementing from a stale local value.
      await tracker.resync();
      throw err;
    }
  };
}
