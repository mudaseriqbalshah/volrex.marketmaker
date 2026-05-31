import { formatUnits } from "ethers";
import type { Engine } from "../engine";
import { erc20Contract, getErc20Balance } from "@/lib/erc20";

export async function runBalances(engine: Engine): Promise<void> {
  const token = erc20Contract(engine.config.token.address, engine.provider);
  const tokenDec = engine.config.token.decimals;

  const rows: Array<{ label: string; address: string; native: bigint; tok: bigint }> = [];

  const allWallets: Array<{ label: string; address: string }> = [
    { label: "admin (funding)", address: engine.addressById.get("admin")! },
    ...engine.config.tradingWallets.map((w) => ({ label: w.label, address: engine.addressById.get(w.label)! })),
  ];

  console.log(`Fetching balances for ${allWallets.length} wallets…`);
  await Promise.all(
    allWallets.map(async (w) => {
      try {
        const [native, tok] = await Promise.all([
          engine.provider.getBalance(w.address),
          getErc20Balance(token, w.address),
        ]);
        rows.push({ label: w.label, address: w.address, native, tok });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ${w.label}: failed to fetch — ${msg}`);
      }
    }),
  );

  // Print as a table.
  const fmt = (v: bigint, dec: number) => {
    const s = formatUnits(v, dec);
    const [whole, frac = ""] = s.split(".");
    return frac.length > 4 ? `${whole}.${frac.slice(0, 4)}` : s;
  };

  console.log("");
  console.log(`  ${"label".padEnd(20)}  ${"address".padEnd(44)}  ${"VLRX".padStart(14)}  ${engine.config.token.symbol.padStart(14)}`);
  console.log("  " + "-".repeat(100));
  for (const r of rows) {
    console.log(
      `  ${r.label.padEnd(20)}  ${r.address.padEnd(44)}  ${fmt(r.native, 18).padStart(14)}  ${fmt(r.tok, tokenDec).padStart(14)}`,
    );
  }
  console.log("");
}
