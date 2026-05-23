import { Contract, type ContractRunner } from "ethers";
import ERC20_ABI from "@/abis/ERC20.json";

interface ERC20Methods {
  symbol(): Promise<string>;
  decimals(): Promise<bigint>;
  balanceOf(owner: string): Promise<bigint>;
  allowance(owner: string, spender: string): Promise<bigint>;
}

export function erc20Contract(address: string, runner: ContractRunner): Contract {
  return new Contract(address, ERC20_ABI, runner);
}

export async function getErc20Metadata(c: Contract): Promise<{ symbol: string; decimals: number }> {
  const m = c as unknown as ERC20Methods;
  const [symbol, decimals] = await Promise.all([m.symbol(), m.decimals()]);
  return { symbol: String(symbol), decimals: Number(decimals) };
}

export async function getErc20Balance(c: Contract, owner: string): Promise<bigint> {
  return await (c as unknown as ERC20Methods).balanceOf(owner);
}

export async function getErc20Allowance(c: Contract, owner: string, spender: string): Promise<bigint> {
  return await (c as unknown as ERC20Methods).allowance(owner, spender);
}

export type CallSpec = { method: string; args: readonly unknown[] };

export function buildApproveTx(spender: string, amount: bigint): CallSpec {
  return { method: "approve", args: [spender, amount] };
}

export function buildTransferTx(to: string, amount: bigint): CallSpec {
  return { method: "transfer", args: [to, amount] };
}

export const ERC20_MAX_UINT256 = (1n << 256n) - 1n;
