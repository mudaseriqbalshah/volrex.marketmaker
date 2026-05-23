"use client";

import { formatUnits } from "ethers";

function trim(value: string, precision: number): string {
  const [whole, frac = ""] = value.split(".");
  if (frac.length <= precision) return value;
  const trimmed = frac.slice(0, precision).replace(/0+$/, "");
  return trimmed.length === 0 ? (whole ?? "0") : `${whole}.${trimmed}`;
}

export function BalanceDisplay({
  value,
  decimals,
  symbol,
  precision = 4,
}: {
  value: bigint | undefined;
  decimals: number;
  symbol: string;
  precision?: number;
}) {
  if (value === undefined) {
    return <span className="text-slate-500">— {symbol}</span>;
  }
  const formatted = trim(formatUnits(value, decimals), precision);
  return (
    <span className="tabular-nums">
      {formatted} <span className="text-slate-500">{symbol}</span>
    </span>
  );
}
