import { describe, it, expect, beforeEach } from "vitest";
import { initializeVault, unlockVault, saveVault, vaultExists, wipeVault } from "@/lib/vault";
import { emptyVault } from "@/types/domain";

describe("vault", () => {
  beforeEach(() => localStorage.clear());

  it("vaultExists reflects state", async () => {
    expect(vaultExists()).toBe(false);
    await initializeVault("pw", emptyVault());
    expect(vaultExists()).toBe(true);
  });

  it("initialize then unlock returns same data", async () => {
    const v = emptyVault();
    v.tokens.push({ address: "0xabc", symbol: "TKN", decimals: 18, defaultSlippageBps: 100 });
    await initializeVault("pw", v);
    const { data } = await unlockVault("pw");
    expect(data.tokens).toHaveLength(1);
    expect(data.tokens[0]?.symbol).toBe("TKN");
  });

  it("wrong password fails unlock", async () => {
    await initializeVault("right", emptyVault());
    await expect(unlockVault("wrong")).rejects.toThrow();
  });

  it("saveVault overwrites and re-decrypts", async () => {
    const { key } = await initializeVault("pw", emptyVault());
    const v = emptyVault();
    v.tradingWallets.push({ id: "w1", label: "w1", address: "0x1", privateKey: "0xkey" });
    await saveVault(v, key);
    const { data } = await unlockVault("pw");
    expect(data.tradingWallets).toHaveLength(1);
  });

  it("wipeVault clears storage", async () => {
    await initializeVault("pw", emptyVault());
    wipeVault();
    expect(vaultExists()).toBe(false);
  });
});
