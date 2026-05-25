import { describe, it, expect } from "vitest";
import { makeProvider, DEFAULT_CHAIN } from "@/lib/chain";

describe("chain", () => {
  it("DEFAULT_CHAIN matches Volrex config", () => {
    expect(DEFAULT_CHAIN.chainId).toBe(1378);
    expect(DEFAULT_CHAIN.rpcUrl).toBe("https://rpc.volrex.network/");
  });

  it("makeProvider returns a JsonRpcProvider for a single rpcUrl", () => {
    const p = makeProvider({ rpcUrl: "http://localhost:8545", chainId: 31337, name: "hardhat" });
    expect(p).toBeDefined();
    expect(p._getConnection().url).toBe("http://localhost:8545");
  });

  it("makeProvider returns a JsonRpcProvider for a single rpcUrls entry", () => {
    const p = makeProvider({ rpcUrls: ["http://localhost:8545"], chainId: 31337, name: "hardhat" });
    expect(p).toBeDefined();
    expect(p._getConnection().url).toBe("http://localhost:8545");
  });

  it("makeProvider with multiple rpcUrls returns a round-robin proxy", () => {
    const p = makeProvider({
      rpcUrls: ["http://node-a:8545", "http://node-b:8545"],
      chainId: 31337,
      name: "hardhat",
    });
    // The proxy delegates to one of the underlying providers; both share the
    // same chain. We can still query connection URL via the proxy and get a
    // valid string (will be one of the two URLs).
    expect(p).toBeDefined();
    const url = p._getConnection().url;
    expect(["http://node-a:8545", "http://node-b:8545"]).toContain(url);
  });

  it("makeProvider throws when no URLs are provided", () => {
    expect(() => makeProvider({ chainId: 31337, name: "hardhat" })).toThrow();
    expect(() => makeProvider({ rpcUrls: [], chainId: 31337, name: "hardhat" })).toThrow();
  });

  it("makeProvider trims whitespace and ignores blank entries", () => {
    const p = makeProvider({
      rpcUrls: ["  ", "http://localhost:8545  ", ""],
      chainId: 31337,
      name: "hardhat",
    });
    expect(p._getConnection().url).toBe("http://localhost:8545");
  });
});
