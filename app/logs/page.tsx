"use client";

import { LogTable } from "@/components/logs/LogTable";

export default function LogsPage() {
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Action Logs</h1>
      <p className="text-gray-500 text-sm">
        Reverse-chronological history of dispatched actions (up to 1 000 entries, persisted across refreshes).
      </p>
      <LogTable />
    </div>
  );
}
