"use client";

import { useEffect, useMemo, useState } from "react";
import type { TradingWallet } from "@/types/domain";

export type WalletSelection =
  | { mode: "single"; id: string }
  | { mode: "all" }
  | { mode: "range"; from: number; to: number };

export function resolveWalletIds(sel: WalletSelection, wallets: TradingWallet[]): string[] {
  if (sel.mode === "single") return sel.id ? [sel.id] : [];
  if (sel.mode === "all") return wallets.map((w) => w.id);
  // range mode: 1-based, inclusive, clamped to valid bounds.
  const len = wallets.length;
  if (len === 0) return [];
  const from = Math.max(1, Math.min(sel.from, len));
  const to = Math.max(from, Math.min(sel.to, len));
  return wallets.slice(from - 1, to).map((w) => w.id);
}

export function WalletSelector({
  wallets,
  value,
  onChange,
}: {
  wallets: TradingWallet[];
  value: WalletSelection;
  onChange: (s: WalletSelection) => void;
}) {
  // Local state for range inputs so typing doesn't fight the parent's clamp.
  const [from, setFrom] = useState<number>(value.mode === "range" ? value.from : 1);
  const [to, setTo] = useState<number>(value.mode === "range" ? value.to : Math.min(10, Math.max(1, wallets.length)));

  // Sync local range inputs back up whenever they change and we're in range mode.
  useEffect(() => {
    if (value.mode === "range") {
      onChange({ mode: "range", from, to });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const resolvedCount = useMemo(() => resolveWalletIds(value, wallets).length, [value, wallets]);

  return (
    <div className="space-y-2">
      <div className="flex gap-1 items-center text-xs">
        <span className="text-slate-400 mr-1">Wallets:</span>
        <button
          onClick={() => onChange({ mode: "all" })}
          className={`px-2 py-1 rounded ${value.mode === "all" ? "bg-indigo-600" : "bg-slate-800 hover:bg-slate-700"}`}
        >
          All
        </button>
        <button
          onClick={() => onChange({ mode: "range", from, to })}
          className={`px-2 py-1 rounded ${value.mode === "range" ? "bg-indigo-600" : "bg-slate-800 hover:bg-slate-700"}`}
        >
          Range
        </button>
        <button
          onClick={() => onChange({ mode: "single", id: value.mode === "single" ? value.id : "" })}
          className={`px-2 py-1 rounded ${value.mode === "single" ? "bg-indigo-600" : "bg-slate-800 hover:bg-slate-700"}`}
        >
          Single
        </button>
        <span className="ml-auto text-slate-500">{resolvedCount} wallet{resolvedCount === 1 ? "" : "s"} selected</span>
      </div>

      {value.mode === "single" && (
        <select
          value={value.id}
          onChange={(e) => onChange({ mode: "single", id: e.target.value })}
          className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded text-sm"
        >
          <option value="">— pick a wallet —</option>
          {wallets.map((w, i) => (
            <option key={w.id} value={w.id}>
              #{i + 1} — {w.label}
            </option>
          ))}
        </select>
      )}

      {value.mode === "range" && (
        <div className="grid grid-cols-2 gap-2 items-center">
          <label className="flex items-center gap-2 text-xs text-slate-400">
            From
            <input
              type="number"
              min={1}
              max={wallets.length}
              value={from}
              onChange={(e) => setFrom(Math.max(1, Number(e.target.value)))}
              className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            To
            <input
              type="number"
              min={1}
              max={wallets.length}
              value={to}
              onChange={(e) => setTo(Math.max(1, Number(e.target.value)))}
              className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded text-sm"
            />
          </label>
          <div className="col-span-2 text-xs text-slate-500">
            Wallet indices are 1-based in insertion order. Total wallets: {wallets.length}.
          </div>
        </div>
      )}
    </div>
  );
}
