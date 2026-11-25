import { readFileSync } from "node:fs"
import { defineConfig, type Plugin } from "vite"
import { gui } from "@opencode/plugin/gui/vite"

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { name: string; version: string }

function buildBanner(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")
  const built = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  return `/* ${pkg.name} v${pkg.version} · built ${built} */\n`
}

/** The bundle is hand-copied into Desktop; the banner says which build is running. */
function banner(): Plugin {
  return {
    name: "context-banner",
    enforce: "post",
    generateBundle(_options, bundle) {
      const header = buildBanner()
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === "chunk") chunk.code = header + chunk.code
      }
    },
  }
}

export default defineConfig({
  plugins: [gui({ entry: "src/client/index.tsx" }), banner()],
})
