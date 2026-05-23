"use client";
export function AddressDisplay({ address }: { address: string }) {
  return (
    <button
      onClick={() => navigator.clipboard.writeText(address)}
      title="Click to copy"
      className="font-mono text-xs hover:text-indigo-300"
    >
      {address.slice(0, 6)}…{address.slice(-4)}
    </button>
  );
}
