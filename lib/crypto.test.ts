import { describe, it, expect } from "vitest";
import { deriveKey, encrypt, decrypt, randomBytes, toBase64, fromBase64 } from "@/lib/crypto";

describe("crypto", () => {
  it("randomBytes returns N bytes", () => {
    const b = randomBytes(16);
    expect(b.byteLength).toBe(16);
  });

  it("base64 round-trips", () => {
    const b = new Uint8Array([1, 2, 3, 250, 0, 255]);
    expect(fromBase64(toBase64(b))).toEqual(b);
  });

  it("derives a CryptoKey from password + salt", async () => {
    const salt = randomBytes(16);
    const key = await deriveKey("hunter2", salt);
    expect(key).toBeDefined();
    expect(key.algorithm.name).toBe("AES-GCM");
  });

  it("encrypts then decrypts a string round-trip", async () => {
    const salt = randomBytes(16);
    const key = await deriveKey("hunter2", salt);
    const { iv, ciphertext } = await encrypt(key, "hello world");
    const plain = await decrypt(key, iv, ciphertext);
    expect(plain).toBe("hello world");
  });

  it("wrong password fails decrypt", async () => {
    const salt = randomBytes(16);
    const key1 = await deriveKey("right", salt);
    const key2 = await deriveKey("wrong", salt);
    const { iv, ciphertext } = await encrypt(key1, "secret");
    await expect(decrypt(key2, iv, ciphertext)).rejects.toThrow();
  });
});
