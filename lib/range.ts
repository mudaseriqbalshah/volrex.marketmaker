// Helpers for randomized amount ranges in UI components. Centralized so the
// fallback / clamp rules are consistent across FundingCard and QuickFire.

/**
 * Pick a uniformly-random decimal value in [min, max], formatted as a string
 * with up to `decimals` digits after the point (trailing zeros stripped).
 *
 * - If either input is not a positive finite number, returns minStr verbatim
 *   so we never enqueue something invalid.
 * - If min > max, the bounds are swapped.
 * - If min == max, returns the value as-is (no jitter).
 */
export function pickRandomInRange(minStr: string, maxStr: string, decimals = 6): string {
  const a = Number(minStr);
  const b = Number(maxStr);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) return minStr;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (lo === hi) return minStr;
  const value = lo + Math.random() * (hi - lo);
  return trim(value.toFixed(decimals));
}

function trim(s: string): string {
  if (!s.includes(".")) return s;
  return s.replace(/0+$/, "").replace(/\.$/, "");
}
