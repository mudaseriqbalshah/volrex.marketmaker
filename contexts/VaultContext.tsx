"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { TokenConfig, TradingWallet, VaultData, Settings } from "@/types/domain";
import { emptyVault } from "@/types/domain";
import { initializeVault, unlockVault, saveVault, vaultExists, wipeVault } from "@/lib/vault";

type VaultState = {
  exists: boolean;
  unlocked: boolean;
  data: VaultData | null;
};

type VaultApi = VaultState & {
  initialize: (password: string) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  lock: () => void;
  wipe: () => void;
  updateSettings: (s: Partial<Settings>) => Promise<void>;
  setActiveToken: (addr: string | null) => Promise<void>;
  addToken: (t: TokenConfig) => Promise<void>;
  removeToken: (addr: string) => Promise<void>;
  setAdminFundingWallet: (w: { address: string; privateKey: string } | null) => Promise<void>;
  addTradingWallet: (w: TradingWallet) => Promise<void>;
  addTradingWallets: (ws: TradingWallet[]) => Promise<void>;
  updateTradingWallet: (id: string, patch: Partial<TradingWallet>) => Promise<void>;
  removeTradingWallet: (id: string) => Promise<void>;
};

const VaultContext = createContext<VaultApi | null>(null);

export function VaultProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<VaultState>(() => ({
    exists: typeof window !== "undefined" ? vaultExists() : false,
    unlocked: false,
    data: null,
  }));
  const keyRef = useRef<CryptoKey | null>(null);
  // dataRef mirrors state.data but updates synchronously. Mutations read from
  // here so a tight loop of `await vault.addX(...)` calls each see the result
  // of the previous one (instead of all seeing the closure-captured original).
  const dataRef = useRef<VaultData | null>(null);

  const persist = useCallback(async (next: VaultData) => {
    if (!keyRef.current) throw new Error("vault not unlocked");
    await saveVault(next, keyRef.current);
    dataRef.current = next;
    setState((s) => ({ ...s, data: next }));
  }, []);

  const initialize = useCallback(async (password: string) => {
    const { key, data } = await initializeVault(password, emptyVault());
    keyRef.current = key;
    dataRef.current = data;
    setState({ exists: true, unlocked: true, data });
  }, []);

  const unlock = useCallback(async (password: string) => {
    const { key, data } = await unlockVault(password);
    keyRef.current = key;
    dataRef.current = data;
    setState({ exists: true, unlocked: true, data });
  }, []);

  const lock = useCallback(() => {
    keyRef.current = null;
    dataRef.current = null;
    setState((s) => ({ ...s, unlocked: false, data: null }));
  }, []);

  const wipe = useCallback(() => {
    wipeVault();
    keyRef.current = null;
    dataRef.current = null;
    setState({ exists: false, unlocked: false, data: null });
  }, []);

  const mutate = useCallback(async (fn: (d: VaultData) => VaultData) => {
    const current = dataRef.current;
    if (!current) throw new Error("vault locked");
    const next = fn(current);
    await persist(next);
  }, [persist]);

  const api: VaultApi = useMemo(() => ({
    ...state,
    initialize, unlock, lock, wipe,
    updateSettings: (s) => mutate((d) => ({ ...d, settings: { ...d.settings, ...s } })),
    setActiveToken: (addr) => mutate((d) => ({ ...d, activeTokenAddress: addr })),
    addToken: (t) => mutate((d) => ({ ...d, tokens: [...d.tokens.filter((x) => x.address !== t.address), t] })),
    removeToken: (addr) => mutate((d) => ({ ...d, tokens: d.tokens.filter((t) => t.address !== addr), activeTokenAddress: d.activeTokenAddress === addr ? null : d.activeTokenAddress })),
    setAdminFundingWallet: (w) => mutate((d) => ({ ...d, adminFundingWallet: w })),
    addTradingWallet: (w) => mutate((d) => ({ ...d, tradingWallets: [...d.tradingWallets, w] })),
    addTradingWallets: (ws) => mutate((d) => ({ ...d, tradingWallets: [...d.tradingWallets, ...ws] })),
    updateTradingWallet: (id, patch) => mutate((d) => ({ ...d, tradingWallets: d.tradingWallets.map((w) => (w.id === id ? { ...w, ...patch } : w)) })),
    removeTradingWallet: (id) => mutate((d) => ({ ...d, tradingWallets: d.tradingWallets.filter((w) => w.id !== id) })),
  }), [state, initialize, unlock, lock, wipe, mutate]);

  return <VaultContext.Provider value={api}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultApi {
  const v = useContext(VaultContext);
  if (!v) throw new Error("useVault outside VaultProvider");
  return v;
}
