import type { Engine } from "../engine";

export async function runClear(engine: Engine): Promise<void> {
  const n = engine.queue.all().length;
  await engine.queue.clear();
  console.log(`Cleared ${n} action${n === 1 ? "" : "s"} from queue.`);
}
