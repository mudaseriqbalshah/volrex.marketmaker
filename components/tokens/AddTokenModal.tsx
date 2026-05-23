"use client";

import { useState } from "react";
import { useVault } from "@/contexts/VaultContext";
import { makeProvider } from "@/lib/chain";
import { erc20Contract, getErc20Metadata } from "@/lib/erc20";

export function AddTokenModal({ onClose }: { onClose: () => void }) {
  const vault = useVault();
  const [addr, setAddr] = useState("");
  const [slippage, setSlippage] = useState(200);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr(null); setBusy(true);
    try {
      if (!vault.data) throw new Error("vault locked");
      const provider = makeProvider({ rpcUrl: vault.data.settings.rpcUrl, chainId: vault.data.settings.chainId, name: "configured" });
      const { symbol, decimals } = await getErc20Metadata(erc20Contract(addr, provider));
      await vault.addToken({ address: addr, symbol, decimals, defaultSlippageBps: slippage });
      onClose();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center">
      <div className="bg-slate-900 border border-slate-700 rounded p-6 w-96">
        <h3 className="text-lg font-semibold">Add token</h3>
        <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="0x token address" className="w-full mt-3 px-3 py-2 bg-slate-950 border border-slate-700 rounded font-mono text-sm" />
        <label className="block text-sm mt-3 text-slate-400">Default slippage (bps)</label>
        <input type="number" value={slippage} onChange={(e) => setSlippage(Number(e.target.value))} className="w-full mt-1 px-3 py-2 bg-slate-950 border border-slate-700 rounded" />
        {err && <p className="text-sm text-red-400 mt-2">{err}</p>}
        <div className="mt-4 flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-2 text-slate-300 hover:text-white">Cancel</button>
          <button onClick={submit} disabled={busy} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded disabled:opacity-50">{busy ? "Loading…" : "Add"}</button>
        </div>
      </div>
    </div>
  );
}
