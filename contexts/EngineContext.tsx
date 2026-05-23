"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useVault } from "@/contexts/VaultContext";
import { ActionQueue } from "@/lib/engine/queue";
import { Worker as EngineWorker } from "@/lib/engine/worker";
import type { Action, NewAction } from "@/lib/engine/types";
import { writeEncrypted, readEncrypted } from "@/lib/storage";
import { deriveKey, randomBytes } from "@/lib/crypto";

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

      const dispatch = async (_a: Action) => {
        // Wired in Task 25 (Engine executors integration).
        throw new Error("dispatch not yet wired");
      };
      const concurrent = vault.data?.settings.maxConcurrent ?? 5;
      const worker = new EngineWorker({ queue, dispatch, maxConcurrent: concurrent, tickMs: 500 });
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
