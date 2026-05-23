"use client";

import { useEngine } from "@/contexts/EngineContext";

export function ActionList() {
  const engine = useEngine();
  if (engine.queueSnapshot.length === 0) return <p className="text-sm text-slate-400">Queue is empty.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-slate-400 text-left">
        <tr><th className="py-2">Created</th><th>Kind</th><th>Wallet</th><th>Status</th><th>Tx</th><th>Error</th><th></th></tr>
      </thead>
      <tbody>
        {engine.queueSnapshot.slice().sort((a, b) => b.createdAt - a.createdAt).map((a) => (
          <tr key={a.id} className="border-t border-slate-800">
            <td className="py-2">{new Date(a.createdAt).toLocaleTimeString()}</td>
            <td>{a.kind}</td>
            <td className="font-mono text-xs">{a.walletId.slice(0, 8)}</td>
            <td>{a.status}</td>
            <td className="font-mono text-xs">{a.txHash ? `${a.txHash.slice(0, 10)}…` : "—"}</td>
            <td className="text-xs text-rose-400">{a.lastError?.message ?? ""}</td>
            <td><button onClick={() => void engine.removeFromQueue(a.id)} className="text-red-400 hover:text-red-300 text-xs">Cancel</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
