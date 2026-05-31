"use client";

import { useState } from "react";
import { useEngine } from "@/contexts/EngineContext";
import { useVault } from "@/contexts/VaultContext";
import { useActivity } from "@/contexts/ActivityContext";
import { AddressDisplay } from "@/components/common/AddressDisplay";
import { BalanceDisplay } from "@/components/common/BalanceDisplay";
import { WalletSelector, resolveWalletIds, type WalletSelection } from "@/components/common/WalletSelector";
import { pickRandomInRange } from "@/lib/range";
import type { NewAction } from "@/lib/engine/types";

export function FundingCard() {
  const vault = useVault();
  const engine = useEngine();
  const activity = useActivity();
  const [minAmount, setMinAmount] = useState("0.005");
  const [maxAmount, setMaxAmount] = useState("0.02");
  const [selection, setSelection] = useState<WalletSelection>({ mode: "all" });

  if (!vault.data?.adminFundingWallet) {
    return (
      <div className="border border-slate-800 rounded p-4 text-sm text-slate-400">
        No funding wallet set. Configure in Wallets.
      </div>
    );
  }

  const wallets = vault.data.tradingWallets;
  const selectedIds = resolveWalletIds(selection, wallets);

  async function distribute() {
    if (selectedIds.length === 0) return;
    const actions: NewAction[] = selectedIds.map((toWalletId) => ({
      kind: "TransferETH" as const,
      walletId: "admin",
      params: { toWalletId, amount: pickRandomInRange(minAmount, maxAmount) },
    }));
    await activity.track(`Distributing to ${actions.length} wallets`, () => engine.enqueueBatch(actions));
  }

  async function collect() {
    if (selectedIds.length === 0) return;
    const actions: NewAction[] = selectedIds.map((fromWalletId) => ({
      kind: "TransferBackETH" as const,
      walletId: fromWalletId,
      params: { toWalletId: "admin", amount: "all-minus-buffer" as const, gasBuffer: "0.001" },
    }));
    await activity.track(`Collecting from ${actions.length} wallets`, () => engine.enqueueBatch(actions));
  }

  const activeToken = vault.data.tokens.find((t) => t.address === vault.data?.activeTokenAddress);
  const sameValue = minAmount === maxAmount;

  return (
    <div className="border border-slate-800 rounded p-4">
      <h3 className="text-md font-semibold mb-2">Funding</h3>
      <div className="text-sm">Funding wallet: <AddressDisplay address={vault.data.adminFundingWallet.address} /></div>
      <div className="text-sm mt-1 flex gap-4">
        <BalanceDisplay value={engine.nativeBalances["admin"]} decimals={18} symbol="VLRX" />
        {activeToken && (
          <BalanceDisplay value={engine.tokenBalances["admin"]} decimals={activeToken.decimals} symbol={activeToken.symbol} />
        )}
      </div>

      <div className="mt-3">
        <WalletSelector wallets={wallets} value={selection} onChange={setSelection} />
      </div>

      <label className="block text-sm mt-3 text-slate-400">Amount per wallet (VLRX) — random in range</label>
      <div className="grid grid-cols-2 gap-2 mt-1">
        <input
          value={minAmount}
          onChange={(e) => setMinAmount(e.target.value)}
          placeholder="Min"
          className="px-3 py-2 bg-slate-950 border border-slate-700 rounded"
        />
        <input
          value={maxAmount}
          onChange={(e) => setMaxAmount(e.target.value)}
          placeholder="Max"
          className="px-3 py-2 bg-slate-950 border border-slate-700 rounded"
        />
      </div>
      <div className="text-xs text-slate-500 mt-1">
        {sameValue
          ? `Each Distribute sends exactly ${minAmount} VLRX to ${selectedIds.length} wallet${selectedIds.length === 1 ? "" : "s"}.`
          : `Each Distribute picks a fresh random amount between ${minAmount} and ${maxAmount} VLRX for ${selectedIds.length} wallet${selectedIds.length === 1 ? "" : "s"}.`}
      </div>

      <div className="mt-3 flex gap-2">
        <button
          onClick={distribute}
          disabled={selectedIds.length === 0}
          className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded text-sm"
        >
          Distribute ({selectedIds.length})
        </button>
        <button
          onClick={collect}
          disabled={selectedIds.length === 0}
          className="px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 rounded text-sm"
        >
          Collect ({selectedIds.length})
        </button>
      </div>
    </div>
  );
}
