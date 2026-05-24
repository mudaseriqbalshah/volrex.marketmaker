export enum ErrorCode {
  Network = "network",
  Nonce = "nonce",
  Gas = "gas",
  Revert = "revert",
  Timeout = "timeout",
  Unknown = "unknown",
}

type Errish = { code?: string; reason?: string; message?: string };

function asErrish(e: unknown): Errish {
  if (typeof e === "object" && e !== null) return e as Errish;
  return {};
}

export function classifyError(e: unknown): ErrorCode {
  const err = asErrish(e);
  const msg = (err.message ?? "").toLowerCase();
  const code = (err.code ?? "").toString();

  // Our own dispatch timeouts (Promise.race) come through with code=TIMEOUT.
  // Treat these separately from network errors so the worker DOES NOT retry
  // a stuck transaction — it should abandon and move to the next one.
  if (code === "TIMEOUT" || msg.includes("did not complete within")) {
    return ErrorCode.Timeout;
  }
  if (code === "NONCE_EXPIRED" || msg.includes("nonce too low") || msg.includes("replacement transaction underpriced")) {
    return ErrorCode.Nonce;
  }
  if (msg.includes("transaction underpriced") || msg.includes("intrinsic gas too low")) {
    return ErrorCode.Gas;
  }
  if (code === "NETWORK_ERROR" || code === "SERVER_ERROR") {
    return ErrorCode.Network;
  }
  if (code === "CALL_EXCEPTION") return ErrorCode.Revert;
  return ErrorCode.Unknown;
}

export type ClassifiedError = { code: ErrorCode; message: string };

export function toClassified(e: unknown): ClassifiedError {
  const err = asErrish(e);
  return { code: classifyError(e), message: err.message ?? String(e) };
}
