"use client";

import { useState } from "react";
import { useEngine } from "@/contexts/EngineContext";
import { useActivity } from "@/contexts/ActivityContext";
import { ActionList } from "@/components/actions/ActionList";

export default function ActionsPage() {
  const engine = useEngine();
  const activity = useActivity();
  const [msg, setMsg] = useState<string | null>(null);

  const counts = engine.queueSnapshot.reduce(
    (acc, a) => ({ ...acc, [a.status]: (acc[a.status] ?? 0) + 1 }),
    {} as Record<string, number>,
  );

  async function resetStuck() {
    const n = await activity.track("Resetting stuck actions", () => engine.resetStuckActions());
    setMsg(n === 0 ? "No stuck actions found." : `Reset ${n} action${n === 1 ? "" : "s"} from running → queued.`);
    setTimeout(() => setMsg(null), 3000);
  }

  async function cancelAllFailed() {
    const failed = engine.queueSnapshot.filter((a) => a.status === "failed");
    await activity.track(`Clearing ${failed.length} failed`, async () => {
      for (const a of failed) await engine.removeFromQueue(a.id);
    });
    setMsg(`Cleared ${failed.length} failed item${failed.length === 1 ? "" : "s"}.`);
    setTimeout(() => setMsg(null), 3000);
  }

  async function cancelAllQueued() {
    const queued = engine.queueSnapshot.filter((a) => a.status === "queued");
    await activity.track(`Clearing ${queued.length} queued`, async () => {
      for (const a of queued) await engine.removeFromQueue(a.id);
    });
    setMsg(`Cleared ${queued.length} queued item${queued.length === 1 ? "" : "s"}.`);
    setTimeout(() => setMsg(null), 3000);
  }

  async function clearAll() {
    const total = engine.queueSnapshot.length;
    if (total === 0) return;
    if (!confirm(`Remove ALL ${total} action${total === 1 ? "" : "s"} from the queue? This cannot be undone.`)) return;
    const n = await activity.track(`Clearing all ${total} actions`, () => engine.clearAllActions());
    setMsg(`Removed ${n} action${n === 1 ? "" : "s"} from the queue.`);
    setTimeout(() => setMsg(null), 3000);
  }

  const total = engine.queueSnapshot.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Action queue</h2>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>Queued: {counts.queued ?? 0}</span>
          <span>Running: {counts.running ?? 0}</span>
          <span>Done: {counts.done ?? 0}</span>
          <span>Failed: {counts.failed ?? 0}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={resetStuck}
          disabled={(counts.running ?? 0) === 0}
          className="px-3 py-1.5 text-xs bg-amber-700 hover:bg-amber-600 rounded disabled:opacity-40"
          title="Move any action stuck in 'running' back to 'queued' so the worker can pick it up. Use after a page refresh."
        >
          Reset stuck ({counts.running ?? 0})
        </button>
        <button
          onClick={cancelAllFailed}
          disabled={(counts.failed ?? 0) === 0}
          className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 rounded disabled:opacity-40"
        >
          Clear failed ({counts.failed ?? 0})
        </button>
        <button
          onClick={cancelAllQueued}
          disabled={(counts.queued ?? 0) === 0}
          className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 rounded disabled:opacity-40"
        >
          Clear queued ({counts.queued ?? 0})
        </button>
        <button
          onClick={clearAll}
          disabled={total === 0}
          className="px-3 py-1.5 text-xs bg-rose-700 hover:bg-rose-600 rounded disabled:opacity-40"
          title="Remove every action from the queue regardless of status."
        >
          Clear all ({total})
        </button>
        {msg && <span className="text-xs text-emerald-400 ml-2">{msg}</span>}
      </div>

      <ActionList />
    </div>
  );
}
