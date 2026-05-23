"use client";

import { useState } from "react";
import { Wallet } from "ethers";
import { useVault } from "@/contexts/VaultContext";

export function ImportKeyModal({ onClose, target }: { onClose: () => void; target: "trading" | "admin" }) {
  const vault = useVault();
  const [pk, setPk] = useState("");
  const [label, setLabel] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    try {
      const w = new Wallet(pk.trim());
      if (target === "admin") {
        await vault.setAdminFundingWallet({ address: w.address, privateKey: w.privateKey });
      } else {
        const id = w.address.slice(2, 10);
        await vault.addTradingWallet({ id, label: label.trim() || `w-${id}`, address: w.address, privateKey: w.privateKey });
      }
      onClose();
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center">
      <div className="bg-slate-900 border border-slate-700 rounded p-6 w-96">
        <h3 className="text-lg font-semibold">Import private key — {target}</h3>
        <input value={pk} onChange={(e) => setPk(e.target.value)} placeholder="0x…" className="w-full mt-3 px-3 py-2 bg-slate-950 border border-slate-700 rounded font-mono text-sm" />
        {target === "trading" && (
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" className="w-full mt-2 px-3 py-2 bg-slate-950 border border-slate-700 rounded" />
        )}
        {err && <p className="text-sm text-red-400 mt-2">{err}</p>}
        <div className="mt-4 flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-2 text-slate-300 hover:text-white">Cancel</button>
          <button onClick={submit} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded">Import</button>
        </div>
      </div>
    </div>
  );
}
