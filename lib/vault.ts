import { deriveKey, randomBytes, toBase64, fromBase64 } from "@/lib/crypto";
import { writeEncrypted, readEncrypted, hasKey, removeKey } from "@/lib/storage";
import type { VaultData } from "@/types/domain";

const VAULT_KEY = "mm.vault.v1";
const SALT_KEY = "mm.salt.v1";

export function vaultExists(): boolean {
  return hasKey(VAULT_KEY) && hasKey(SALT_KEY);
}

export function wipeVault(): void {
  removeKey(VAULT_KEY);
  removeKey(SALT_KEY);
}

function loadSalt(): Uint8Array | null {
  const s = localStorage.getItem(SALT_KEY);
  return s ? fromBase64(s) : null;
}

function storeSalt(salt: Uint8Array): void {
  localStorage.setItem(SALT_KEY, toBase64(salt));
}

export async function initializeVault(password: string, initial: VaultData): Promise<{ key: CryptoKey; data: VaultData }> {
  if (vaultExists()) throw new Error("vault already initialized");
  const salt = randomBytes(16);
  storeSalt(salt);
  const key = await deriveKey(password, salt);
  await writeEncrypted(VAULT_KEY, initial, key);
  return { key, data: initial };
}

export async function unlockVault(password: string): Promise<{ key: CryptoKey; data: VaultData }> {
  const salt = loadSalt();
  if (!salt) throw new Error("vault not initialized");
  const key = await deriveKey(password, salt);
  const data = await readEncrypted<VaultData>(VAULT_KEY, key);
  if (data === null) throw new Error("vault data missing");
  return { key, data };
}

export async function saveVault(data: VaultData, key: CryptoKey): Promise<void> {
  await writeEncrypted(VAULT_KEY, data, key);
}
