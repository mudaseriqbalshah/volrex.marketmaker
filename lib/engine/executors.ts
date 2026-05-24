import type { Contract, Wallet, TransactionResponse } from "ethers";
import { applySlippage, deadlineFromNow, quoteOut } from "@/lib/router";

export type ExecCtx = {
  signer: Wallet;
  nonce: number;
  gasPrice: bigint;
  gasMultiplier: number;
  // Maximum time (ms) to wait for broadcast + each phase of confirmation.
  // Default 60s. If the RPC hangs (broadcast or wait), we bail with a
  // TIMEOUT error so the worker can move to the next action instead of
  // hanging forever.
  txTimeoutMs?: number;
};

export type ExecResultPromise = Promise<{ txHash: string; receiptStatus: number }>;

const DEFAULT_TIMEOUT_MS = 60_000;

function bumpGas(p: bigint, mult: number): bigint {
  return (p * BigInt(Math.round(mult * 100))) / 100n;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(Object.assign(new Error(`${label} did not complete within ${ms}ms`), { code: "TIMEOUT" })),
        ms,
      ),
    ),
  ]);
}

async function sendAndWait(signer: Wallet, tx: object, timeoutMs: number = DEFAULT_TIMEOUT_MS): ExecResultPromise {
  // Broadcast phase: RPC must accept the tx.
  const response = (await withTimeout(
    signer.sendTransaction(tx as never) as Promise<TransactionResponse>,
    timeoutMs,
    "broadcast",
  ));
  // Confirmation phase: wait for the receipt. The hash is now known so we
  // log it before potentially timing out, so the user has something to
  // investigate on the explorer.
  const receipt = await withTimeout(response.wait(), timeoutMs, `confirm ${response.hash}`);
  return { txHash: response.hash, receiptStatus: receipt?.status ?? 0 };
}

export async function executeTransferETH(ctx: ExecCtx, p: { to: string; amount: bigint }): ExecResultPromise {
  return sendAndWait(ctx.signer, {
    to: p.to,
    value: p.amount,
    nonce: ctx.nonce,
    gasPrice: bumpGas(ctx.gasPrice, ctx.gasMultiplier),
  }, ctx.txTimeoutMs);
}

export type Erc20Ctx = ExecCtx & { makeErc20: (addr: string) => Contract };

export async function executeTransferToken(ctx: Erc20Ctx, p: { tokenAddress: string; to: string; amount: bigint }): ExecResultPromise {
  const c = ctx.makeErc20(p.tokenAddress);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const populated = await c["transfer"]!.populateTransaction(p.to, p.amount);
  return sendAndWait(ctx.signer, {
    ...populated,
    nonce: ctx.nonce,
    gasPrice: bumpGas(ctx.gasPrice, ctx.gasMultiplier),
  }, ctx.txTimeoutMs);
}

export async function executeApprove(ctx: Erc20Ctx, p: { tokenAddress: string; spender: string; amount: bigint }): ExecResultPromise {
  const c = ctx.makeErc20(p.tokenAddress);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const populated = await c["approve"]!.populateTransaction(p.spender, p.amount);
  return sendAndWait(ctx.signer, {
    ...populated,
    nonce: ctx.nonce,
    gasPrice: bumpGas(ctx.gasPrice, ctx.gasMultiplier),
  }, ctx.txTimeoutMs);
}

// RouterContract is a Contract that dynamically exposes router methods and getAmountsOut.
type RouterContract = Contract & Pick<Contract, "getAmountsOut">;

export type RouterCtx = ExecCtx & { router: RouterContract; wethAddress: string };

export async function executeBuy(ctx: RouterCtx, p: { tokenAddress: string; amountNative: bigint; slippageBps: number }): ExecResultPromise {
  const path = [ctx.wethAddress, p.tokenAddress];
  const expectedOut = await quoteOut(ctx.router, p.amountNative, path);
  const minOut = applySlippage(expectedOut, p.slippageBps);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const populated = await ctx.router["swapExactETHForTokensSupportingFeeOnTransferTokens"]!.populateTransaction(
    minOut, path, ctx.signer.address, deadlineFromNow(120),
  );
  return sendAndWait(ctx.signer, {
    ...populated,
    value: p.amountNative,
    nonce: ctx.nonce,
    gasPrice: bumpGas(ctx.gasPrice, ctx.gasMultiplier),
  }, ctx.txTimeoutMs);
}

export async function executeSell(ctx: RouterCtx, p: { tokenAddress: string; amountToken: bigint; slippageBps: number }): ExecResultPromise {
  const path = [p.tokenAddress, ctx.wethAddress];
  const expectedOut = await quoteOut(ctx.router, p.amountToken, path);
  const minOut = applySlippage(expectedOut, p.slippageBps);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const populated = await ctx.router["swapExactTokensForETHSupportingFeeOnTransferTokens"]!.populateTransaction(
    p.amountToken, minOut, path, ctx.signer.address, deadlineFromNow(120),
  );
  return sendAndWait(ctx.signer, {
    ...populated,
    nonce: ctx.nonce,
    gasPrice: bumpGas(ctx.gasPrice, ctx.gasMultiplier),
  }, ctx.txTimeoutMs);
}
