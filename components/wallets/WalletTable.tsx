"use client";

import { useVault } from "@/contexts/VaultContext";
import { AddressDisplay } from "@/components/common/AddressDisplay";

export function WalletTable() {
  const vault = useVault();
  const wallets = vault.data?.tradingWallets ?? [];
  if (wallets.length === 0) return <p className="text-slate-400 text-sm">No trading wallets yet.</p>;

  return (
    <table className="w-full text-sm">
      <thead className="text-slate-400 text-left">
        <tr><th className="py-2">Label</th><th>Address</th><th>Actions</th></tr>
      </thead>
      <tbody>
        {wallets.map((w) => (
          <tr key={w.id} className="border-t border-slate-800">
            <td className="py-2">{w.label}</td>
            <td><AddressDisplay address={w.address} /></td>
            <td>
              <button onClick={() => void vault.removeTradingWallet(w.id)} className="text-red-400 hover:text-red-300 text-xs">Remove</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
