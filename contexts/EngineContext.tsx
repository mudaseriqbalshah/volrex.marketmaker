"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useVault } from "@/contexts/VaultContext";
import { ActionQueue } from "@/lib/engine/queue";
import { Worker as EngineWorker } from "@/lib/engine/worker";
import type { Action, NewAction } from "@/lib/engine/types";
import { writeEncrypted, readEncrypted } from "@/lib/storage";
import { deriveKey, randomBytes, fromBase64, toBase64 } from "@/lib/crypto";
import { makeProvider } from "@/lib/chain";
import { makeSigner } from "@/lib/wallets";
import { erc20Contract, getErc20Metadata } from "@/lib/erc20";
import { makeDispatch } from "@/lib/engine/dispatch";
import { RandomScheduler } from "@/lib/engine/schedulers/random";
import { RoundRobinScheduler } from "@/lib/engine/schedulers/roundRobin";
import { ActionLogger } from "@/lib/logger";
import type { LogEntry } from "@/lib/logger";

type EngineMode = "manual" | "random" | "roundRobin";

type SchedulerCfg = {
  random: { minDelayMs: number; maxDelayMs: number; minAmount: string; maxAmount: string; buyRatio: number; slippageBps: number };
  roundRobin: { cycleDelayMs: number; amountPerWallet: string; buyRatio: number; slippageBps: number };
};

const DEFAULT_SCHED_CFG: SchedulerCfg = {
  random: { minDelayMs: 30_000, maxDelayMs: 90_000, minAmount: "0.005", maxAmount: "0.02", buyRatio: 0.55, slippageBps: 200 },
  roundRobin: { cycleDelayMs: 60_000, amountPerWallet: "0.01", buyRatio: 0.5, slippageBps: 200 },
};

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
  logs: LogEntry[];
};

const EngineContext = createContext<EngineApi | null>(null);

const QUEUE_KEY = "mm.queue.v1";
const QUEUE_SALT_KEY = "mm.queue-salt.v1";
const LOG_KEY = "mm.logs.v1";

export function EngineProvider({ children }: { children: ReactNode }) {
  const vault = useVault();
  const [mode, setMode] = useState<EngineMode>("manual");
  const [running, setRunning] = useState(false);
  const [snapshot, setSnapshot] = useState<Action[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const queueRef = useRef<ActionQueue | null>(null);
  const workerRef = useRef<EngineWorker | null>(null);
  const schedulerRef = useRef<{ stop: () => void } | null>(null);
  const persistKeyRef = useRef<CryptoKey | null>(null);
  const loggerRef = useRef<ActionLogger | null>(null);

  useEffect(() => {
    if (!vault.unlocked) {
      queueRef.current = null;
      workerRef.current?.stop();
      workerRef.current = null;
      loggerRef.current = null;
      setSnapshot([]);
      setLogs([]);
      setRunning(false);
      return;
    }
    void (async () => {
      // Use a deterministic-per-session key for queue persistence so a refresh resumes.
      // We derive from a constant string + a salt persisted alongside the queue.
      // On first unlock, generate and persist the salt; on subsequent unlocks, reuse it.
      let saltB64 = localStorage.getItem(QUEUE_SALT_KEY);
      let salt: Uint8Array;
      if (saltB64) {
        salt = fromBase64(saltB64);
      } else {
        salt = randomBytes(16);
        localStorage.setItem(QUEUE_SALT_KEY, toBase64(salt));
      }
      persistKeyRef.current = await deriveKey("queue", salt);
      const initial = (await readEncrypted<Action[]>(QUEUE_KEY, persistKeyRef.current).catch(() => null)) ?? [];
      const queue = new ActionQueue(initial, async (snap) => {
        if (persistKeyRef.current) await writeEncrypted(QUEUE_KEY, snap, persistKeyRef.current);
        setSnapshot(snap);
      });
      queueRef.current = queue;
      setSnapshot(queue.all());

      // Hydrate logger from encrypted storage
      const initialLogs = (await readEncrypted<LogEntry[]>(LOG_KEY, persistKeyRef.current).catch(() => null)) ?? [];
      const logger = new ActionLogger(initialLogs, async (entries) => {
        if (persistKeyRef.current) await writeEncrypted(LOG_KEY, entries, persistKeyRef.current);
        setLogs([...entries]);
      }, 1000);
      loggerRef.current = logger;
      setLogs(logger.all());

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
      const baseDispatch = makeDispatch({
        provider,
        getSigner: (id) => { const s = signers.get(id); if (!s) throw new Error(`no signer for ${id}`); return s; },
        getAddressByWalletId: (id) => { const a = addressById.get(id); if (!a) throw new Error(`no address for ${id}`); return a; },
        routerAddress: settings.routerAddress,
        wethAddress: settings.wethAddress,
        gasMultiplier: settings.gasMultiplier,
        tokenDecimals,
      });
      // Wrap dispatch to append log entries on success/failure
      const dispatch = async (a: Action) => {
        try {
          const result = await baseDispatch(a);
          await loggerRef.current?.append({ ts: Date.now(), walletId: a.walletId, kind: a.kind, status: "done", txHash: result.txHash });
          return result;
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          const errorCode = (err as { code?: string }).code ?? "UNKNOWN";
          await loggerRef.current?.append({ ts: Date.now(), walletId: a.walletId, kind: a.kind, status: "failed", errorCode, errorMessage });
          throw err;
        }
      };
      const worker = new EngineWorker({ queue, dispatch, maxConcurrent: settings.maxConcurrent, tickMs: 500 });
      workerRef.current = worker;
    })();
  }, [vault.unlocked, vault.data?.settings.maxConcurrent]);

  const enqueue = useCallback(async (a: NewAction) => {
    if (!queueRef.current) throw new Error("engine not ready");
    const item = await queueRef.current.enqueue(a);
    return item;
  }, []);

  const start = useCallback(() => {
    workerRef.current?.start(); workerRef.current?.resume();
    setRunning(true);
    if (mode === "manual") return;
    if (!vault.data) return;
    const wallets = vault.data.tradingWallets.map((w) => w.id);
    const tokenAddress = vault.data.activeTokenAddress;
    if (!tokenAddress || wallets.length === 0) return;
    const emit = (a: NewAction) => { void enqueue(a); };
    // Eligibility starts permissive; balance polling is out of v1 scope.
    // Bad-eligibility actions fail at chain-call time and the worker logs/skips them.
    const eligibleBuy = () => true;
    const eligibleSell = () => true;
    if (mode === "random") {
      const cfg = DEFAULT_SCHED_CFG.random;
      const s = new RandomScheduler({ wallets, tokenAddress, ...cfg, eligibleBuy, eligibleSell, emit });
      s.start(); schedulerRef.current = s;
    } else if (mode === "roundRobin") {
      const cfg = DEFAULT_SCHED_CFG.roundRobin;
      const s = new RoundRobinScheduler({ wallets, tokenAddress, ...cfg, eligibleBuy, eligibleSell, emit });
      s.start(); schedulerRef.current = s;
    }
  }, [mode, vault.data, enqueue]);

  const stop = useCallback(() => {
    schedulerRef.current?.stop(); schedulerRef.current = null;
    workerRef.current?.stop(); setRunning(false);
  }, []);

  const drain = useCallback(() => {
    schedulerRef.current?.stop(); schedulerRef.current = null;
    workerRef.current?.drain(); setRunning(false);
  }, []);

  const removeFromQueue = useCallback(async (id: string) => {
    if (!queueRef.current) return;
    await queueRef.current.remove(id);
  }, []);

  const api: EngineApi = useMemo(() => ({
    mode, setMode, running, start, stop, drain, queueSnapshot: snapshot, enqueue, removeFromQueue, logs,
  }), [mode, running, snapshot, start, stop, drain, enqueue, removeFromQueue, logs]);

  return <EngineContext.Provider value={api}>{children}</EngineContext.Provider>;
}

export function useEngine(): EngineApi {
  const e = useContext(EngineContext);
  if (!e) throw new Error("useEngine outside EngineProvider");
  return e;
}
