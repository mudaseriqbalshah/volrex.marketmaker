import type { JsonRpcProvider } from "ethers";

export class LocalNonceTracker {
  private current: number | null = null;
  constructor(private provider: Pick<JsonRpcProvider, "getTransactionCount">, private address: string) {}

  async next(): Promise<number> {
    if (this.current === null) {
      this.current = await this.provider.getTransactionCount(this.address, "pending");
    } else {
      this.current += 1;
    }
    return this.current;
  }

  async resync(): Promise<void> {
    this.current = null;
  }

  peek(): number | null {
    return this.current;
  }
}
