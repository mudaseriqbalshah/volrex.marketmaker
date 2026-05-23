"use client";
import { ActionList } from "@/components/actions/ActionList";

export default function ActionsPage() {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Action queue</h2>
      <ActionList />
    </div>
  );
}
