import { encrypt, decrypt, toBase64, fromBase64 } from "@/lib/crypto";

type Envelope = { v: 1; iv: string; ct: string };

export function hasKey(name: string): boolean {
  return typeof window !== "undefined" && localStorage.getItem(name) !== null;
}

export function removeKey(name: string): void {
  if (typeof window !== "undefined") localStorage.removeItem(name);
}

export async function writeEncrypted<T>(name: string, value: T, key: CryptoKey): Promise<void> {
  const json = JSON.stringify(value);
  const { iv, ciphertext } = await encrypt(key, json);
  const envelope: Envelope = { v: 1, iv: toBase64(iv), ct: toBase64(ciphertext) };
  localStorage.setItem(name, JSON.stringify(envelope));
}

export async function readEncrypted<T>(name: string, key: CryptoKey): Promise<T | null> {
  const raw = localStorage.getItem(name);
  if (raw === null) return null;
  const env = JSON.parse(raw) as Envelope;
  if (env.v !== 1) throw new Error(`unknown envelope version: ${env.v}`);
  const plain = await decrypt(key, fromBase64(env.iv), fromBase64(env.ct));
  return JSON.parse(plain) as T;
}
