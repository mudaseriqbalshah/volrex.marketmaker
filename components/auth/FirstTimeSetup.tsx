"use client";

import { useState } from "react";
import { useVault } from "@/contexts/VaultContext";

export function FirstTimeSetup() {
  const { initialize } = useVault();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    if (pw.length < 12) return setErr("Password must be at least 12 characters.");
    if (pw !== pw2) return setErr("Passwords don't match.");
    setBusy(true);
    try { await initialize(pw); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="p-8 max-w-md mx-auto mt-16 border border-slate-700 rounded-md">
      <h2 className="text-xl font-semibold">Set vault password</h2>
      <p className="text-sm text-slate-400 mt-1">This encrypts all private keys at rest. There is no recovery — losing it means re-importing every key.</p>
      <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" className="w-full mt-4 px-3 py-2 bg-slate-900 border border-slate-700 rounded" />
      <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Confirm password" className="w-full mt-2 px-3 py-2 bg-slate-900 border border-slate-700 rounded" />
      {err && <p className="text-sm text-red-400 mt-2">{err}</p>}
      <button onClick={submit} disabled={busy} className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded disabled:opacity-50">
        {busy ? "Setting up…" : "Create vault"}
      </button>
    </div>
  );
}
