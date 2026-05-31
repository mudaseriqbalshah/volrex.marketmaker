"use client";

import { useEngine } from "@/contexts/EngineContext";

export function EngineCard() {
  const engine = useEngine();
  const counts = engine.queueSnapshot.reduce(
    (acc, a) => ({ ...acc, [a.status]: (acc[a.status] ?? 0) + 1 }),
    {} as Record<string, number>,
  );
  const schedulerActive = engine.schedulerRunning;

  return (
    <div className="border border-slate-800 rounded p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-md font-semibold">Engine</h3>
        <div className="flex items-center gap-2 text-xs">
          <span className={`px-2 py-0.5 rounded ${engine.running ? "bg-emerald-900/40 text-emerald-300" : "bg-slate-800 text-slate-400"}`}>
            Worker: {engine.running ? "running" : "stopped"}
          </span>
          {(engine.mode === "random" || engine.mode === "roundRobin") && (
            <span className={`px-2 py-0.5 rounded ${schedulerActive ? "bg-indigo-900/40 text-indigo-300" : "bg-slate-800 text-slate-400"}`}>
              Scheduler: {schedulerActive ? "emitting" : "stopped"}
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-2 mb-3">
        {(["manual", "random", "roundRobin"] as const).map((m) => (
          <button
            key={m}
            onClick={() => engine.setMode(m)}
            className={`px-3 py-1 rounded text-sm ${engine.mode === m ? "bg-indigo-600" : "bg-slate-800 hover:bg-slate-700"}`}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="flex gap-2 mb-3 flex-wrap">
        <button onClick={engine.start} disabled={engine.running && schedulerActive} className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 rounded disabled:opacity-50">Start</button>
        <button onClick={engine.stop} className="px-3 py-1 bg-rose-700 hover:bg-rose-600 rounded">Stop</button>
        <button onClick={engine.drain} className="px-3 py-1 bg-amber-700 hover:bg-amber-600 rounded">Drain</button>
        {schedulerActive && (
          <button
            onClick={engine.stopScheduler}
            className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs"
            title="Stop the random/roundRobin scheduler but keep the worker draining the existing queue."
          >
            Stop scheduler only
          </button>
        )}
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
