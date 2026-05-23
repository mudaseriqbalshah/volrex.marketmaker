"use client";

import { useState } from "react";
import { useVault } from "@/contexts/VaultContext";
import { DEFAULT_SETTINGS, type Settings } from "@/types/domain";

export function SettingsForm() {
  const vault = useVault();
  // Merge persisted settings with defaults so newly-added fields (e.g.
  // walletCooldownMs) render with a sane value for vaults saved before
  // those fields existed.
  const initial = vault.data?.settings
    ? { ...DEFAULT_SETTINGS, ...vault.data.settings }
    : null;
  const [s, setS] = useState<Settings | null>(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!s) return null;

  async function save() {
    setSaving(true);
    try { await vault.updateSettings(s!); setMsg("Saved."); } finally { setSaving(false); setTimeout(() => setMsg(null), 2000); }
  }

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s!, [k]: v });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-w-3xl">
      <Field label="RPC URL"><input value={s.rpcUrl} onChange={(e) => set("rpcUrl", e.target.value)} className="input" /></Field>
      <Field label="Chain ID"><input type="number" value={s.chainId} onChange={(e) => set("chainId", Number(e.target.value))} className="input" /></Field>
      <Field label="Router address"><input value={s.routerAddress} onChange={(e) => set("routerAddress", e.target.value)} className="input font-mono text-sm" /></Field>
      <Field label="WETH address"><input value={s.wethAddress} onChange={(e) => set("wethAddress", e.target.value)} className="input font-mono text-sm" /></Field>
      <Field label="Max concurrent txs"><input type="number" value={s.maxConcurrent} onChange={(e) => set("maxConcurrent", Number(e.target.value))} className="input" /></Field>
      <Field label="Gas multiplier"><input type="number" step="0.05" value={s.gasMultiplier} onChange={(e) => set("gasMultiplier", Number(e.target.value))} className="input" /></Field>
      <Field label="Balance poll interval (ms)"><input type="number" value={s.balancePollMs} onChange={(e) => set("balancePollMs", Number(e.target.value))} className="input" /></Field>
      <Field label="Auto-lock idle (ms)"><input type="number" value={s.autoLockIdleMs} onChange={(e) => set("autoLockIdleMs", Number(e.target.value))} className="input" /></Field>
      <Field label="Per-wallet cooldown (ms)"><input type="number" value={s.walletCooldownMs} onChange={(e) => set("walletCooldownMs", Number(e.target.value))} className="input" /></Field>
      <div className="lg:col-span-2 flex items-center gap-3">
        <button onClick={save} disabled={saving} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
        {msg && <span className="text-sm text-emerald-400">{msg}</span>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm text-slate-400">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
