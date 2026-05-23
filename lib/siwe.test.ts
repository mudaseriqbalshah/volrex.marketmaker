import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildSiweMessage, verifySiweMessage, saveSession, loadSession, clearSession, isSessionValid } from "@/lib/siwe";
import { Wallet } from "ethers";

describe("siwe", () => {
  beforeEach(() => sessionStorage.clear());

  it("builds a message containing address, nonce, expiry", () => {
    const msg = buildSiweMessage({
      address: "0x1111111111111111111111111111111111111111",
      domain: "localhost",
      uri: "http://localhost:3000",
      nonce: "abc12345",
      issuedAt: "2026-05-23T00:00:00.000Z",
      expirationTime: "2026-05-23T08:00:00.000Z",
      chainId: 1378,
    });
    expect(msg).toContain("0x1111111111111111111111111111111111111111");
    expect(msg).toContain("abc12345");
    expect(msg).toContain("2026-05-23T08:00:00.000Z");
  });

  it("verifies a signature against the expected admin address", async () => {
    const wallet = Wallet.createRandom();
    const message = buildSiweMessage({
      address: wallet.address,
      domain: "localhost",
      uri: "http://localhost:3000",
      nonce: "n",
      issuedAt: "2026-05-23T00:00:00.000Z",
      expirationTime: "2026-05-23T08:00:00.000Z",
      chainId: 1378,
    });
    const sig = await wallet.signMessage(message);
    const ok = await verifySiweMessage(message, sig, wallet.address);
    expect(ok).toBe(true);
  });

  it("rejects signature from non-admin", async () => {
    const admin = Wallet.createRandom();
    const other = Wallet.createRandom();
    const message = buildSiweMessage({
      address: other.address,
      domain: "localhost",
      uri: "http://localhost:3000",
      nonce: "n",
      issuedAt: "2026-05-23T00:00:00.000Z",
      expirationTime: "2026-05-23T08:00:00.000Z",
      chainId: 1378,
    });
    const sig = await other.signMessage(message);
    expect(await verifySiweMessage(message, sig, admin.address)).toBe(false);
  });

  it("session round-trips through sessionStorage", () => {
    expect(loadSession()).toBeNull();
    const expiresAt = Date.now() + 3600_000;
    saveSession({ address: "0xabc", expiresAt });
    expect(loadSession()).toEqual({ address: "0xabc", expiresAt });
  });

  it("isSessionValid checks expiry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-23T00:00:00Z"));
    saveSession({ address: "0xabc", expiresAt: Date.now() + 1000 });
    expect(isSessionValid()).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(isSessionValid()).toBe(false);
    vi.useRealTimers();
  });

  it("clearSession wipes", () => {
    saveSession({ address: "0xabc", expiresAt: Date.now() + 1000 });
    clearSession();
    expect(loadSession()).toBeNull();
  });
});
