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
  rpcUrl: string;
  chainId: number;
  routerAddress: string;
  wethAddress: string;
  maxConcurrent: number;
  gasMultiplier: number;
  balancePollMs: number;
  autoLockIdleMs: number;
  // Minimum gap between dispatches to the same wallet (ms). Lets the pool
  // settle between back-to-back swaps and avoids same-block competition.
  walletCooldownMs: number;
  // Per-tx timeout (ms). If broadcast or confirmation takes longer than
  // this, the dispatch throws TIMEOUT and the worker moves to the next
  // action so a single stuck tx doesn't block a wallet forever.
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
const ENV_CHAIN_ID = process.env.NEXT_PUBLIC_CHAIN_ID ?? "";
const ENV_ROUTER = process.env.NEXT_PUBLIC_ROUTER_ADDRESS ?? "";
const ENV_WETH = process.env.NEXT_PUBLIC_WETH_ADDRESS ?? "";

export const DEFAULT_SETTINGS: Settings = {
  rpcUrl: ENV_RPC || "https://rpc.volrex.network/",
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
