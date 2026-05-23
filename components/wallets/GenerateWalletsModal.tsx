"use client";

import { useState } from "react";
import { Wallet } from "ethers";
import { useVault } from "@/contexts/VaultContext";

export function GenerateWalletsModal({ onClose }: { onClose: () => void }) {
  const vault = useVault();
  const [n, setN] = useState(5);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    try {
      for (let i = 0; i < n; i++) {
        const w = Wallet.createRandom();
        const id = w.address.slice(2, 10);
        await vault.addTradingWallet({ id, label: `w-${id}`, address: w.address, privateKey: w.privateKey });
      }
      onClose();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center">
      <div className="bg-slate-900 border border-slate-700 rounded p-6 w-96">
        <h3 className="text-lg font-semibold">Generate trading wallets</h3>
        <label className="block text-sm mt-4 text-slate-400">How many?</label>
        <input type="number" value={n} onChange={(e) => setN(Math.max(1, Math.min(500, Number(e.target.value))))} className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-700 rounded" />
        <div className="mt-4 flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-2 text-slate-300 hover:text-white">Cancel</button>
          <button onClick={generate} disabled={busy} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded disabled:opacity-50">
            {busy ? "Generating…" : `Generate ${n}`}
          </button>
        </div>
      </div>
    </div>
  );
}
