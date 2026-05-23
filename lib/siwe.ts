import { verifyMessage, getAddress } from "ethers";

const SESSION_KEY = "mm.session.v1";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export type SiweMessageParts = {
  address: string;
  domain: string;
  uri: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
  chainId: number;
};

export function buildSiweMessage(p: SiweMessageParts): string {
  return [
    `${p.domain} wants you to sign in with your Ethereum account:`,
    p.address,
    "",
    "Authorize Market Maker admin session.",
    "",
    `URI: ${p.uri}`,
    `Version: 1`,
    `Chain ID: ${p.chainId}`,
    `Nonce: ${p.nonce}`,
    `Issued At: ${p.issuedAt}`,
    `Expiration Time: ${p.expirationTime}`,
  ].join("\n");
}

export async function verifySiweMessage(message: string, signature: string, expectedAddress: string): Promise<boolean> {
  try {
    const recovered = verifyMessage(message, signature);
    return getAddress(recovered) === getAddress(expectedAddress);
  } catch {
    return false;
  }
}

export type Session = { address: string; expiresAt: number };

export function saveSession(s: Session): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

export function loadSession(): Session | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

export function isSessionValid(): boolean {
  const s = loadSession();
  return s !== null && s.expiresAt > Date.now();
}

export function makeNonce(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newSessionExpiry(): number {
  return Date.now() + SESSION_TTL_MS;
}
