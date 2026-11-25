import { estimateTokens } from "./estimate.ts"

export interface HeaderPart {
  readonly key: string
  readonly text: string
}

export interface HeaderTool {
  readonly name: string
  readonly description: string
  readonly schema: string
  /** Best-effort origin: `core`, `mcp:<server>`, or a tool namespace prefix. */
  readonly source?: string
}

export interface HeaderSummary {
  readonly at: number
  readonly systemHash: string
  readonly toolsHash: string
  readonly system: ReadonlyArray<{ readonly key: string; readonly tokens: number }>
  readonly tools: ReadonlyArray<{ readonly name: string; readonly tokens: number }>
}

export interface HeaderDetail {
  readonly summary: HeaderSummary
  readonly system: readonly HeaderPart[]
  readonly tools: readonly HeaderTool[]
}

interface SystemPartLike {
  readonly text?: unknown
  readonly metadata?: unknown
}

interface ToolLike {
  readonly description?: unknown
  readonly input?: unknown
}

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

/** Splits the system prompt into its instruction sources when the host reports them. */
export function systemPartsOf(system: readonly SystemPartLike[]): HeaderPart[] {
  const parts: HeaderPart[] = []
  for (const part of system) {
    const metadata = objectOf(part.metadata)
    const experimental = objectOf(metadata?.experimental)
    const instructions = experimental?.instructions
    if (Array.isArray(instructions) && instructions.length > 0) {
      for (const raw of instructions) {
        const entry = objectOf(raw)
        const key = typeof entry?.key === "string" && entry.key !== "" ? entry.key : "instructions"
        const text = typeof entry?.text === "string" ? entry.text : ""
        if (text.trim() !== "") parts.push({ key, text })
      }
      continue
    }
    const text = typeof part.text === "string" ? part.text : ""
    if (text.trim() !== "") parts.push({ key: "system", text })
  }
  return parts
}

export function toolsOf(tools: Record<string, ToolLike>): HeaderTool[] {
  return Object.entries(tools)
    .map(([name, tool]) => ({
      name,
      description: typeof tool.description === "string" ? tool.description : "",
      schema: JSON.stringify(tool.input ?? {}, null, 1),
      source: toolSourceOf(name),
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

const CORE_TOOLS = new Set([
  "read",
  "write",
  "edit",
  "patch",
  "glob",
  "grep",
  "shell",
  "bash",
  "sh",
  "terminal",
  "exec",
  "execute",
  "skill",
  "question",
  "todo",
  "webfetch",
  "websearch",
  "task",
  "subagent",
  "artifact",
  "schedule",
  "image-generate",
  "image_generate",
])

/** The request payload carries no tool source, so infer the common naming conventions. */
export function toolSourceOf(name: string): string | undefined {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name) ?? /^mcp__(.+)$/.exec(name)
  if (mcp !== null) return `mcp:${mcp[1]}`
  if (CORE_TOOLS.has(name)) return "core"
  const dot = name.indexOf(".")
  if (dot > 0) return name.slice(0, dot)
  // Plugin tool namespaces become `<namespace>_<tool>` in the effective name.
  const underscore = name.indexOf("_")
  if (underscore > 0) return name.slice(0, underscore)
  return undefined
}

export function summarizeHeader(
  at: number,
  systemHash: string,
  toolsHash: string,
  system: readonly HeaderPart[],
  tools: readonly HeaderTool[],
): HeaderSummary {
  return {
    at,
    systemHash,
    toolsHash,
    system: system.map((part) => ({ key: part.key, tokens: estimateTokens(part.text) })),
    tools: tools.map((tool) => ({
      name: tool.name,
      tokens: estimateTokens(`${tool.name} ${tool.description} ${tool.schema}`),
    })),
  }
}

/** Latest snapshot at or before a step start; the step time is stamped a few ms before its request hook. */
export function headerAt(versions: readonly HeaderSummary[], at: number): HeaderSummary | undefined {
  const slack = 250
  let chosen: HeaderSummary | undefined
  for (const version of versions) {
    if (version.at <= at + slack) chosen = version
  }
  return chosen
}
