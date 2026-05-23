import "@testing-library/jest-dom/vitest";

if (!globalThis.crypto || !globalThis.crypto.subtle) {
  // happy-dom provides WebCrypto, but ensure subtle exists.
  // Fail loudly so we notice if env regresses.
  throw new Error("WebCrypto subtle API not available in test env");
}
