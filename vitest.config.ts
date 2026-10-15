import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    env: loadEnv("test", process.cwd(), ""),
    testTimeout: 120_000,
    hookTimeout: 60_000,
    // Acceptance tests share one test database, so files must not run in parallel.
    fileParallelism: false,
  },
});
