import type { Action } from "@/lib/engine/types";
import type { Contract, JsonRpcProvider, Wallet } from "ethers";
import { parseEther, parseUnits } from "ethers";
import { erc20Contract, getErc20Allowance } from "@/lib/erc20";
import { routerContract } from "@/lib/router";
import type { RouterCtx } from "@/lib/engine/executors";
import { executeApprove, executeBuy, executeSell, executeTransferETH, executeTransferToken } from "@/lib/engine/executors";
import { LocalNonceTracker } from "@/lib/nonce";

export type DispatchDeps = {
  provider: JsonRpcProvider;
  getSigner: (walletId: string) => Wallet;
  getAddressByWalletId: (walletId: string) => string;
  routerAddress: string;
  wethAddress: string;
  gasMultiplier: number;
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
    const nonce = await tracker.next();
    const fee = await deps.provider.getFeeData();
    const gasPrice = fee.gasPrice ?? 1n;
    const gasMultiplier = deps.gasMultiplier;

    switch (a.kind) {
      case "TransferETH":
      case "TransferBackETH": {
        const to = deps.getAddressByWalletId(a.params.toWalletId);
        const amount = a.params.amount === "all-minus-buffer"
          ? (await deps.provider.getBalance(signer.address)) - parseEther(a.params.gasBuffer ?? "0.001")
          : parseEther(a.params.amount);
        return executeTransferETH({ signer, nonce, gasPrice, gasMultiplier }, { to, amount });
      }
      case "TransferToken":
      case "TransferBackToken": {
        const to = deps.getAddressByWalletId(a.params.toWalletId);
        const decimals = await deps.tokenDecimals(a.params.tokenAddress);
        const amount = parseUnits(a.params.amount, decimals);
        const makeErc20 = (addr: string) => erc20Contract(addr, signer);
        return executeTransferToken({ signer, nonce, gasPrice, gasMultiplier, makeErc20 }, { tokenAddress: a.params.tokenAddress, to, amount });
      }
      case "Approve": {
        const makeErc20 = (addr: string) => erc20Contract(addr, signer);
        return executeApprove({ signer, nonce, gasPrice, gasMultiplier, makeErc20 }, { tokenAddress: a.params.tokenAddress, spender: a.params.spender, amount: BigInt(a.params.amount) });
      }
      case "Buy": {
        const router = routerContract(deps.routerAddress, signer) as unknown as RouterCtx["router"];
        return executeBuy({ signer, nonce, gasPrice, gasMultiplier, router, wethAddress: deps.wethAddress }, { tokenAddress: a.params.tokenAddress, amountNative: parseEther(a.params.amountNative), slippageBps: a.params.slippageBps });
      }
      case "Sell": {
        const router = routerContract(deps.routerAddress, signer) as unknown as RouterCtx["router"];
        const tokenC = erc20Contract(a.params.tokenAddress, signer);
        const decimals = await deps.tokenDecimals(a.params.tokenAddress);
        const amountToken = parseUnits(a.params.amountToken, decimals);
        const allowance = await getErc20Allowance(tokenC, signer.address, deps.routerAddress);

        let sellNonce = nonce;
        if (allowance < amountToken) {
          const makeErc20 = (addr: string) => erc20Contract(addr, signer);
          await executeApprove({ signer, nonce, gasPrice, gasMultiplier, makeErc20 }, { tokenAddress: a.params.tokenAddress, spender: deps.routerAddress, amount: (1n << 256n) - 1n });
          sellNonce = await tracker.next();
        }
        return executeSell({ signer, nonce: sellNonce, gasPrice, gasMultiplier, router, wethAddress: deps.wethAddress }, { tokenAddress: a.params.tokenAddress, amountToken, slippageBps: a.params.slippageBps });
      }
    }
  };
}
