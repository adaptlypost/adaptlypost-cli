import { defineConfig } from "vitest/config";

export default defineConfig({
  define: { __CLI_VERSION__: JSON.stringify("0.0.0-test") },
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});
