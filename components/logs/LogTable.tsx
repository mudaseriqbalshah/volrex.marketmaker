"use client";

import { useEngine } from "@/contexts/EngineContext";
import type { LogEntry } from "@/lib/logger";

function formatTs(ts: number): string {
  return new Date(ts).toLocaleString();
}

function truncate(s: string, n = 12): string {
  if (s.length <= n) return s;
  return s.slice(0, 6) + "…" + s.slice(-4);
}

function StatusBadge({ status }: { status: LogEntry["status"] }) {
  const cls =
    status === "done"
      ? "bg-green-100 text-green-800"
      : "bg-red-100 text-red-800";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

export function LogTable() {
  const { logs } = useEngine();
  const reversed = [...logs].reverse();

  if (reversed.length === 0) {
    return <p className="text-gray-500 text-sm">No log entries yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-600 font-medium">
            <th className="py-2 pr-4">Time</th>
            <th className="py-2 pr-4">Kind</th>
            <th className="py-2 pr-4">Wallet</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2">Tx / Error</th>
          </tr>
        </thead>
        <tbody>
          {reversed.map((entry, i) => (
            <tr
              key={i}
              className="border-b border-gray-100 hover:bg-gray-50 align-top"
            >
              <td className="py-2 pr-4 whitespace-nowrap text-gray-500">
                {formatTs(entry.ts)}
              </td>
              <td className="py-2 pr-4 font-mono">{entry.kind}</td>
              <td className="py-2 pr-4 font-mono" title={entry.walletId}>
                {truncate(entry.walletId)}
              </td>
              <td className="py-2 pr-4">
                <StatusBadge status={entry.status} />
              </td>
              <td className="py-2 font-mono text-xs text-gray-700 max-w-xs truncate">
                {entry.txHash ? (
                  <span title={entry.txHash}>{truncate(entry.txHash, 20)}</span>
                ) : entry.errorMessage ? (
                  <span className="text-red-600" title={entry.errorMessage}>
                    [{entry.errorCode}] {entry.errorMessage}
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
