"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { BrowserProvider, getAddress } from "ethers";
import { buildSiweMessage, makeNonce, newSessionExpiry, saveSession, isSessionValid, clearSession, verifySiweMessage } from "@/lib/siwe";

const ADMIN_ADDR_RAW = process.env.NEXT_PUBLIC_ADMIN_ADDRESS ?? "";

declare global {
  interface Window { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }
}

export function SiweGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"checking" | "needs-auth" | "ok" | "denied">("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ADMIN_ADDR_RAW) {
      setError("NEXT_PUBLIC_ADMIN_ADDRESS not configured");
      setStatus("denied");
      return;
    }
    setStatus(isSessionValid() ? "ok" : "needs-auth");
  }, []);

  async function connectAndSign() {
    try {
      if (!window.ethereum) throw new Error("No browser wallet detected");
      const eth = new BrowserProvider(window.ethereum);
      const signer = await eth.getSigner();
      const address = await signer.getAddress();
      const expected = getAddress(ADMIN_ADDR_RAW);
      const got = getAddress(address);
      if (got !== expected) {
        setStatus("denied");
        setError(`Connected wallet ${got} is not the admin (${expected}).`);
        return;
      }
      const nonce = makeNonce();
      const now = new Date();
      const exp = new Date(now.getTime() + 8 * 60 * 60 * 1000);
      const message = buildSiweMessage({
        address: got,
        domain: window.location.host,
        uri: window.location.origin,
        nonce,
        issuedAt: now.toISOString(),
        expirationTime: exp.toISOString(),
        chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 1),
      });
      const sig = await signer.signMessage(message);
      const ok = await verifySiweMessage(message, sig, got);
      if (!ok) throw new Error("Signature verification failed");
      saveSession({ address: got, expiresAt: newSessionExpiry() });
      setStatus("ok");
    } catch (e) {
      setError((e as Error).message ?? "Sign-in failed");
    }
  }

  if (status === "checking") return <div className="p-8">Checking session…</div>;
  if (status === "denied") {
    return (
      <div className="p-8 max-w-md mx-auto mt-24 border border-red-700/40 rounded-md bg-red-900/10">
        <h2 className="text-xl font-semibold text-red-400">Access denied</h2>
        <p className="text-sm mt-2">{error}</p>
      </div>
    );
  }
  if (status === "needs-auth") {
    return (
      <div className="p-8 max-w-md mx-auto mt-24 border border-slate-700 rounded-md">
        <h2 className="text-xl font-semibold">Admin sign-in</h2>
        <p className="text-sm text-slate-400 mt-1">Connect your admin wallet and sign the challenge to continue.</p>
        {error && <p className="text-sm text-red-400 mt-2">{error}</p>}
        <button onClick={connectAndSign} className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded">
          Connect &amp; Sign
        </button>
        <button onClick={() => { clearSession(); setStatus("needs-auth"); }} className="ml-2 mt-4 px-3 py-2 text-slate-400 hover:text-white">
          Clear session
        </button>
      </div>
    );
  }
  return <>{children}</>;
}
