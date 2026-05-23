export type ActionKind =
  | "Buy"
  | "Sell"
  | "Approve"
  | "TransferETH"
  | "TransferBackETH"
  | "TransferToken"
  | "TransferBackToken";

export type ActionStatus = "queued" | "running" | "done" | "failed";

export type BaseAction = {
  id: string;
  kind: ActionKind;
  walletId: string;       // the wallet that signs
  createdAt: number;
  status: ActionStatus;
  attempts: number;
  lastError?: { code: string; message: string };
  txHash?: string;
  startedAt?: number;
  completedAt?: number;
};

// AmountMode controls how the dispatch interprets the amount field:
// - "absolute" (default): the amount is the literal token quantity (decimal string).
// - "percentage": the amount is a percentage 0-100 of the wallet's current
//   balance — resolved at dispatch time so it tracks the live balance.
export type AmountMode = "absolute" | "percentage";

export type BuyParams = {
  tokenAddress: string;
  amountNative: string;
  slippageBps: number;
  amountMode?: AmountMode;
  // For percentage mode only: the minimum amount of native to leave for gas
  // (decimal string, in native units). Defaults to "0.001" if omitted.
  gasReserve?: string;
};
export type SellParams = {
  tokenAddress: string;
  amountToken: string;
  slippageBps: number;
  amountMode?: AmountMode;
};
export type ApproveParams = { tokenAddress: string; spender: string; amount: string };
export type TransferEthParams = { toWalletId: string; amount: string | "all-minus-buffer"; gasBuffer?: string };
export type TransferTokenParams = { tokenAddress: string; toWalletId: string; amount: string };

export type Action =
  | (BaseAction & { kind: "Buy"; params: BuyParams })
  | (BaseAction & { kind: "Sell"; params: SellParams })
  | (BaseAction & { kind: "Approve"; params: ApproveParams })
  | (BaseAction & { kind: "TransferETH" | "TransferBackETH"; params: TransferEthParams })
  | (BaseAction & { kind: "TransferToken" | "TransferBackToken"; params: TransferTokenParams });

export type NewAction = Omit<Action, "id" | "createdAt" | "status" | "attempts">;
