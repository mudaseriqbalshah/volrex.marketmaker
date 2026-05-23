"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useVault } from "@/contexts/VaultContext";
import { ActionQueue } from "@/lib/engine/queue";
import { Worker as EngineWorker } from "@/lib/engine/worker";
import type { Action, NewAction } from "@/lib/engine/types";
import { writeEncrypted, readEncrypted } from "@/lib/storage";
import { deriveKey, randomBytes } from "@/lib/crypto";
import { makeProvider } from "@/lib/chain";
import { makeSigner } from "@/lib/wallets";
import { erc20Contract, getErc20Metadata } from "@/lib/erc20";
import { makeDispatch } from "@/lib/engine/dispatch";

type EngineMode = "manual" | "random" | "roundRobin";

type EngineApi = {
  mode: EngineMode;
  setMode: (m: EngineMode) => void;
  running: boolean;
  start: () => void;
  stop: () => void;
  drain: () => void;
  queueSnapshot: Action[];
  enqueue: (a: NewAction) => Promise<Action>;
  removeFromQueue: (id: string) => Promise<void>;
};

const EngineContext = createContext<EngineApi | null>(null);

const QUEUE_KEY = "mm.queue.v1";

export function EngineProvider({ children }: { children: ReactNode }) {
  const vault = useVault();
  const [mode, setMode] = useState<EngineMode>("manual");
  const [running, setRunning] = useState(false);
  const [snapshot, setSnapshot] = useState<Action[]>([]);
  const queueRef = useRef<ActionQueue | null>(null);
  const workerRef = useRef<EngineWorker | null>(null);
  const persistKeyRef = useRef<CryptoKey | null>(null);

  useEffect(() => {
    if (!vault.unlocked) {
      queueRef.current = null;
      workerRef.current?.stop();
      workerRef.current = null;
      setSnapshot([]);
      setRunning(false);
      return;
    }
    void (async () => {
      // Use a deterministic-per-session key for queue persistence so a refresh resumes.
      // We derive from a constant string + a fresh salt persisted alongside the queue.
      persistKeyRef.current = await deriveKey("queue", randomBytes(16));
      const initial = (await readEncrypted<Action[]>(QUEUE_KEY, persistKeyRef.current).catch(() => null)) ?? [];
      const queue = new ActionQueue(initial, async (snap) => {
        if (persistKeyRef.current) await writeEncrypted(QUEUE_KEY, snap, persistKeyRef.current);
        setSnapshot(snap);
      });
      queueRef.current = queue;
      setSnapshot(queue.all());

      const settings = vault.data!.settings;
      const provider = makeProvider({ rpcUrl: settings.rpcUrl, chainId: settings.chainId, name: "configured" });
      const signers = new Map<string, ReturnType<typeof makeSigner>>();
      const addressById = new Map<string, string>();
      for (const w of vault.data!.tradingWallets) {
        const s = makeSigner(w.privateKey, provider);
        signers.set(w.id, s);
        addressById.set(w.id, s.address);
      }
      if (vault.data!.adminFundingWallet) {
        const s = makeSigner(vault.data!.adminFundingWallet.privateKey, provider);
        signers.set("admin", s);
        addressById.set("admin", s.address);
      }
      const tokenDecimalsCache = new Map<string, number>();
      const tokenDecimals = async (addr: string): Promise<number> => {
        const cached = tokenDecimalsCache.get(addr);
        if (cached !== undefined) return cached;
        const m = await getErc20Metadata(erc20Contract(addr, provider));
        tokenDecimalsCache.set(addr, m.decimals);
        return m.decimals;
      };
      const dispatch = makeDispatch({
        provider,
        getSigner: (id) => { const s = signers.get(id); if (!s) throw new Error(`no signer for ${id}`); return s; },
        getAddressByWalletId: (id) => { const a = addressById.get(id); if (!a) throw new Error(`no address for ${id}`); return a; },
        routerAddress: settings.routerAddress,
        wethAddress: settings.wethAddress,
        gasMultiplier: settings.gasMultiplier,
        tokenDecimals,
      });
      const worker = new EngineWorker({ queue, dispatch, maxConcurrent: settings.maxConcurrent, tickMs: 500 });
      workerRef.current = worker;
    })();
  }, [vault.unlocked, vault.data?.settings.maxConcurrent]);

  const start = useCallback(() => { workerRef.current?.start(); workerRef.current?.resume(); setRunning(true); }, []);
  const stop = useCallback(() => { workerRef.current?.stop(); setRunning(false); }, []);
  const drain = useCallback(() => { workerRef.current?.drain(); setRunning(false); }, []);

  const enqueue = useCallback(async (a: NewAction) => {
    if (!queueRef.current) throw new Error("engine not ready");
    const item = await queueRef.current.enqueue(a);
    return item;
  }, []);

  const removeFromQueue = useCallback(async (id: string) => {
    if (!queueRef.current) return;
    await queueRef.current.remove(id);
  }, []);

  const api: EngineApi = useMemo(() => ({
    mode, setMode, running, start, stop, drain, queueSnapshot: snapshot, enqueue, removeFromQueue,
  }), [mode, running, snapshot, start, stop, drain, enqueue, removeFromQueue]);

  return <EngineContext.Provider value={api}>{children}</EngineContext.Provider>;
}

export function useEngine(): EngineApi {
  const e = useContext(EngineContext);
  if (!e) throw new Error("useEngine outside EngineProvider");
  return e;
}
