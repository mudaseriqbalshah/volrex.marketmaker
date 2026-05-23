"use client";

import { useState } from "react";
import { TokenList } from "@/components/tokens/TokenList";
import { AddTokenModal } from "@/components/tokens/AddTokenModal";

export default function TokensPage() {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Tokens</h2>
        <button onClick={() => setOpen(true)} className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-sm">Add token</button>
      </div>
      <TokenList />
      {open && <AddTokenModal onClose={() => setOpen(false)} />}
    </div>
  );
}
