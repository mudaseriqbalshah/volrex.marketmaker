"use client";

import { useState } from "react";
import { useEngine } from "@/contexts/EngineContext";
import { useVault } from "@/contexts/VaultContext";
import { AddressDisplay } from "@/components/common/AddressDisplay";
import { BalanceDisplay } from "@/components/common/BalanceDisplay";
import { pickRandomInRange } from "@/lib/range";

export function FundingCard() {
  const vault = useVault();
  const engine = useEngine();
  const [minAmount, setMinAmount] = useState("0.005");
  const [maxAmount, setMaxAmount] = useState("0.02");

  if (!vault.data?.adminFundingWallet) {
    return (
      <div className="border border-slate-800 rounded p-4 text-sm text-slate-400">
        No funding wallet set. Configure in Wallets.
      </div>
    );
  }

  async function distribute() {
    if (!vault.data) return;
    for (const w of vault.data.tradingWallets) {
      const amount = pickRandomInRange(minAmount, maxAmount);
      await engine.enqueue({ kind: "TransferETH", walletId: "admin", params: { toWalletId: w.id, amount } });
    }
  }
  async function collect() {
    if (!vault.data) return;
    for (const w of vault.data.tradingWallets) {
      await engine.enqueue({ kind: "TransferBackETH", walletId: w.id, params: { toWalletId: "admin", amount: "all-minus-buffer", gasBuffer: "0.001" } });
    }
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

      <label className="block text-sm mt-3 text-slate-400">Amount per wallet (native) — random in range</label>
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
          ? `Each Distribute sends exactly ${minAmount} VLRX per wallet.`
          : `Each Distribute picks a fresh random amount between ${minAmount} and ${maxAmount} VLRX per wallet.`}
      </div>

      <div className="mt-3 flex gap-2">
        <button onClick={distribute} className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm">Distribute</button>
        <button onClick={collect} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded text-sm">Collect</button>
      </div>
    </div>
  );
}
