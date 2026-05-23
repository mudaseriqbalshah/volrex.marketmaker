"use client";

import { useState } from "react";
import { useVault } from "@/contexts/VaultContext";
import { useEngine } from "@/contexts/EngineContext";

const ALL_WALLETS = "__all__";

export function QuickFire() {
  const vault = useVault();
  const engine = useEngine();
  const [walletId, setWalletId] = useState<string>("");
  const [side, setSide] = useState<"Buy" | "Sell" | "Alternate">("Buy");
  const [amount, setAmount] = useState("0.01");
  const [count, setCount] = useState(1);

  const token = vault.data?.tokens.find((t) => t.address === vault.data?.activeTokenAddress);
  const tradingWallets = vault.data?.tradingWallets ?? [];

  async function fire() {
    if (!walletId || !token || count < 1) return;
    const targetWalletIds = walletId === ALL_WALLETS
      ? tradingWallets.map((w) => w.id)
      : [walletId];
    if (targetWalletIds.length === 0) return;

    // Pick the kind: Buy / Sell / alternating per action
    const kindAt = (i: number): "Buy" | "Sell" => {
      if (side === "Buy") return "Buy";
      if (side === "Sell") return "Sell";
      return i % 2 === 0 ? "Buy" : "Sell";
    };

    let i = 0;
    for (let r = 0; r < count; r++) {
      for (const id of targetWalletIds) {
        const kind = kindAt(i++);
        if (kind === "Buy") {
          await engine.enqueue({
            kind: "Buy",
            walletId: id,
            params: { tokenAddress: token.address, amountNative: amount, slippageBps: token.defaultSlippageBps },
          });
        } else {
          await engine.enqueue({
            kind: "Sell",
            walletId: id,
            params: { tokenAddress: token.address, amountToken: amount, slippageBps: token.defaultSlippageBps },
          });
        }
      }
    }
  }

  const totalActions = walletId === ALL_WALLETS ? tradingWallets.length * count : count;
  const buttonLabel = totalActions <= 1 ? "Send" : `Send ${totalActions} actions`;

  return (
    <div className="border border-slate-800 rounded p-4">
      <h3 className="text-md font-semibold mb-2">Quick fire</h3>
      <div className="text-xs text-slate-400">Active token: {token?.symbol ?? "—"}</div>

      <div className="grid grid-cols-4 gap-2 mt-3">
        <select
          value={walletId}
          onChange={(e) => setWalletId(e.target.value)}
          className="px-3 py-2 bg-slate-950 border border-slate-700 rounded"
        >
          <option value="">— wallet —</option>
          <option value={ALL_WALLETS}>All wallets ({tradingWallets.length})</option>
          {tradingWallets.map((w) => (
            <option key={w.id} value={w.id}>{w.label}</option>
          ))}
        </select>

        <select
          value={side}
          onChange={(e) => setSide(e.target.value as "Buy" | "Sell" | "Alternate")}
          className="px-3 py-2 bg-slate-950 border border-slate-700 rounded"
        >
          <option value="Buy">Buy</option>
          <option value="Sell">Sell</option>
          <option value="Alternate">Alternate Buy/Sell</option>
        </select>

        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount per tx"
          className="px-3 py-2 bg-slate-950 border border-slate-700 rounded"
        />

        <input
          type="number"
          min={1}
          value={count}
          onChange={(e) => setCount(Math.max(1, Number(e.target.value)))}
          placeholder="Count"
          className="px-3 py-2 bg-slate-950 border border-slate-700 rounded"
          title="Number of repetitions per wallet"
        />
      </div>

      <div className="mt-2 text-xs text-slate-500">
        {walletId === ALL_WALLETS
          ? `${count} × ${tradingWallets.length} wallets = ${totalActions} action${totalActions === 1 ? "" : "s"} queued`
          : `${count} action${count === 1 ? "" : "s"} queued from this wallet`}
      </div>

      <button
        onClick={fire}
        disabled={!walletId || !token || count < 1}
        className="mt-3 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm disabled:opacity-50"
      >
        {buttonLabel}
      </button>
    </div>
  );
}
