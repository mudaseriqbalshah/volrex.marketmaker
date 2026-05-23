import { describe, it, expect } from "vitest";
import { makeProvider, DEFAULT_CHAIN } from "@/lib/chain";

describe("chain", () => {
  it("DEFAULT_CHAIN matches Volrex config", () => {
    expect(DEFAULT_CHAIN.chainId).toBe(1378);
    expect(DEFAULT_CHAIN.rpcUrl).toBe("https://rpc.volrex.network/");
  });

  it("makeProvider returns a JsonRpcProvider for given config", () => {
    const p = makeProvider({ rpcUrl: "http://localhost:8545", chainId: 31337, name: "hardhat" });
    expect(p).toBeDefined();
    expect(p._getConnection().url).toBe("http://localhost:8545");
  });
});
