import { Contract, type ContractRunner } from "ethers";
import ROUTER_ABI from "@/abis/PancakeRouterV2.json";

export function routerContract(address: string, runner: ContractRunner): Contract {
  return new Contract(address, ROUTER_ABI, runner);
}

export function applySlippage(amount: bigint, bps: number): bigint {
  if (bps < 0 || bps > 10_000) throw new Error("slippage bps out of range");
  return (amount * BigInt(10_000 - bps)) / 10_000n;
}

export function deadlineFromNow(seconds: number): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + seconds);
}

export type SwapParams = {
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  amountOutMin: bigint;
  to: string;
  deadline: bigint;
};

export type RouterCall = {
  method: string;
  args: readonly unknown[];
  value: bigint;
};

export function buildBuyCall(p: SwapParams): RouterCall {
  return {
    method: "swapExactETHForTokensSupportingFeeOnTransferTokens",
    args: [p.amountOutMin, [p.tokenIn, p.tokenOut], p.to, p.deadline],
    value: p.amountIn,
  };
}

export function buildSellCall(p: SwapParams): RouterCall {
  return {
    method: "swapExactTokensForETHSupportingFeeOnTransferTokens",
    args: [p.amountIn, p.amountOutMin, [p.tokenIn, p.tokenOut], p.to, p.deadline],
    value: 0n,
  };
}

export async function quoteOut(c: Pick<Contract, "getAmountsOut">, amountIn: bigint, path: readonly string[]): Promise<bigint> {
  const amounts = (await c.getAmountsOut(amountIn, path)) as bigint[];
  const last = amounts[amounts.length - 1];
  if (last === undefined) throw new Error("empty amounts");
  return last;
}
