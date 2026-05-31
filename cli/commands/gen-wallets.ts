import { Wallet } from "ethers";
import { type Config, saveConfig } from "../config";

// Generates N wallets and appends them to the config file (overwriting
// the same file). Labels are auto-assigned as w001, w002, ...
export async function runGenWallets(configPath: string, cfg: Config): Promise<void> {
  const n = cfg.operation.walletCount ?? 0;
  if (n <= 0) {
    console.error("operation.walletCount must be > 0 to generate wallets");
    process.exit(1);
  }
  const existing = cfg.tradingWallets.length;
  const created: { label: string; privateKey: string; address: string }[] = [];
  for (let i = 0; i < n; i++) {
    const w = Wallet.createRandom();
    const label = `w${String(existing + i + 1).padStart(3, "0")}`;
    created.push({ label, privateKey: w.privateKey, address: w.address });
  }
  cfg.tradingWallets.push(...created.map(({ label, privateKey }) => ({ label, privateKey })));
  await saveConfig(configPath, cfg);
  console.log(`Generated ${n} wallets, appended to ${configPath}:`);
  for (const w of created) {
    console.log(`  ${w.label}  ${w.address}`);
  }
  console.log(`Total trading wallets in config: ${cfg.tradingWallets.length}`);
}
