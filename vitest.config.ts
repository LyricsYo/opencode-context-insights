import { defineConfig } from "vitest/config"
import solid from "vite-plugin-solid"

// Specs import src/ directly, never dist/, so the suite needs no build step.
export default defineConfig({
  test: {
    reporters: ["dot"],
    projects: [
      {
        test: {
          name: "node",
          include: ["tests/shared/**/*.spec.ts", "tests/host/**/*.spec.ts"],
          environment: "node",
        },
      },
      {
        // Components read the app's Solid context and DOM APIs, so they mount in jsdom.
        plugins: [solid()],
        resolve: { conditions: ["development", "browser"] },
        test: {
          name: "client",
          include: ["tests/client/**/*.spec.ts", "tests/client/**/*.spec.tsx"],
          environment: "jsdom",
          css: true,
          setupFiles: ["tests/client/setup.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["src/**/*.d.ts"],
      reporter: [
        ["text", { skipFull: true }],
        "html",
      ],
      reportsDirectory: "./coverage",
      // Every shipped file carries tests for all of its statements, branches and functions.
      thresholds: {
        perFile: true,
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
})
