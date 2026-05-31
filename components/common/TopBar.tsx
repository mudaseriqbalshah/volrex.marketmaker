"use client";

import { useVault } from "@/contexts/VaultContext";
import { useActivity } from "@/contexts/ActivityContext";
import { clearSession, loadSession } from "@/lib/siwe";

function Spinner() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="animate-spin h-4 w-4 text-indigo-400"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" opacity="0.25" />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function TopBar() {
  const vault = useVault();
  const activity = useActivity();
  const sess = typeof window !== "undefined" ? loadSession() : null;

  return (
    <div className="border-b border-slate-800 px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="font-semibold">Market Maker</div>
        {activity.busyCount > 0 && (
          <div className="flex items-center gap-2 text-xs text-indigo-300" title={activity.currentLabel ?? undefined}>
            <Spinner />
            <span>{activity.currentLabel}{activity.busyCount > 1 ? ` (+${activity.busyCount - 1})` : ""}</span>
          </div>
        )}
      </div>
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
