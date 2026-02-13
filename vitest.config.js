import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/*.spec.js",          // exclude Playwright spec files
      "**/playwright-report/**",
      "**/test-results/**",
    ],
  },
});
