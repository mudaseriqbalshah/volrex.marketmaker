import { describe, it, expect, vi } from "vitest";
import { getErc20Metadata, getErc20Balance, getErc20Allowance, buildApproveTx, buildTransferTx } from "@/lib/erc20";

function mockContract(returns: Record<string, unknown>) {
  return new Proxy({} as Record<string, (...args: unknown[]) => unknown>, {
    get: (_t, prop: string) => {
      if (prop in returns) return vi.fn().mockResolvedValue(returns[prop]);
      return vi.fn();
    },
  });
}

describe("erc20", () => {
  it("getErc20Metadata reads symbol+decimals", async () => {
    const c = mockContract({ symbol: "TKN", decimals: 18n });
    const m = await getErc20Metadata(c as never);
    expect(m).toEqual({ symbol: "TKN", decimals: 18 });
  });

  it("getErc20Balance returns bigint", async () => {
    const c = mockContract({ balanceOf: 1000n });
    expect(await getErc20Balance(c as never, "0xabc")).toBe(1000n);
  });

  it("getErc20Allowance returns bigint", async () => {
    const c = mockContract({ allowance: 500n });
    expect(await getErc20Allowance(c as never, "0xa", "0xb")).toBe(500n);
  });

  it("buildApproveTx returns calldata-like object", () => {
    const tx = buildApproveTx("0xrouter", 12345n);
    expect(tx.method).toBe("approve");
    expect(tx.args).toEqual(["0xrouter", 12345n]);
  });

  it("buildTransferTx returns calldata-like object", () => {
    const tx = buildTransferTx("0xto", 99n);
    expect(tx.method).toBe("transfer");
    expect(tx.args).toEqual(["0xto", 99n]);
  });
});
