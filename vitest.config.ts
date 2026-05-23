import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["**/*.{test,spec}.ts", "**/*.{test,spec}.tsx"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./") },
  },
});
