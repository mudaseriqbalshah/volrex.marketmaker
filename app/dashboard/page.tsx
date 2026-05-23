"use client";
import { EngineCard } from "@/components/dashboard/EngineCard";
import { FundingCard } from "@/components/dashboard/FundingCard";
import { QuickFire } from "@/components/dashboard/QuickFire";

export default function DashboardPage() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <EngineCard />
      <FundingCard />
      <QuickFire />
    </div>
  );
}
