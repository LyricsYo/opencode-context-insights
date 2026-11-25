import { build } from "esbuild"

/**
 * The host half of the plugin is loaded by OpenCode's server from `node_modules`, where Node
 * refuses to strip TypeScript. Ship it compiled; `@opencode/plugin` stays external so the
 * plugin shares the host's runtime instance.
 */
await build({
  entryPoints: { index: "src/index.ts", rpc: "src/shared/rpc.ts" },
  outdir: "dist",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  external: ["@opencode/plugin", "@opencode/plugin/*", "@opencode/client", "effect", "effect/*"],
  logLevel: "info",
})
