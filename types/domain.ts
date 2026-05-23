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
};

export type VaultData = {
  version: 1;
  adminFundingWallet: { address: string; privateKey: string } | null;
  tradingWallets: TradingWallet[];
  tokens: TokenConfig[];
  activeTokenAddress: string | null;
  settings: Settings;
};

export const DEFAULT_SETTINGS: Settings = {
  rpcUrl: "https://rpc.volrex.network/",
  chainId: 1378,
  routerAddress: "",
  wethAddress: "",
  maxConcurrent: 5,
  gasMultiplier: 1.1,
  balancePollMs: 15_000,
  autoLockIdleMs: 30 * 60 * 1000,
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
