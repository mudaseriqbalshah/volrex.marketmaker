import { JsonRpcProvider, Network } from "ethers";

export type ChainConfig = {
  rpcUrl: string;
  chainId: number;
  name: string;
};

export const DEFAULT_CHAIN: ChainConfig = {
  rpcUrl: "https://rpc.volrex.network/",
  chainId: 1378,
  name: "volrex",
};

export function makeProvider(cfg: ChainConfig): JsonRpcProvider {
  const network = new Network(cfg.name, cfg.chainId);
  return new JsonRpcProvider(cfg.rpcUrl, network, { staticNetwork: network });
}
