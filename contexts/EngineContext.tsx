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
import { erc20Contract, getErc20Balance, getErc20Metadata } from "@/lib/erc20";
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
  random: { minDelayMs: 5_000, maxDelayMs: 15_000, minAmount: "0.005", maxAmount: "0.02", buyRatio: 0.55, slippageBps: 200 },
  roundRobin: { cycleDelayMs: 10_000, amountPerWallet: "0.01", buyRatio: 0.5, slippageBps: 200 },
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
  nativeBalances: Record<string, bigint>;
  tokenBalances: Record<string, bigint>;
  resetStuckActions: () => Promise<number>;
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
  const [nativeBalances, setNativeBalances] = useState<Record<string, bigint>>({});
  const [tokenBalances, setTokenBalances] = useState<Record<string, bigint>>({});
  const queueRef = useRef<ActionQueue | null>(null);
  const workerRef = useRef<EngineWorker | null>(null);
  const schedulerRef = useRef<{ stop: () => void } | null>(null);
  const persistKeyRef = useRef<CryptoKey | null>(null);
  const loggerRef = useRef<ActionLogger | null>(null);
  const dispatchRef = useRef<((a: Action) => Promise<{ txHash: string; receiptStatus: number }>) | null>(null);

  // Lifecycle 1: queue + logger + worker. Bound to vault.unlocked.
  // The worker calls dispatchRef.current(action), which is swapped in Lifecycle 2
  // whenever wallets or settings change — so adding a wallet after unlock works.
  useEffect(() => {
    if (!vault.unlocked) {
      queueRef.current = null;
      workerRef.current?.stop();
      workerRef.current = null;
      loggerRef.current = null;
      dispatchRef.current = null;
      setSnapshot([]);
      setLogs([]);
      setRunning(false);
      return;
    }
    void (async () => {
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
      // Reset any zombie "running" actions to "queued". They were marked
      // running by a prior session, but that session's in-memory worker is
      // gone — no one is dispatching them, and isWalletBusy would block
      // every future action for those wallets if left as-is.
      const hasZombies = initial.some((a) => a.status === "running");
      const repaired = hasZombies
        ? initial.map((a) => (a.status === "running" ? { ...a, status: "queued" as const, startedAt: undefined } : a))
        : initial;
      if (hasZombies) {
        await writeEncrypted(QUEUE_KEY, repaired, persistKeyRef.current);
      }
      const queue = new ActionQueue(repaired, async (snap) => {
        if (persistKeyRef.current) await writeEncrypted(QUEUE_KEY, snap, persistKeyRef.current);
        setSnapshot(snap);
      });
      queueRef.current = queue;
      setSnapshot(queue.all());

      const initialLogs = (await readEncrypted<LogEntry[]>(LOG_KEY, persistKeyRef.current).catch(() => null)) ?? [];
      const logger = new ActionLogger(initialLogs, async (entries) => {
        if (persistKeyRef.current) await writeEncrypted(LOG_KEY, entries, persistKeyRef.current);
        setLogs([...entries]);
      }, 1000);
      loggerRef.current = logger;
      setLogs(logger.all());

      const indirectDispatch = async (a: Action) => {
        const fn = dispatchRef.current;
        if (!fn) throw new Error("dispatch not ready — set funding wallet and at least one trading wallet first");
        return fn(a);
      };
      const worker = new EngineWorker({
        queue,
        dispatch: indirectDispatch,
        maxConcurrent: vault.data?.settings.maxConcurrent ?? 5,
        tickMs: 500,
        cooldownMs: vault.data?.settings.walletCooldownMs ?? 3_000,
      });
      workerRef.current = worker;
    })();
  }, [vault.unlocked, vault.data?.settings.maxConcurrent, vault.data?.settings.walletCooldownMs]);

  // Lifecycle 2: provider + signers + dispatch. Rebuilds whenever wallets or
  // chain-related settings change — so the engine picks up newly-added wallets
  // and updated RPC/router/WETH without needing a lock/unlock cycle.
  useEffect(() => {
    if (!vault.unlocked || !vault.data) {
      dispatchRef.current = null;
      return;
    }
    const settings = vault.data.settings;
    // Env fallback: if a vault was saved before env vars were set, use
    // NEXT_PUBLIC_* values instead of the empty strings persisted in the vault.
    const rpcUrl = settings.rpcUrl || process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.volrex.network/";
    const chainId = settings.chainId || Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 1378);
    const routerAddress = settings.routerAddress || process.env.NEXT_PUBLIC_ROUTER_ADDRESS || "";
    const wethAddress = settings.wethAddress || process.env.NEXT_PUBLIC_WETH_ADDRESS || "";
    if (!routerAddress || !wethAddress) {
      dispatchRef.current = async () => {
        throw new Error(
          "router or WETH address not configured — go to Settings and fill in NEXT_PUBLIC_ROUTER_ADDRESS / NEXT_PUBLIC_WETH_ADDRESS",
        );
      };
      return;
    }
    const provider = makeProvider({ rpcUrl, chainId, name: "configured" });
    const signers = new Map<string, ReturnType<typeof makeSigner>>();
    const addressById = new Map<string, string>();
    for (const w of vault.data.tradingWallets) {
      const s = makeSigner(w.privateKey, provider);
      signers.set(w.id, s);
      addressById.set(w.id, s.address);
    }
    if (vault.data.adminFundingWallet) {
      const s = makeSigner(vault.data.adminFundingWallet.privateKey, provider);
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
      routerAddress,
      wethAddress,
      gasMultiplier: settings.gasMultiplier,
      tokenDecimals,
    });
    dispatchRef.current = async (a: Action) => {
      try {
        const result = await baseDispatch(a);
        await loggerRef.current?.append({ ts: Date.now(), walletId: a.walletId, kind: a.kind, status: "done", txHash: result.txHash });
        return result;
      } catch (err: unknown) {
        const e = err as { code?: string; reason?: string; shortMessage?: string; message?: string; info?: { error?: { message?: string } } };
        // Prefer the most specific available — reason (e.g. "INSUFFICIENT_OUTPUT_AMOUNT"),
        // then nested RPC info.error.message, then shortMessage, then message.
        const errorMessage =
          e.reason ??
          e.info?.error?.message ??
          e.shortMessage ??
          e.message ??
          String(err);
        const errorCode = e.code ?? "UNKNOWN";
        await loggerRef.current?.append({ ts: Date.now(), walletId: a.walletId, kind: a.kind, status: "failed", errorCode, errorMessage });
        throw err;
      }
    };
  }, [
    vault.unlocked,
    vault.data?.adminFundingWallet,
    vault.data?.tradingWallets,
    vault.data?.settings.rpcUrl,
    vault.data?.settings.chainId,
    vault.data?.settings.routerAddress,
    vault.data?.settings.wethAddress,
    vault.data?.settings.gasMultiplier,
  ]);

  // Lifecycle 3: balance polling. Native (VLRX) for every wallet + active-token
  // balance per wallet. Polled at settings.balancePollMs. Rebuilds when wallets,
  // active token, or RPC change.
  useEffect(() => {
    if (!vault.unlocked || !vault.data) {
      setNativeBalances({});
      setTokenBalances({});
      return;
    }
    const settings = vault.data.settings;
    const rpcUrl = settings.rpcUrl || process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.volrex.network/";
    const chainId = settings.chainId || Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 1378);
    const provider = makeProvider({ rpcUrl, chainId, name: "configured" });
    const wallets: Array<{ id: string; address: string }> = [];
    if (vault.data.adminFundingWallet) {
      wallets.push({ id: "admin", address: vault.data.adminFundingWallet.address });
    }
    for (const w of vault.data.tradingWallets) {
      wallets.push({ id: w.id, address: w.address });
    }
    if (wallets.length === 0) {
      setNativeBalances({});
      setTokenBalances({});
      return;
    }
    const activeTokenAddr = vault.data.activeTokenAddress;
    const tokenC = activeTokenAddr ? erc20Contract(activeTokenAddr, provider) : null;

    let cancelled = false;
    const poll = async () => {
      const native: Record<string, bigint> = {};
      const token: Record<string, bigint> = {};
      await Promise.all(
        wallets.map(async (w) => {
          try {
            native[w.id] = await provider.getBalance(w.address);
          } catch {
            // ignore — partial results are fine
          }
          if (tokenC) {
            try {
              token[w.id] = await getErc20Balance(tokenC, w.address);
            } catch {
              // ignore
            }
          }
        }),
      );
      if (!cancelled) {
        setNativeBalances(native);
        setTokenBalances(token);
      }
    };

    void poll();
    const interval = setInterval(() => void poll(), settings.balancePollMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    vault.unlocked,
    vault.data?.adminFundingWallet,
    vault.data?.tradingWallets,
    vault.data?.activeTokenAddress,
    vault.data?.settings.rpcUrl,
    vault.data?.settings.chainId,
    vault.data?.settings.balancePollMs,
  ]);

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

  // Manually flip any action stuck in "running" back to "queued" so the worker
  // can pick it up again. Returns the number of actions reset.
  const resetStuckActions = useCallback(async () => {
    const queue = queueRef.current;
    if (!queue) return 0;
    const stuck = queue.all().filter((a) => a.status === "running");
    for (const a of stuck) {
      await queue.requeue(a.id);
    }
    return stuck.length;
  }, []);

  const api: EngineApi = useMemo(() => ({
    mode, setMode, running, start, stop, drain, queueSnapshot: snapshot, enqueue, removeFromQueue, logs,
    nativeBalances, tokenBalances, resetStuckActions,
  }), [mode, running, snapshot, start, stop, drain, enqueue, removeFromQueue, logs, nativeBalances, tokenBalances, resetStuckActions]);

  return <EngineContext.Provider value={api}>{children}</EngineContext.Provider>;
}

export function useEngine(): EngineApi {
  const e = useContext(EngineContext);
  if (!e) throw new Error("useEngine outside EngineProvider");
  return e;
}
