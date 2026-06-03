import {
  Contract,
  parseEther,
  parseUnits,
  formatEther,
  formatUnits,
} from "ethers";
import type { Engine } from "../engine";
import ROUTER_ABI from "@/abis/PancakeRouterV2.json";
import ERC20_ABI from "@/abis/ERC20.json";

const MAX_UINT256 = (1n << 256n) - 1n;

// Extra router methods we need that aren't in the bundled ABI
// (the bundled ABI only has swap methods + getAmountsOut + WETH +
// factory). addLiquidityETH is the canonical PancakeSwap-V2 method
// for creating a token / native pool.
const ADD_LIQUIDITY_ABI = [
  ...ROUTER_ABI,
  {
    inputs: [
      { internalType: "address", name: "token", type: "address" },
      { internalType: "uint256", name: "amountTokenDesired", type: "uint256" },
      { internalType: "uint256", name: "amountTokenMin", type: "uint256" },
      { internalType: "uint256", name: "amountETHMin", type: "uint256" },
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
    ],
    name: "addLiquidityETH",
    outputs: [
      { internalType: "uint256", name: "amountToken", type: "uint256" },
      { internalType: "uint256", name: "amountETH",   type: "uint256" },
      { internalType: "uint256", name: "liquidity",   type: "uint256" },
    ],
    stateMutability: "payable",
    type: "function",
  },
];

export async function runAddLiquidity(engine: Engine): Promise<void> {
  const plan = engine.config.liquidityPlan;
  if (!plan || !plan.pools || plan.pools.length === 0) {
    console.error("config.liquidityPlan.pools is missing or empty.");
    console.error("Add a liquidityPlan section to mm.config.yaml — see mm.config.example.yaml.");
    process.exit(1);
  }

  const admin = engine.signers.get("admin")!;
  const routerAddr = engine.config.chain.routerAddress;
  const recipient = plan.recipient ?? admin.address;
  const deadlineSec = plan.deadlineSec ?? 600;

  // Pre-flight: sum the native and check vs admin balance.
  let totalNativeNeeded = 0n;
  for (const p of plan.pools) totalNativeNeeded += parseEther(p.nativeAmount);
  const adminBal = await engine.provider.getBalance(admin.address);
  console.log(`Funding wallet: ${admin.address}`);
  console.log(`  VLRX balance:    ${formatEther(adminBal)}`);
  console.log(`  total native need: ${formatEther(totalNativeNeeded)} (across ${plan.pools.length} pools)`);
  console.log(`  recipient (LP tokens): ${recipient}\n`);

  if (adminBal < totalNativeNeeded) {
    console.error(
      `✗ Funding wallet has ${formatEther(adminBal)} VLRX but ${formatEther(totalNativeNeeded)} is needed.`,
    );
    console.error(`  Top up the wallet or reduce per-pool nativeAmount values.`);
    process.exit(1);
  }

  // Check token balances. If short on any token, abort with a clear list.
  console.log("Checking token balances on funding wallet…");
  const shortages: string[] = [];
  for (const p of plan.pools) {
    const tokenC = new Contract(p.token, ERC20_ABI, engine.provider);
    const bal = (await (tokenC as never as { balanceOf: (a: string) => Promise<bigint> }).balanceOf(admin.address));
    const need = parseUnits(p.tokenAmount, p.decimals);
    const balStr = formatUnits(bal, p.decimals);
    const status = bal >= need ? "ok" : "SHORT";
    console.log(`  ${p.symbol.padEnd(8)} have ${balStr.padStart(20)} need ${p.tokenAmount.padStart(20)} ${status}`);
    if (bal < need) shortages.push(p.symbol);
  }
  if (shortages.length > 0) {
    console.error(
      `\n✗ Funding wallet lacks enough of: ${shortages.join(", ")}.`,
    );
    console.error("  Transfer the missing tokens into the funding wallet first,");
    console.error("  or change `fundingWallet.privateKey` to the wallet that holds them.");
    process.exit(1);
  }

  const router = new Contract(routerAddr, ADD_LIQUIDITY_ABI, admin);

  // Process pools sequentially. Each requires its own nonce, and
  // doing them in parallel would race for the admin nonce.
  let created = 0;
  for (const p of plan.pools) {
    console.log(`\n── ${p.symbol}  ${p.token} ──`);
    const nativeWei = parseEther(p.nativeAmount);
    const tokenWei = parseUnits(p.tokenAmount, p.decimals);
    const impliedPrice = Number(p.nativeAmount) / Number(p.tokenAmount);
    console.log(`  ${p.nativeAmount} VLRX + ${p.tokenAmount} ${p.symbol}  → initial price ${impliedPrice} VLRX/${p.symbol}`);

    // 1. Approve router for tokenAmount (or already-sufficient).
    const tokenC = new Contract(p.token, ERC20_ABI, admin);
    const tokenAcc = tokenC as never as {
      allowance: (owner: string, spender: string) => Promise<bigint>;
      approve: (spender: string, amount: bigint) => Promise<{ hash: string; wait: () => Promise<{ status: number }> }>;
    };
    const allowance = await tokenAcc.allowance(admin.address, routerAddr);
    if (allowance < tokenWei) {
      console.log(`  → approving router for ${p.symbol} (MaxUint256)…`);
      const tx = await tokenAcc.approve(routerAddr, MAX_UINT256);
      const r = await tx.wait();
      if (r.status !== 1) {
        console.error(`  ✗ approve failed (${tx.hash})`);
        continue;
      }
      console.log(`    ✓ approved (${tx.hash})`);
    } else {
      console.log(`  → already approved`);
    }

    // 2. addLiquidityETH(token, tokenDesired, 0, 0, recipient, deadline, {value: native})
    const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSec);
    console.log(`  → addLiquidityETH…`);
    try {
      const routerAcc = router as never as {
        addLiquidityETH: (
          token: string,
          amountTokenDesired: bigint,
          amountTokenMin: bigint,
          amountETHMin: bigint,
          to: string,
          deadline: bigint,
          overrides: { value: bigint },
        ) => Promise<{ hash: string; wait: () => Promise<{ status: number; blockNumber: number }> }>;
      };
      const tx = await routerAcc.addLiquidityETH(
        p.token,
        tokenWei,
        0n,             // amountTokenMin — initial pool, no slippage protection
        0n,             // amountETHMin
        recipient,
        deadline,
        { value: nativeWei },
      );
      const r = await tx.wait();
      if (r.status === 1) {
        console.log(`    ✓ pool created (${tx.hash}, block ${r.blockNumber})`);
        created += 1;
      } else {
        console.error(`    ✗ addLiquidityETH reverted (${tx.hash})`);
      }
    } catch (err) {
      const e = err as { reason?: string; shortMessage?: string; message?: string };
      console.error(`    ✗ ${e.reason ?? e.shortMessage ?? e.message ?? String(err)}`);
    }
  }

  console.log(`\nDone: ${created}/${plan.pools.length} pools created.`);
  if (created < plan.pools.length) {
    console.log(
      "Re-run after fixing any failures — already-created pools won't be touched (addLiquidityETH simply adds to an existing pool).",
    );
  }
}
