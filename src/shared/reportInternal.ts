import type { SessionMessageInfo } from "@opencode/client"
import { CATEGORY_ORDER, estimateTokens, type Category } from "./estimate.ts"

export type JsonRecord = Record<string, unknown>

export function objectOf(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null ? (value as JsonRecord) : undefined
}

export function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

export function contentText(value: unknown): string {
  if (!Array.isArray(value)) return ""
  const parts: string[] = []
  for (const raw of value) {
    const part = objectOf(raw)
    if (!part) continue
    if (part.type === "text" && typeof part.text === "string") parts.push(part.text)
    else if (part.type === "file") parts.push(`[file] ${stringOf(part.name) ?? stringOf(part.uri) ?? ""}`)
  }
  return parts.join("\n")
}

export function lineCount(value: string): number {
  if (value === "") return 0
  const lines = value.split(/\r\n|\r|\n/)
  // A trailing newline ends the last line; it does not open an empty one.
  if (lines[lines.length - 1] === "") lines.pop()
  return lines.length
}

export function baseToolName(name: string): string {
  return name.slice(name.lastIndexOf(".") + 1)
}

/** Question calls block on the user, so their duration is not tool work. */
export function isQuestionTool(name: string): boolean {
  return baseToolName(name) === "question"
}

/** Delegated agents run in their own session; waiting for one is not parent work. */
const DELEGATION_TOOLS = new Set(["subagent", "task"])
export function isDelegationTool(name: string): boolean {
  return DELEGATION_TOOLS.has(baseToolName(name))
}

export function emptyCategories(): Record<Category, number> {
  return Object.fromEntries(CATEGORY_ORDER.map((category) => [category, 0])) as Record<Category, number>
}

export function sumCategories(byCategory: Record<Category, number>): number {
  return CATEGORY_ORDER.reduce((sum, category) => sum + byCategory[category], 0)
}

export function textOf(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value ?? {})
  } catch {
    return String(value)
  }
}

/** OpenCode exposes skill injections as `skill` tool calls, not as skill messages. */
export function skillToolOf(part: unknown): { name: string; text: string } | undefined {
  const tool = objectOf(part)
  if (tool?.type !== "tool" || tool.name !== "skill") return undefined
  const state = objectOf(tool.state)
  if (state === undefined) return undefined
  const text = contentText(state.content) || String(objectOf(state.error)?.message ?? "")
  const metadata = objectOf(state.metadata)
  const input = objectOf(state.input)
  const name = stringOf(metadata?.name) ?? stringOf(input?.id) ?? "skill"
  return { name, text }
}

export function addText(byCategory: Record<Category, number>, category: Category, text: string): void {
  byCategory[category] += estimateTokens(text)
}

/** Estimated composition of one request, with system and tool definitions from the stored header. */
function waitIntervalsOf(
  message: SessionMessageInfo,
  match: (name: string) => boolean,
): Array<{ start: number; end: number }> {
  if (message.type !== "assistant") return []
  const started = message.time.created
  const ended = message.time.completed ?? message.time.streamed
  if (ended === undefined) return []
  const intervals: Array<{ start: number; end: number }> = []
  for (const part of message.content) {
    if (part.type !== "tool" || !match(part.name)) continue
    if (part.time.completed === undefined) continue
    const start = Math.max(started, part.time.ran ?? part.time.created)
    const end = Math.min(ended, part.time.completed)
    if (end > start) intervals.push({ start, end })
  }
  return intervals
}

/** Time a question tool waited for the user. */
export function questionWaitOf(message: SessionMessageInfo): number {
  return unionMs(waitIntervalsOf(message, isQuestionTool))
}

/** Time a step waited for a delegated subagent. */
export function delegationWaitOf(message: SessionMessageInfo): number {
  return unionMs(waitIntervalsOf(message, isDelegationTool))
}

/** Both waits are excluded from active time; an overlapping interval counts once. */
export function excludedWaitOf(message: SessionMessageInfo): number {
  return unionMs(waitIntervalsOf(message, (name) => isQuestionTool(name) || isDelegationTool(name)))
}
export function unionMs(intervals: ReadonlyArray<{ readonly start: number; readonly end: number }>): number {
  const sorted = [...intervals].sort((left, right) => left.start - right.start)
  let total = 0
  let cursor = -1
  for (const interval of sorted) {
    const from = Math.max(interval.start, cursor)
    if (interval.end > from) total += interval.end - from
    cursor = Math.max(cursor, interval.end)
  }
  return total
}
