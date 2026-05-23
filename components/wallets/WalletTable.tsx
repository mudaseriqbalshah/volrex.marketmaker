"use client";

import { useVault } from "@/contexts/VaultContext";
import { useEngine } from "@/contexts/EngineContext";
import { AddressDisplay } from "@/components/common/AddressDisplay";
import { BalanceDisplay } from "@/components/common/BalanceDisplay";

export function WalletTable() {
  const vault = useVault();
  const engine = useEngine();
  const wallets = vault.data?.tradingWallets ?? [];
  const activeToken = vault.data?.tokens.find((t) => t.address === vault.data?.activeTokenAddress);
  if (wallets.length === 0) return <p className="text-slate-400 text-sm">No trading wallets yet.</p>;

  return (
    <table className="w-full text-sm">
      <thead className="text-slate-400 text-left">
        <tr>
          <th className="py-2">Label</th>
          <th>Address</th>
          <th>VLRX</th>
          <th>{activeToken?.symbol ?? "Token"}</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {wallets.map((w) => (
          <tr key={w.id} className="border-t border-slate-800">
            <td className="py-2">{w.label}</td>
            <td><AddressDisplay address={w.address} /></td>
            <td><BalanceDisplay value={engine.nativeBalances[w.id]} decimals={18} symbol="VLRX" /></td>
            <td>
              {activeToken
                ? <BalanceDisplay value={engine.tokenBalances[w.id]} decimals={activeToken.decimals} symbol={activeToken.symbol} />
                : <span className="text-slate-600 text-xs">no active token</span>}
            </td>
            <td>
              <button onClick={() => void vault.removeTradingWallet(w.id)} className="text-red-400 hover:text-red-300 text-xs">Remove</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
