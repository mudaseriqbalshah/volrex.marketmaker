import { readFile, writeFile } from "node:fs/promises";
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
    | "distribute"
    | "collect"
    | "balances"
    | "gen-wallets"
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

  // For gen-wallets — how many to create.
  walletCount?: number;
};

export type Config = {
  chain: ChainCfg;
  fundingWallet: { privateKey: string };
  tradingWallets: WalletCfg[];
  token: TokenCfg;
  engine: EngineCfg;
  operation: OperationCfg;
};

export async function loadConfig(path: string): Promise<Config> {
  const raw = await readFile(path, "utf8");
  const parsed = YAML.parse(raw) as Config;
  validate(parsed);
  return parsed;
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
