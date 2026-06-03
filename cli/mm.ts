#!/usr/bin/env node
import { parseArgs } from "node:util";
import path from "node:path";
import { loadConfig } from "./config";
import { CliState } from "./state";
import { bootstrap } from "./engine";
import { runDistribute } from "./commands/distribute";
import { runCollect } from "./commands/collect";
import { runFire } from "./commands/fire";
import { runScheduler } from "./commands/scheduler";
import { runBalances } from "./commands/balances";
import { runGenWallets } from "./commands/gen-wallets";
import { runClear } from "./commands/clear";
import { runMultiMM } from "./commands/multi-mm";
import { runAddLiquidity } from "./commands/add-liquidity";

const HELP = `mm — market maker CLI

Usage:
  mm <command> [--config <path>] [overrides]

Commands:
  run                 Run the operation configured in mm.config.yaml
  distribute          Distribute native VLRX to wallets in range
  collect             Collect native VLRX back from wallets in range
  fire                One-shot batch of Buy/Sell across wallets
  scheduler           Long-running random/round-robin scheduler (Ctrl+C to stop)
  multi-mm            Run a market-maker per entry in config.markets concurrently
  add-liquidity       Create pools for every entry in config.liquidityPlan.pools
  balances            Show native + active-token balances for every wallet
  gen-wallets         Generate N wallets and append to the config file
  clear               Remove every action from the local queue state
  help                Show this message

Common flags:
  --config <path>     Path to YAML config file (default: ./mm.config.yaml)
  --range <a-b>       Override walletRange (e.g. 1-50)
  --side <buy|sell|alternate>
  --count <n>         Repetitions per wallet (fire)
  --amount-mode <absolute|percentage>
  --min <v>           Override amountMin
  --max <v>           Override amountMax
  --scheduler-mode <random|roundRobin>
  --wallet-count <n>  Number of wallets to generate (gen-wallets)
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmdName = args[0];
  if (!cmdName || cmdName === "help" || cmdName === "--help" || cmdName === "-h") {
    console.log(HELP);
    return;
  }

  // Parse flags (everything after the command name).
  const { values } = parseArgs({
    args: args.slice(1),
    options: {
      config: { type: "string", default: "./mm.config.yaml" },
      range: { type: "string" },
      side: { type: "string" },
      count: { type: "string" },
      "amount-mode": { type: "string" },
      min: { type: "string" },
      max: { type: "string" },
      "scheduler-mode": { type: "string" },
      "wallet-count": { type: "string" },
      // Skip the queue/worker for distribute (and any future fast-path
      // commands) and broadcast with consecutive nonces concurrently.
      parallel: { type: "boolean", default: false },
      // Number of in-flight broadcasts at once in --parallel mode.
      "batch-size": { type: "string" },
    },
    allowPositionals: true,
  });

  const cfgPath = path.resolve(values.config!);
  const cfg = await loadConfig(cfgPath);

  // Apply CLI flag overrides on top of file config.
  if (values.range) {
    const m = values.range.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!m) {
      console.error(`invalid --range '${values.range}' (expected e.g. 1-50)`);
      process.exit(1);
    }
    cfg.operation.walletRange = [Number(m[1]), Number(m[2])];
  }
  if (values.side) cfg.operation.side = values.side as "buy" | "sell" | "alternate";
  if (values.count) cfg.operation.count = Number(values.count);
  if (values["amount-mode"]) cfg.operation.amountMode = values["amount-mode"] as "absolute" | "percentage";
  // --min / --max override BOTH the generic amount* fields and the
  // distribute-specific override fields. Otherwise a stale `distributeMin`
  // in the YAML would silently win and the CLI flag would be ignored.
  if (values.min) {
    cfg.operation.amountMin = values.min;
    cfg.operation.distributeMin = values.min;
  }
  if (values.max) {
    cfg.operation.amountMax = values.max;
    cfg.operation.distributeMax = values.max;
  }
  if (values["scheduler-mode"]) cfg.operation.schedulerMode = values["scheduler-mode"] as "random" | "roundRobin";
  if (values["wallet-count"]) cfg.operation.walletCount = Number(values["wallet-count"]);

  // gen-wallets doesn't need a full engine; it just edits the config file.
  if (cmdName === "gen-wallets") {
    await runGenWallets(cfgPath, cfg);
    return;
  }

  const state = CliState.fromConfigPath(cfgPath);
  await state.ensureDir();
  const engine = await bootstrap(cfg, state);

  try {
    // Map the command name to the operation type. `mm run` honours
    // operation.type from the config; explicit commands override it.
    const opType =
      cmdName === "run"
        ? cfg.operation.type
        : (cmdName as "distribute" | "collect" | "fire" | "scheduler" | "multi-mm" | "add-liquidity" | "balances" | "clear");

    switch (opType) {
      case "distribute":
        await runDistribute(engine, {
          parallel: values.parallel ?? false,
          batchSize: values["batch-size"] ? Number(values["batch-size"]) : undefined,
        });
        break;
      case "collect":
        await runCollect(engine);
        break;
      case "fire":
        await runFire(engine);
        break;
      case "scheduler":
        await runScheduler(engine);
        break;
      case "multi-mm":
        await runMultiMM(engine);
        break;
      case "add-liquidity":
        await runAddLiquidity(engine);
        break;
      case "balances":
        await runBalances(engine);
        break;
      case "clear":
        await runClear(engine);
        break;
      default:
        console.error(`unknown command: ${cmdName}`);
        console.log(HELP);
        process.exit(1);
    }
  } finally {
    engine.shutdown();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
