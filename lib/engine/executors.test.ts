import { describe, it, expect, vi } from "vitest";
import { parseEther } from "ethers";
import { executeTransferETH, executeTransferToken, executeBuy, executeSell, executeApprove } from "@/lib/engine/executors";

function mockSigner() {
  const sendTransaction = vi.fn().mockResolvedValue({ hash: "0xhash", wait: vi.fn().mockResolvedValue({ status: 1 }) });
  const address = "0xaaa";
  return { sendTransaction, address, getAddress: vi.fn().mockResolvedValue(address) };
}

describe("executors", () => {
  it("executeTransferETH sends a value tx and waits", async () => {
    const signer = mockSigner();
    const ctx = { signer: signer as never, nonce: 7, gasPrice: 1n, gasMultiplier: 1.0 };
    const res = await executeTransferETH(ctx, { to: "0xbbb", amount: parseEther("1") });
    expect(signer.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ to: "0xbbb", value: parseEther("1"), nonce: 7 }));
    expect(res.txHash).toBe("0xhash");
  });

  it("executeTransferToken calls erc20 contract", async () => {
    const signer = mockSigner();
    const contract = {
      transfer: { populateTransaction: vi.fn().mockResolvedValue({ to: "0xtoken", data: "0xdeadbeef" }) },
    };
    const ctx = { signer: signer as never, nonce: 7, gasPrice: 1n, gasMultiplier: 1.0, makeErc20: () => contract as never };
    const res = await executeTransferToken(ctx, { tokenAddress: "0xtoken", to: "0xbbb", amount: 100n });
    expect(res.txHash).toBe("0xhash");
  });

  it("executeBuy builds a router call and sends", async () => {
    const signer = mockSigner();
    const router = {
      swapExactETHForTokensSupportingFeeOnTransferTokens: { populateTransaction: vi.fn().mockResolvedValue({ to: "0xrouter", data: "0xabc" }) },
      getAmountsOut: vi.fn().mockResolvedValue([100n, 200n]),
    };
    const ctx = {
      signer: signer as never, nonce: 7, gasPrice: 1n, gasMultiplier: 1.0,
      router: router as never,
      wethAddress: "0xweth",
    };
    const res = await executeBuy(ctx, { tokenAddress: "0xtkn", amountNative: parseEther("1"), slippageBps: 100 });
    expect(res.txHash).toBe("0xhash");
  });

  it("executeApprove sends approve()", async () => {
    const signer = mockSigner();
    const contract = { approve: { populateTransaction: vi.fn().mockResolvedValue({ to: "0xtkn", data: "0xfeed" }) } };
    const ctx = { signer: signer as never, nonce: 7, gasPrice: 1n, gasMultiplier: 1.0, makeErc20: () => contract as never };
    const res = await executeApprove(ctx, { tokenAddress: "0xtkn", spender: "0xrouter", amount: 999n });
    expect(res.txHash).toBe("0xhash");
  });

  it("executeSell builds a sell router call and sends", async () => {
    const signer = mockSigner();
    const router = {
      swapExactTokensForETHSupportingFeeOnTransferTokens: { populateTransaction: vi.fn().mockResolvedValue({ to: "0xrouter", data: "0xabc" }) },
      getAmountsOut: vi.fn().mockResolvedValue([100n, 50n]),
    };
    const ctx = {
      signer: signer as never, nonce: 7, gasPrice: 1n, gasMultiplier: 1.0,
      router: router as never,
      wethAddress: "0xweth",
    };
    const res = await executeSell(ctx, { tokenAddress: "0xtkn", amountToken: 100n, slippageBps: 200 });
    expect(res.txHash).toBe("0xhash");
  });
});
