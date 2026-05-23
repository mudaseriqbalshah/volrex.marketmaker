import { describe, it, expect, vi } from "vitest";
import { applySlippage, buildBuyCall, buildSellCall, quoteOut, deadlineFromNow } from "@/lib/router";

describe("router helpers", () => {
  it("applySlippage reduces by bps", () => {
    expect(applySlippage(1_000_000n, 100)).toBe(990_000n); // 1% slippage
    expect(applySlippage(1_000_000n, 500)).toBe(950_000n); // 5%
    expect(applySlippage(1_000_000n, 0)).toBe(1_000_000n);
  });

  it("buildBuyCall encodes ETH->Token swap", () => {
    const c = buildBuyCall({
      tokenIn: "0xweth",
      tokenOut: "0xtkn",
      amountIn: 1_000_000n,
      amountOutMin: 900_000n,
      to: "0xrecipient",
      deadline: 9999999n,
    });
    expect(c.method).toBe("swapExactETHForTokensSupportingFeeOnTransferTokens");
    expect(c.args[0]).toBe(900_000n);
    expect(c.args[1]).toEqual(["0xweth", "0xtkn"]);
    expect(c.args[2]).toBe("0xrecipient");
    expect(c.args[3]).toBe(9999999n);
    expect(c.value).toBe(1_000_000n);
  });

  it("buildSellCall encodes Token->ETH swap", () => {
    const c = buildSellCall({
      tokenIn: "0xtkn",
      tokenOut: "0xweth",
      amountIn: 500n,
      amountOutMin: 480n,
      to: "0xrecipient",
      deadline: 9999999n,
    });
    expect(c.method).toBe("swapExactTokensForETHSupportingFeeOnTransferTokens");
    expect(c.args).toEqual([500n, 480n, ["0xtkn", "0xweth"], "0xrecipient", 9999999n]);
    expect(c.value).toBe(0n);
  });

  it("quoteOut calls getAmountsOut and returns last element", async () => {
    const fake = { getAmountsOut: vi.fn().mockResolvedValue([100n, 200n, 300n]) };
    const out = await quoteOut(fake as never, 100n, ["0xa", "0xb", "0xc"]);
    expect(out).toBe(300n);
  });

  it("deadlineFromNow returns now + seconds as bigint", () => {
    const now = Math.floor(Date.now() / 1000);
    const d = deadlineFromNow(60);
    expect(Number(d)).toBeGreaterThanOrEqual(now + 59);
    expect(Number(d)).toBeLessThanOrEqual(now + 61);
  });
});
