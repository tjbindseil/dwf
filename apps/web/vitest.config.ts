import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      enabled: false,
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts", "src/main.tsx", "test/**", "dist/**"],
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
