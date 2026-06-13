// ────────────────────────────────────────────────────────────────────────────
// Indexer push hook
//
// After each Buy/Sell the MM successfully lands, fire-and-forget a request to
// the Volrex DEX indexer's /api/cron endpoint so it picks up the new swap
// immediately. Without this the indexer only ticks once per minute, so MM
// activity would show up on the UI with up to ~60s lag.
//
// Configuration via env (read once at startup, since dispatch is hot):
//   INDEXER_URL          base URL, e.g. https://vorlexscan.com
//   INDEXER_CRON_SECRET  the same secret the indexer's /api/cron uses
//
// The call is fire-and-forget — we never wait for it, never let it throw into
// dispatch, and never let it block the next trade. A 4s timeout caps the
// in-flight cost so a stuck request can't pile up.
// ────────────────────────────────────────────────────────────────────────────

const INDEXER_TIMEOUT_MS = 4_000;

// Crude in-flight de-dupe — if a previous notification is still pending, don't
// fire another one. A single tick processes all blocks since the last cursor,
// so re-firing during a burst of trades just wastes RPC quota.
let inFlight: AbortController | null = null;

// Read env at call time, not at module load. The MM CLI loads .env.local AFTER
// import-graph evaluation finishes, so reading env at the top level would
// capture an empty string before `loadEnvConfig` runs.
let warnedOnce = false;
function readEnv(): { url: string; secret: string } {
  return {
    url: process.env.INDEXER_URL ?? "",
    secret: process.env.INDEXER_CRON_SECRET ?? "",
  };
}

export function notifyIndexer(reason: string): void {
  const { url, secret } = readEnv();
  if (!url || !secret) {
    if (!warnedOnce) {
      warnedOnce = true;
      // eslint-disable-next-line no-console
      console.warn(
        "[indexer] INDEXER_URL or INDEXER_CRON_SECRET unset — skipping all push hooks. " +
          "Set both in .env.local to push swaps to vorlexscan.com after each trade.",
      );
    }
    return;
  }
  if (inFlight) return;

  const ctrl = new AbortController();
  inFlight = ctrl;
  const timer = setTimeout(() => ctrl.abort(), INDEXER_TIMEOUT_MS);

  fetch(`${url.replace(/\/$/, "")}/api/cron`, {
    method: "GET",
    headers: { authorization: `Bearer ${secret}` },
    signal: ctrl.signal,
  })
    .catch(() => {
      // Swallow — indexer freshness is best-effort. The next regular cron
      // tick will catch up on its own.
    })
    .finally(() => {
      clearTimeout(timer);
      if (inFlight === ctrl) inFlight = null;
    });
}
