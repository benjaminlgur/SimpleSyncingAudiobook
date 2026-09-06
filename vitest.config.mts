import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts", "packages/**/*.test.ts", "apps/**/*.test.ts", "apps/**/*.test.tsx"],
  },
  resolve: {
    alias: { "@audiobook/shared": fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)) },
  },
});
