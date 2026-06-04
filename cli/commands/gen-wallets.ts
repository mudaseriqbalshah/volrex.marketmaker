import { Wallet } from "ethers";
import { type Config, type WalletCfg, saveConfig, appendWalletsExternal } from "../config";

// Generate N wallets and append them either to the configured external
// walletsFile (recommended for large batches) or to the inline
// tradingWallets array in mm.config.yaml (default).
//
// Labels are auto-assigned w-prefixed zero-padded numbers continuing
// from however many wallets already exist:
//   w00001, w00002, ... w75000
export async function runGenWallets(configPath: string, cfg: Config): Promise<void> {
  const n = cfg.operation.walletCount ?? 0;
  if (n <= 0) {
    console.error("operation.walletCount must be > 0 to generate wallets");
    process.exit(1);
  }
  const existing = cfg.tradingWallets.length;
  const totalAfter = existing + n;
  const padWidth = Math.max(5, String(totalAfter).length);

  const useExternal = !!cfg.walletsFile;
  console.log(
    `Generating ${n} wallets${useExternal ? ` → ${cfg.walletsFile}` : " → mm.config.yaml inline"}…`,
  );

  const t0 = Date.now();
  const created: { label: string; privateKey: string; address: string }[] = [];
  // Progress every 1000 wallets so 75k jobs feel responsive.
  const progressEvery = n >= 5000 ? 5000 : (n >= 500 ? 500 : Infinity);
  for (let i = 0; i < n; i++) {
    const w = Wallet.createRandom();
    const labelNum = existing + i + 1;
    const label = `w${String(labelNum).padStart(padWidth, "0")}`;
    created.push({ label, privateKey: w.privateKey, address: w.address });
    if ((i + 1) % progressEvery === 0) {
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  ${i + 1}/${n} generated (${dt}s)`);
    }
  }

  if (useExternal) {
    const newOnes: WalletCfg[] = created.map(({ label, privateKey }) => ({ label, privateKey }));
    const { path: out } = await appendWalletsExternal(configPath, cfg, newOnes);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\nDone in ${dt}s. ${n} wallets appended to ${out}.`);
    console.log(`Total trading wallets now: ${cfg.tradingWallets.length}`);
    // Don't rewrite the YAML config — we only touched the external file.
  } else {
    cfg.tradingWallets.push(...created.map(({ label, privateKey }) => ({ label, privateKey })));
    await saveConfig(configPath, cfg);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\nDone in ${dt}s. Appended to ${configPath}.`);
    console.log(`Total trading wallets now: ${cfg.tradingWallets.length}`);
    if (n >= 500 && !cfg.walletsFile) {
      console.log("");
      console.log("⚠  For 500+ wallets, prefer the external file approach to keep the YAML small.");
      console.log("   Add this to mm.config.yaml: `walletsFile: \"mm.wallets.json\"`");
      console.log("   then re-run with a fresh config (wallets will go there next time).");
    }
  }

  // Print the first and last few so the user can spot-check.
  const showHead = created.slice(0, 3);
  const showTail = created.slice(-3);
  console.log("");
  console.log("First/last few:");
  for (const w of showHead) console.log(`  ${w.label}  ${w.address}`);
  if (created.length > 6) console.log(`  ... (${created.length - 6} more)`);
  for (const w of showTail) console.log(`  ${w.label}  ${w.address}`);
}
