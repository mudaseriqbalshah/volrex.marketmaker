import { writeFile } from "node:fs/promises";
import path from "node:path";
import { type Config, saveConfig } from "../config";

// One-shot helper for users who already have a giant tradingWallets
// array baked into mm.config.yaml. Moves the array out to
// mm.wallets.json and sets `walletsFile: "mm.wallets.json"` on the
// YAML so future loads use the fast JSON file.
export async function runMigrateWallets(configPath: string, cfg: Config): Promise<void> {
  if (cfg.walletsFile) {
    console.log(`Config already has walletsFile: ${cfg.walletsFile} — nothing to migrate.`);
    console.log(`Inline tradingWallets currently: ${cfg.tradingWallets.length}`);
    if (cfg.tradingWallets.length > 0) {
      console.log("");
      console.log("⚠  Both walletsFile and an inline list are present. The external");
      console.log("   file wins at load time; the inline list is dead weight.");
      console.log("   Run this command WITHOUT walletsFile set to merge them, or");
      console.log("   delete the tradingWallets array manually.");
    }
    return;
  }
  if (cfg.tradingWallets.length === 0) {
    console.log("No inline trading wallets to migrate.");
    return;
  }
  const outFile = "mm.wallets.json";
  const outPath = path.resolve(path.dirname(path.resolve(configPath)), outFile);
  const n = cfg.tradingWallets.length;

  console.log(`Migrating ${n} wallets from mm.config.yaml inline → ${outFile}…`);
  const t0 = Date.now();

  // Write the external file first, BEFORE editing the YAML. If anything
  // goes wrong with the JSON write we don't lose the wallets.
  await writeFile(outPath, JSON.stringify(cfg.tradingWallets), { mode: 0o600 });
  console.log(`  Wrote ${outPath}`);

  // Now rewrite mm.config.yaml with walletsFile + empty tradingWallets.
  cfg.walletsFile = outFile;
  cfg.tradingWallets = [];
  await saveConfig(configPath, cfg);
  console.log(`  Updated ${configPath} (walletsFile set, tradingWallets emptied)`);

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone in ${dt}s.`);
  console.log("Subsequent loads will pick up wallets from mm.wallets.json (fast).");
}
