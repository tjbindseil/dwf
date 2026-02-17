import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      enabled: false,
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "test/**", "dist/**"],
      reporter: ["text-summary", "json-summary", "html", "lcov"],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60,
        perFile: false,
      },
    },
  },
});
