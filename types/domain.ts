export type TradingWallet = {
  id: string;
  label: string;
  address: string;
  privateKey: string;
};

export type TokenConfig = {
  address: string;
  symbol: string;
  decimals: number;
  defaultSlippageBps: number;
  routerOverride?: string;
};

export type Settings = {
  // Legacy single RPC URL. Kept for backward-compat with vaults saved
  // before rpcUrls existed; new code reads rpcUrls first and falls back
  // to [rpcUrl] if it's empty.
  rpcUrl: string;
  // List of RPC URLs to round-robin across for load balancing + fallback.
  // Calls are distributed across these on each invocation.
  rpcUrls: string[];
  chainId: number;
  routerAddress: string;
  wethAddress: string;
  maxConcurrent: number;
  gasMultiplier: number;
  balancePollMs: number;
  autoLockIdleMs: number;
  walletCooldownMs: number;
  txTimeoutMs: number;
};

export type VaultData = {
  version: 1;
  adminFundingWallet: { address: string; privateKey: string } | null;
  tradingWallets: TradingWallet[];
  tokens: TokenConfig[];
  activeTokenAddress: string | null;
  settings: Settings;
};

// Pull NEXT_PUBLIC_* env vars at module load so fresh vaults pre-fill
// settings. Existing vaults persist whatever was saved — EngineContext
// applies env fallback at dispatch time to cover the migration case.
const ENV_RPC = process.env.NEXT_PUBLIC_RPC_URL ?? "";
// NEXT_PUBLIC_RPC_URLS can be a comma-separated list for multi-node setups.
// Falls back to NEXT_PUBLIC_RPC_URL (single) if not set.
const ENV_RPC_URLS = process.env.NEXT_PUBLIC_RPC_URLS ?? "";
const ENV_CHAIN_ID = process.env.NEXT_PUBLIC_CHAIN_ID ?? "";
const ENV_ROUTER = process.env.NEXT_PUBLIC_ROUTER_ADDRESS ?? "";
const ENV_WETH = process.env.NEXT_PUBLIC_WETH_ADDRESS ?? "";

function parseUrlList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const DEFAULT_RPC = ENV_RPC || "https://rpc.volrex.network/";
const DEFAULT_RPC_URLS = parseUrlList(ENV_RPC_URLS);

export const DEFAULT_SETTINGS: Settings = {
  rpcUrl: DEFAULT_RPC,
  rpcUrls: DEFAULT_RPC_URLS.length > 0 ? DEFAULT_RPC_URLS : [DEFAULT_RPC],
  chainId: Number(ENV_CHAIN_ID) || 1378,
  routerAddress: ENV_ROUTER,
  wethAddress: ENV_WETH,
  maxConcurrent: 5,
  gasMultiplier: 1.1,
  balancePollMs: 15_000,
  autoLockIdleMs: 30 * 60 * 1000,
  walletCooldownMs: 3_000,
  txTimeoutMs: 45_000,
};

// Resolve the effective RPC URL list from a possibly-stale Settings object.
// Used by callers that need to handle old vaults missing rpcUrls.
export function effectiveRpcUrls(s: Pick<Settings, "rpcUrls" | "rpcUrl">): string[] {
  const fromArray = (s.rpcUrls ?? []).map((u) => u.trim()).filter(Boolean);
  if (fromArray.length > 0) return fromArray;
  if (s.rpcUrl && s.rpcUrl.trim()) return [s.rpcUrl.trim()];
  return [];
}

export function emptyVault(): VaultData {
  return {
    version: 1,
    adminFundingWallet: null,
    tradingWallets: [],
    tokens: [],
    activeTokenAddress: null,
    settings: { ...DEFAULT_SETTINGS },
  };
}
