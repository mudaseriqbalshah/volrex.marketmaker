"use client";

import { useVault } from "@/contexts/VaultContext";
import { clearSession, loadSession } from "@/lib/siwe";

export function TopBar() {
  const vault = useVault();
  const sess = typeof window !== "undefined" ? loadSession() : null;

  return (
    <div className="border-b border-slate-800 px-6 py-3 flex items-center justify-between">
      <div className="font-semibold">Market Maker</div>
      <div className="flex items-center gap-4 text-sm">
        <span className="text-slate-400">Admin: {sess ? `${sess.address.slice(0, 6)}…${sess.address.slice(-4)}` : "—"}</span>
        <span className={`px-2 py-1 rounded ${vault.unlocked ? "bg-emerald-900/40 text-emerald-300" : "bg-amber-900/40 text-amber-300"}`}>
          Vault: {vault.unlocked ? "Unlocked" : "Locked"}
        </span>
        <button onClick={vault.lock} className="px-3 py-1 bg-slate-800 hover:bg-slate-700 rounded">Lock</button>
        <button onClick={() => { clearSession(); window.location.reload(); }} className="px-3 py-1 bg-slate-800 hover:bg-slate-700 rounded">Sign out</button>
      </div>
    </div>
  );
}
