"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { useVault } from "@/contexts/VaultContext";
import { FirstTimeSetup } from "@/components/auth/FirstTimeSetup";

export function VaultGate({ children }: { children: ReactNode }) {
  const vault = useVault();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!vault.exists) return <FirstTimeSetup />;
  if (vault.unlocked) return <>{children}</>;

  async function submit() {
    setErr(null); setBusy(true);
    try { await vault.unlock(pw); } catch { setErr("Wrong password."); } finally { setBusy(false); }
  }

  return (
    <div className="p-8 max-w-md mx-auto mt-16 border border-slate-700 rounded-md">
      <h2 className="text-xl font-semibold">Unlock vault</h2>
      <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" className="w-full mt-4 px-3 py-2 bg-slate-900 border border-slate-700 rounded" autoFocus />
      {err && <p className="text-sm text-red-400 mt-2">{err}</p>}
      <button onClick={submit} disabled={busy} className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded disabled:opacity-50">
        {busy ? "Unlocking…" : "Unlock"}
      </button>
    </div>
  );
}
