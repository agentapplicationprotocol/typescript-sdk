import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    alias: {
      "@agentapplicationprotocol/core": path.resolve(__dirname, "../core/src/index.ts"),
    },
  },
});
