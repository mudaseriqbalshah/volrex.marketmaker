"use client";

import { useState } from "react";
import { useVault } from "@/contexts/VaultContext";
import { useEngine } from "@/contexts/EngineContext";

export function QuickFire() {
  const vault = useVault();
  const engine = useEngine();
  const [walletId, setWalletId] = useState<string>("");
  const [side, setSide] = useState<"Buy" | "Sell">("Buy");
  const [amount, setAmount] = useState("0.01");

  const token = vault.data?.tokens.find((t) => t.address === vault.data?.activeTokenAddress);

  async function fire() {
    if (!walletId || !token) return;
    if (side === "Buy") {
      await engine.enqueue({ kind: "Buy", walletId, params: { tokenAddress: token.address, amountNative: amount, slippageBps: token.defaultSlippageBps } });
    } else {
      await engine.enqueue({ kind: "Sell", walletId, params: { tokenAddress: token.address, amountToken: amount, slippageBps: token.defaultSlippageBps } });
    }
  }

  return (
    <div className="border border-slate-800 rounded p-4">
      <h3 className="text-md font-semibold mb-2">Quick fire</h3>
      <div className="text-xs text-slate-400">Active token: {token?.symbol ?? "—"}</div>
      <div className="grid grid-cols-3 gap-2 mt-3">
        <select value={walletId} onChange={(e) => setWalletId(e.target.value)} className="px-3 py-2 bg-slate-950 border border-slate-700 rounded">
          <option value="">— wallet —</option>
          {vault.data?.tradingWallets.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
        </select>
        <select value={side} onChange={(e) => setSide(e.target.value as "Buy" | "Sell")} className="px-3 py-2 bg-slate-950 border border-slate-700 rounded">
          <option value="Buy">Buy</option>
          <option value="Sell">Sell</option>
        </select>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} className="px-3 py-2 bg-slate-950 border border-slate-700 rounded" />
      </div>
      <button onClick={fire} disabled={!walletId || !token} className="mt-3 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm disabled:opacity-50">Send</button>
    </div>
  );
}
