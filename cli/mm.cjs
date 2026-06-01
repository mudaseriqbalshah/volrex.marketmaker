#!/usr/bin/env node
// Tiny CommonJS wrapper that runs the TypeScript CLI through the
// locally-installed `tsx`. node by itself can't run `.ts` files (and
// the bare imports like `./config` need a TS-aware resolver) — `tsx`
// handles both transparently.
//
// This file is the `bin` target in package.json so `npx mm` works
// regardless of how node is configured on the host system.

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const tsxBin = path.join(
  projectRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsx.cmd" : "tsx",
);
const mmTs = path.join(__dirname, "mm.ts");

const result = spawnSync(tsxBin, [mmTs, ...process.argv.slice(2)], {
  stdio: "inherit",
});

if (result.error && result.error.code === "ENOENT") {
  console.error("tsx not found. Did you run `npm install` in the project root?");
  process.exit(1);
}
process.exit(result.status ?? 0);
