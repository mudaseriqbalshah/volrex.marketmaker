"use client";

import { useVault } from "@/contexts/VaultContext";
import { AddressDisplay } from "@/components/common/AddressDisplay";

export function TokenList() {
  const vault = useVault();
  const tokens = vault.data?.tokens ?? [];
  if (tokens.length === 0) return <p className="text-slate-400 text-sm">No tokens added yet.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-slate-400 text-left">
        <tr><th className="py-2">Active</th><th>Symbol</th><th>Address</th><th>Decimals</th><th>Slippage</th><th></th></tr>
      </thead>
      <tbody>
        {tokens.map((t) => (
          <tr key={t.address} className="border-t border-slate-800">
            <td className="py-2"><input type="radio" name="active" checked={vault.data?.activeTokenAddress === t.address} onChange={() => void vault.setActiveToken(t.address)} /></td>
            <td>{t.symbol}</td>
            <td><AddressDisplay address={t.address} /></td>
            <td>{t.decimals}</td>
            <td>{t.defaultSlippageBps} bps</td>
            <td><button onClick={() => void vault.removeToken(t.address)} className="text-red-400 hover:text-red-300 text-xs">Remove</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
