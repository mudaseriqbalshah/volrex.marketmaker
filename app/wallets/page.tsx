"use client";

import { useState } from "react";
import { WalletTable } from "@/components/wallets/WalletTable";
import { GenerateWalletsModal } from "@/components/wallets/GenerateWalletsModal";
import { ImportKeyModal } from "@/components/wallets/ImportKeyModal";
import { useVault } from "@/contexts/VaultContext";
import { AddressDisplay } from "@/components/common/AddressDisplay";

export default function WalletsPage() {
  const vault = useVault();
  const [showGen, setShowGen] = useState(false);
  const [showImport, setShowImport] = useState<null | "trading" | "admin">(null);

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-semibold">Funding wallet</h2>
        {vault.data?.adminFundingWallet
          ? <div className="mt-2 flex items-center gap-3"><AddressDisplay address={vault.data.adminFundingWallet.address} /><button onClick={() => void vault.setAdminFundingWallet(null)} className="text-red-400 text-xs">Remove</button></div>
          : <button onClick={() => setShowImport("admin")} className="mt-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm">Set funding wallet</button>}
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Trading wallets</h2>
          <div className="space-x-2">
            <button onClick={() => setShowGen(true)} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded text-sm">Generate</button>
            <button onClick={() => setShowImport("trading")} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded text-sm">Import</button>
          </div>
        </div>
        <div className="mt-4"><WalletTable /></div>
      </section>

      {showGen && <GenerateWalletsModal onClose={() => setShowGen(false)} />}
      {showImport && <ImportKeyModal target={showImport} onClose={() => setShowImport(null)} />}
    </div>
  );
}
