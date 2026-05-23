export function canBuy(p: { native: bigint; amount: bigint; gasBuffer: bigint }): boolean {
  return p.native >= p.amount + p.gasBuffer;
}

export function canSell(p: { tokenBal: bigint; amount: bigint; native: bigint; gasBuffer: bigint }): boolean {
  return p.tokenBal >= p.amount && p.native >= p.gasBuffer;
}

export function canTransferBack(p: { balance: bigint; amount: bigint; buffer: bigint }): boolean {
  return p.balance >= p.amount + p.buffer;
}
