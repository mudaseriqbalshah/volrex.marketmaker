"use client";

import { useState } from "react";
import { useEngine } from "@/contexts/EngineContext";

export function EngineCard() {
  const engine = useEngine();
  const counts = engine.queueSnapshot.reduce(
    (acc, a) => ({ ...acc, [a.status]: (acc[a.status] ?? 0) + 1 }),
    {} as Record<string, number>,
  );
  return (
    <div className="border border-slate-800 rounded p-4">
      <h3 className="text-md font-semibold mb-3">Engine</h3>
      <div className="flex gap-2 mb-3">
        {(["manual", "random", "roundRobin"] as const).map((m) => (
          <button key={m} onClick={() => engine.setMode(m)} className={`px-3 py-1 rounded text-sm ${engine.mode === m ? "bg-indigo-600" : "bg-slate-800 hover:bg-slate-700"}`}>{m}</button>
        ))}
      </div>
      <div className="flex gap-2 mb-3">
        <button onClick={engine.start} disabled={engine.running} className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 rounded disabled:opacity-50">Start</button>
        <button onClick={engine.stop} className="px-3 py-1 bg-rose-700 hover:bg-rose-600 rounded">Stop</button>
        <button onClick={engine.drain} className="px-3 py-1 bg-amber-700 hover:bg-amber-600 rounded">Drain</button>
      </div>
      <div className="text-xs text-slate-400 flex gap-4">
        <span>Queued: {counts.queued ?? 0}</span>
        <span>Running: {counts.running ?? 0}</span>
        <span>Done: {counts.done ?? 0}</span>
        <span>Failed: {counts.failed ?? 0}</span>
      </div>
    </div>
  );
}
