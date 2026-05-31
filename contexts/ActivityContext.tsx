"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

type ActivityApi = {
  // Number of currently in-flight tracked operations.
  busyCount: number;
  // Label of the most recent operation (for tooltip / status text).
  currentLabel: string | null;
  // Wrap an async operation so the global indicator shows while it runs.
  // Returns the resolved value (or rethrows the error after un-tracking).
  track: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
};

const ActivityContext = createContext<ActivityApi | null>(null);

export function ActivityProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);
  const [label, setLabel] = useState<string | null>(null);

  const track = useCallback(async <T,>(opLabel: string, fn: () => Promise<T>): Promise<T> => {
    setCount((c) => c + 1);
    setLabel(opLabel);
    try {
      return await fn();
    } finally {
      setCount((c) => Math.max(0, c - 1));
    }
  }, []);

  const api = useMemo<ActivityApi>(() => ({
    busyCount: count,
    currentLabel: count > 0 ? label : null,
    track,
  }), [count, label, track]);

  return <ActivityContext.Provider value={api}>{children}</ActivityContext.Provider>;
}

export function useActivity(): ActivityApi {
  const v = useContext(ActivityContext);
  if (!v) throw new Error("useActivity outside ActivityProvider");
  return v;
}
