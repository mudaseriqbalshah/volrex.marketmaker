import { JsonRpcProvider, Network } from "ethers";

export type ChainConfig = {
  // Single URL kept for backward-compat with old vaults / single-URL setups.
  // If rpcUrls is provided, that wins.
  rpcUrl?: string;
  rpcUrls?: string[];
  chainId: number;
  name: string;
};

export const DEFAULT_CHAIN: ChainConfig = {
  rpcUrl: "https://rpc.volrex.network/",
  rpcUrls: ["https://rpc.volrex.network/"],
  chainId: 1378,
  name: "volrex",
};

function resolveUrls(cfg: ChainConfig): string[] {
  const fromArray = (cfg.rpcUrls ?? []).map((u) => u.trim()).filter(Boolean);
  if (fromArray.length > 0) return fromArray;
  if (cfg.rpcUrl && cfg.rpcUrl.trim()) return [cfg.rpcUrl.trim()];
  return [];
}

// Build a JsonRpcProvider. With 1 URL it's the regular ethers provider; with
// 2+ URLs it returns a Proxy that round-robins each method call across the
// underlying providers — gives load distribution and natural fallback (if
// one node returns an error, the next call hits a different node).
//
// Replication caveat: pollers like `tx.wait()` make repeated `getReceipt`
// calls; each one round-robins. If an RPC is slightly behind it may say
// "not found" for one poll, but a subsequent poll on another RPC will see
// the receipt. This is normally fine; if a node is far behind, our per-tx
// timeout (Settings.txTimeoutMs) bails out cleanly.
export function makeProvider(cfg: ChainConfig): JsonRpcProvider {
  const urls = resolveUrls(cfg);
  if (urls.length === 0) {
    throw new Error("makeProvider: at least one RPC URL is required");
  }
  const network = new Network(cfg.name, cfg.chainId);
  if (urls.length === 1) {
    return new JsonRpcProvider(urls[0], network, { staticNetwork: network });
  }
  const providers = urls.map((url) => new JsonRpcProvider(url, network, { staticNetwork: network }));
  let counter = 0;
  // Proxy returns the next underlying provider's method on each property
  // access. This works for ethers because Contract/Wallet store the provider
  // and dispatch method calls back to it — every call lands here.
  return new Proxy(providers[0]!, {
    get(_target, prop, receiver) {
      const p = providers[counter++ % providers.length]!;
      const value = Reflect.get(p, prop, receiver);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(p) : value;
    },
  }) as JsonRpcProvider;
}
