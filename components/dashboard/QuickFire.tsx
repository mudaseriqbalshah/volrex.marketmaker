"use client";

import { useState } from "react";
import { useVault } from "@/contexts/VaultContext";
import { useEngine } from "@/contexts/EngineContext";
import { useActivity } from "@/contexts/ActivityContext";
import { WalletSelector, resolveWalletIds, type WalletSelection } from "@/components/common/WalletSelector";
import { pickRandomInRange } from "@/lib/range";
import type { NewAction } from "@/lib/engine/types";

type AmountMode = "absolute" | "percentage";

export function QuickFire() {
  const vault = useVault();
  const engine = useEngine();
  const activity = useActivity();
  const [selection, setSelection] = useState<WalletSelection>({ mode: "all" });
  const [side, setSide] = useState<"Buy" | "Sell" | "Alternate">("Buy");
  const [amountMode, setAmountMode] = useState<AmountMode>("absolute");
  const [minAmount, setMinAmount] = useState("0.005");
  const [maxAmount, setMaxAmount] = useState("0.02");
  const [count, setCount] = useState(1);

  const token = vault.data?.tokens.find((t) => t.address === vault.data?.activeTokenAddress);
  const tradingWallets = vault.data?.tradingWallets ?? [];
  const selectedIds = resolveWalletIds(selection, tradingWallets);

  async function fire() {
    if (!token || count < 1 || selectedIds.length === 0) return;

    const kindAt = (i: number): "Buy" | "Sell" => {
      if (side === "Buy") return "Buy";
      if (side === "Sell") return "Sell";
      return i % 2 === 0 ? "Buy" : "Sell";
    };

    // Build the full action list first, then bulk-enqueue in one persist
    // call. Much faster for large counts AND lets the UI run other
    // operations in parallel (the user can click again to add another
    // batch while this one is being persisted).
    const actions: NewAction[] = [];
    let i = 0;
    for (let r = 0; r < count; r++) {
      for (const id of selectedIds) {
        const kind = kindAt(i++);
        const amount = pickRandomInRange(minAmount, maxAmount);
        if (kind === "Buy") {
          actions.push({
            kind: "Buy",
            walletId: id,
            params: {
              tokenAddress: token.address,
              amountNative: amount,
              slippageBps: token.defaultSlippageBps,
              amountMode,
            },
          });
        } else {
          actions.push({
            kind: "Sell",
            walletId: id,
            params: {
              tokenAddress: token.address,
              amountToken: amount,
              slippageBps: token.defaultSlippageBps,
              amountMode,
            },
          });
        }
      }
    }

    await activity.track(`Queueing ${actions.length} ${side.toLowerCase()} action${actions.length === 1 ? "" : "s"}`, () =>
      engine.enqueueBatch(actions),
    );
  }

  function switchMode(mode: AmountMode) {
    setAmountMode(mode);
    if (mode === "absolute") {
      setMinAmount("0.005");
      setMaxAmount("0.02");
    } else {
      setMinAmount("20");
      setMaxAmount("40");
    }
  }

  const totalActions = selectedIds.length * count;
  const buttonLabel = totalActions <= 1 ? "Send" : `Send ${totalActions} actions`;
  const sameRange = minAmount === maxAmount;
  const unitLabel = amountMode === "percentage" ? "%" : "VLRX/token";

  const helperText = sameRange
    ? amountMode === "percentage"
      ? `Each action uses exactly ${minAmount}% of the wallet's ${side === "Sell" ? "token" : "native"} balance.`
      : `Each action uses exactly ${minAmount}.`
    : amountMode === "percentage"
      ? `Each action picks a fresh random % between ${minAmount}% and ${maxAmount}% of the wallet's ${side === "Sell" ? "token" : "native"} balance.`
      : `Each action picks a fresh random amount between ${minAmount} and ${maxAmount}.`;

  return (
    <div className="border border-slate-800 rounded p-4">
      <h3 className="text-md font-semibold mb-2">Quick fire</h3>
      <div className="text-xs text-slate-400">Active token: {token?.symbol ?? "—"}</div>

      <div className="mt-3 flex gap-2 items-center">
        <span className="text-xs text-slate-400">Amount mode:</span>
        <button
          onClick={() => switchMode("absolute")}
          className={`px-2 py-1 text-xs rounded ${amountMode === "absolute" ? "bg-indigo-600" : "bg-slate-800 hover:bg-slate-700"}`}
        >
          Absolute
        </button>
        <button
          onClick={() => switchMode("percentage")}
          className={`px-2 py-1 text-xs rounded ${amountMode === "percentage" ? "bg-indigo-600" : "bg-slate-800 hover:bg-slate-700"}`}
        >
          % of balance
        </button>
      </div>

      <div className="mt-3">
        <WalletSelector wallets={tradingWallets} value={selection} onChange={setSelection} />
      </div>

      <div className="mt-3">
        <label className="block text-xs text-slate-400">Side</label>
        <select
          value={side}
          onChange={(e) => setSide(e.target.value as "Buy" | "Sell" | "Alternate")}
          className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-700 rounded text-sm"
        >
          <option value="Buy">Buy</option>
          <option value="Sell">Sell</option>
          <option value="Alternate">Alternate Buy/Sell</option>
        </select>
      </div>

      <label className="block text-sm mt-3 text-slate-400">
        Amount per tx ({unitLabel}) — random in range
      </label>
      <div className="grid grid-cols-3 gap-2 mt-1">
        <input
          value={minAmount}
          onChange={(e) => setMinAmount(e.target.value)}
          placeholder="Min"
          className="px-3 py-2 bg-slate-950 border border-slate-700 rounded text-sm"
        />
        <input
          value={maxAmount}
          onChange={(e) => setMaxAmount(e.target.value)}
          placeholder="Max"
          className="px-3 py-2 bg-slate-950 border border-slate-700 rounded text-sm"
        />
        <input
          type="number"
          min={1}
          value={count}
          onChange={(e) => setCount(Math.max(1, Number(e.target.value)))}
          placeholder="Count"
          className="px-3 py-2 bg-slate-950 border border-slate-700 rounded text-sm"
          title="Number of repetitions per wallet"
        />
      </div>

      <div className="mt-2 text-xs text-slate-500 space-y-1">
        <div>
          {selectedIds.length} wallet{selectedIds.length === 1 ? "" : "s"} × {count} reps = {totalActions} action{totalActions === 1 ? "" : "s"} queued
        </div>
        <div className="text-slate-400">{helperText}</div>
      </div>

      <button
        onClick={fire}
        disabled={!token || count < 1 || selectedIds.length === 0}
        className="mt-3 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm disabled:opacity-50"
      >
        {buttonLabel}
      </button>
    </div>
  );
}
