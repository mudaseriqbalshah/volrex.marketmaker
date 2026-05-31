import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Action } from "@/lib/engine/types";
import type { LogEntry } from "@/lib/logger";

// File layout per config:
//   <stateDir>/queue.json
//   <stateDir>/log.jsonl
// stateDir defaults to ./mm-state alongside the config file.

export class CliState {
  constructor(private stateDir: string) {}

  static fromConfigPath(cfgPath: string): CliState {
    const dir = path.join(path.dirname(path.resolve(cfgPath)), "mm-state");
    return new CliState(dir);
  }

  async ensureDir(): Promise<void> {
    if (!existsSync(this.stateDir)) {
      await mkdir(this.stateDir, { recursive: true });
    }
  }

  private queuePath(): string {
    return path.join(this.stateDir, "queue.json");
  }

  private logPath(): string {
    return path.join(this.stateDir, "log.jsonl");
  }

  async loadQueue(): Promise<Action[]> {
    if (!existsSync(this.queuePath())) return [];
    try {
      const raw = await readFile(this.queuePath(), "utf8");
      const arr = JSON.parse(raw) as Action[];
      // Repair zombie "running" actions left over from a prior process.
      return arr.map((a) =>
        a.status === "running" ? { ...a, status: "queued" as const, startedAt: undefined } : a,
      );
    } catch {
      return [];
    }
  }

  async saveQueue(snap: Action[]): Promise<void> {
    await this.ensureDir();
    await writeFile(this.queuePath(), JSON.stringify(snap, null, 2), { mode: 0o600 });
  }

  async appendLog(entry: LogEntry): Promise<void> {
    await this.ensureDir();
    await writeFile(this.logPath(), JSON.stringify(entry) + "\n", { flag: "a", mode: 0o600 });
  }
}
