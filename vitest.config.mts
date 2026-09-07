import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts", "packages/**/*.test.ts", "packages/**/*.test.tsx", "apps/**/*.test.ts", "apps/**/*.test.tsx"],
  },
  resolve: {
    alias: [
      { find: "@audiobook/shared/react", replacement: fileURLToPath(new URL("./packages/shared/src/react.ts", import.meta.url)) },
      { find: /^@audiobook\/shared$/, replacement: fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)) },
    ],
  },
});
