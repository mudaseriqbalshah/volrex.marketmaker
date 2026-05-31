"use client";

import { useMemo } from "react";
import { useEngine } from "@/contexts/EngineContext";

const MAX_ROWS = 200;

export function ActionList() {
  const engine = useEngine();
  const total = engine.queueSnapshot.length;
  // Sort newest first and cap rendered rows. Rendering thousands of rows
  // would make the page slow / unresponsive; the underlying queue isn't
  // capped here (it's auto-trimmed elsewhere) — we just don't render
  // them all at once.
  const rows = useMemo(() => {
    const sorted = engine.queueSnapshot.slice().sort((a, b) => b.createdAt - a.createdAt);
    return sorted.slice(0, MAX_ROWS);
  }, [engine.queueSnapshot]);

  if (total === 0) return <p className="text-sm text-slate-400">Queue is empty.</p>;

  return (
    <div>
      {total > MAX_ROWS && (
        <p className="text-xs text-slate-500 mb-2">
          Showing {MAX_ROWS} of {total} actions (newest first). Use the Clear buttons above to trim.
        </p>
      )}
      <table className="w-full text-sm">
        <thead className="text-slate-400 text-left">
          <tr><th className="py-2">Created</th><th>Kind</th><th>Wallet</th><th>Status</th><th>Tx</th><th>Error</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-t border-slate-800">
              <td className="py-2">{new Date(a.createdAt).toLocaleTimeString()}</td>
              <td>{a.kind}</td>
              <td className="font-mono text-xs">{a.walletId.slice(0, 8)}</td>
              <td>{a.status}</td>
              <td className="font-mono text-xs">{a.txHash ? `${a.txHash.slice(0, 10)}…` : "—"}</td>
              <td className="text-xs text-rose-400" title={a.lastError?.message ?? ""}>
                {a.lastError?.message ? (a.lastError.message.length > 50 ? `${a.lastError.message.slice(0, 50)}…` : a.lastError.message) : ""}
              </td>
              <td><button onClick={() => void engine.removeFromQueue(a.id)} className="text-red-400 hover:text-red-300 text-xs">Cancel</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
