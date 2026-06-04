import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import * as YAML from "yaml";

export type ChainCfg = {
  chainId: number;
  rpcUrls: string[];
  routerAddress: string;
  wethAddress: string;
};

export type WalletCfg = {
  label: string;
  privateKey: string;
};

export type TokenCfg = {
  address: string;
  symbol: string;
  decimals: number;
  defaultSlippageBps: number;
};

export type EngineCfg = {
  maxConcurrent: number;
  gasMultiplier: number;
  walletCooldownMs: number;
  txTimeoutMs: number;
};

export type OperationCfg = {
  // Type drives which command runs when you invoke `mm run`.
  type:
    | "fire"
    | "scheduler"
    | "multi-mm"
    | "distribute"
    | "collect"
    | "balances"
    | "gen-wallets"
    | "add-liquidity"
    | "clear";

  // For fire / scheduler — which wallets to target.
  // [from, to] is 1-based, inclusive. Use "all" for everyone.
  walletRange?: [number, number] | "all";

  // For fire — direction.
  side?: "buy" | "sell" | "alternate";

  // For fire / scheduler — Absolute (literal amount) or Percentage of balance.
  amountMode?: "absolute" | "percentage";
  amountMin?: string;
  amountMax?: string;

  // For fire — repetitions per wallet (so wallets×count total actions).
  count?: number;

  // For distribute — per-wallet native amount range.
  distributeMin?: string;
  distributeMax?: string;

  // For scheduler — random vs round-robin vs price-aware market maker.
  schedulerMode?: "random" | "roundRobin" | "marketMaker";
  schedulerMinDelayMs?: number;
  schedulerMaxDelayMs?: number;
  schedulerCycleDelayMs?: number;
  schedulerBuyRatio?: number;

  // marketMaker mode only:
  // Native amount per 1 token (string, in native units, e.g. "0.0001"
  // means 1 token = 0.0001 VLRX). If omitted, the scheduler captures
  // the price observed at start and defends that.
  mmTargetPrice?: string;
  // Band width in basis points (200 = ±2%). Buys fire below the band,
  // sells fire above; within the band emissions are random.
  mmToleranceBps?: number;
  // How often (ms) the MM checks the pool price and emits an action.
  mmIntervalMs?: number;
  // Optional per-side amount overrides. If set they win over the
  // shared amountMode / amountMin / amountMax. Use this to size Buys
  // and Sells differently — e.g. Buy 1–20 VLRX absolute, Sell 80–100%
  // of token balance.
  mmBuyMode?: "absolute" | "percentage";
  mmBuyMin?: string;
  mmBuyMax?: string;
  mmSellMode?: "absolute" | "percentage";
  mmSellMin?: string;
  mmSellMax?: string;

  // For gen-wallets — how many to create.
  walletCount?: number;
};

// One market for the multi-mm command. Each market drives its own
// MarketMakerScheduler against a different token + wallet slice.
// Wallet ranges must not overlap across markets (otherwise multiple
// schedulers would dispatch from the same wallet and fight over
// nonces).
export type MarketCfg = {
  token: TokenCfg;
  walletRange: [number, number] | "all";

  // Either explicit target price OR multiplier-of-current.
  mmTargetPrice?: string;
  // If set and no mmTargetPrice, target = currentPrice × multiplier
  // (computed once at startup from the live pool quote).
  // e.g. "1.25" means push price up by 25%.
  mmTargetMultiplier?: string;

  mmToleranceBps?: number;
  mmIntervalMs?: number;

  // Per-side amount config (same shape as the single-token mode).
  amountMode?: "absolute" | "percentage";
  amountMin?: string;
  amountMax?: string;
  mmBuyMode?: "absolute" | "percentage";
  mmBuyMin?: string;
  mmBuyMax?: string;
  mmSellMode?: "absolute" | "percentage";
  mmSellMin?: string;
  mmSellMax?: string;
};

// One pool to seed in the `add-liquidity` command.
// nativeAmount and tokenAmount are human-readable decimal strings;
// the script multiplies by 10^18 (native) and 10^decimals (token).
// initialPrice = nativeAmount / tokenAmount automatically.
export type LiquidityPoolCfg = {
  symbol: string;
  token: string;            // ERC-20 address
  decimals: number;
  nativeAmount: string;     // VLRX side
  tokenAmount: string;      // Token side
};

export type LiquidityPlanCfg = {
  // Address that will receive the LP tokens. Defaults to the
  // funding wallet's address if omitted.
  recipient?: string;
  // How long (seconds) the swap-router deadline is from "now". 600s
  // (10 minutes) is a safe default for slow chains.
  deadlineSec?: number;
  pools: LiquidityPoolCfg[];
};

export type Config = {
  chain: ChainCfg;
  fundingWallet: { privateKey: string };
  tradingWallets: WalletCfg[];
  // Optional: path (relative to mm.config.yaml) of an external JSON
  // file holding the wallets. Used for huge wallet sets (10k+) that
  // would make the YAML unmanageable. If set, the JSON file's array
  // wins; the YAML's tradingWallets field is ignored.
  walletsFile?: string;
  token: TokenCfg;
  engine: EngineCfg;
  operation: OperationCfg;
  // Optional: list of markets for the multi-mm command. Ignored by
  // every other command, which operate on the single `token` field.
  markets?: MarketCfg[];
  // Optional: pool-creation plan for `add-liquidity`. Funding wallet
  // must hold enough native VLRX AND enough of each token.
  liquidityPlan?: LiquidityPlanCfg;
};

export async function loadConfig(configPath: string): Promise<Config> {
  const raw = await readFile(configPath, "utf8");
  const parsed = YAML.parse(raw) as Config;
  // Resolve external wallets file if specified — load it BEFORE
  // validation so the tradingWallets check sees the merged array.
  if (parsed.walletsFile) {
    const walletsPath = path.resolve(path.dirname(path.resolve(configPath)), parsed.walletsFile);
    if (!existsSync(walletsPath)) {
      // Empty file is OK — gen-wallets will create it.
      parsed.tradingWallets = parsed.tradingWallets ?? [];
    } else {
      const t0 = Date.now();
      const wraw = await readFile(walletsPath, "utf8");
      const wallets = JSON.parse(wraw) as WalletCfg[];
      parsed.tradingWallets = wallets;
      const dt = Date.now() - t0;
      if (wallets.length > 1000) {
        // Only chatter for big sets so single-token configs stay quiet.
        console.error(`Loaded ${wallets.length} trading wallets from ${parsed.walletsFile} (${dt}ms)`);
      }
    }
  }
  validate(parsed);
  return parsed;
}

// Append new wallets to the external wallets file (or, if no walletsFile
// is configured, fall back to writing them inline into the YAML).
// Used by gen-wallets so a 75k-wallet job doesn't bloat mm.config.yaml.
export async function appendWalletsExternal(
  configPath: string,
  cfg: Config,
  newOnes: WalletCfg[],
): Promise<{ usedExternal: boolean; path: string | null }> {
  if (!cfg.walletsFile) return { usedExternal: false, path: null };
  const walletsPath = path.resolve(path.dirname(path.resolve(configPath)), cfg.walletsFile);
  const existing: WalletCfg[] = existsSync(walletsPath)
    ? (JSON.parse(await readFile(walletsPath, "utf8")) as WalletCfg[])
    : [];
  const merged = [...existing, ...newOnes];
  await writeFile(walletsPath, JSON.stringify(merged), { mode: 0o600 });
  cfg.tradingWallets = merged;
  return { usedExternal: true, path: walletsPath };
}

export async function saveConfig(path: string, cfg: Config): Promise<void> {
  const text = YAML.stringify(cfg, { lineWidth: 120 });
  await writeFile(path, text, { mode: 0o600 });
}

function validate(c: unknown): asserts c is Config {
  const o = c as Partial<Config> | null;
  if (!o || typeof o !== "object") throw new Error("config must be an object");
  if (!o.chain) throw new Error("config.chain missing");
  if (!o.chain.chainId) throw new Error("config.chain.chainId missing");
  if (!o.chain.rpcUrls?.length) throw new Error("config.chain.rpcUrls missing or empty");
  if (!o.chain.routerAddress) throw new Error("config.chain.routerAddress missing");
  if (!o.chain.wethAddress) throw new Error("config.chain.wethAddress missing");
  if (!o.fundingWallet?.privateKey) throw new Error("config.fundingWallet.privateKey missing");
  if (!Array.isArray(o.tradingWallets)) throw new Error("config.tradingWallets must be an array");
  if (!o.token?.address) throw new Error("config.token.address missing");
  if (!o.engine) throw new Error("config.engine missing");
  if (!o.operation?.type) throw new Error("config.operation.type missing");
}

// Resolve 1-based wallet range against the trading wallets list.
// Returns the slice of wallets to operate on.
export function resolveWalletRange(cfg: Config, range: OperationCfg["walletRange"]): WalletCfg[] {
  if (!range || range === "all") return cfg.tradingWallets;
  const [from, to] = range;
  const lo = Math.max(1, from);
  const hi = Math.min(cfg.tradingWallets.length, to);
  return cfg.tradingWallets.slice(lo - 1, hi);
}
