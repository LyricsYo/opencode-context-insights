import type { SessionMessageInfo } from "@opencode/client"
import { buildToolScan } from "./files.ts"

export type CommandStatus = "running" | "completed" | "failed" | "killed"
export type CommandFilter = "all" | "failed" | "slow" | "background"
export type CommandSort = "latest" | "slowest"

export const SLOW_COMMAND_MS = 10_000

export interface CommandRow {
  readonly id: string
  readonly messageID: string
  readonly at: number
  readonly command: string
  /** First line with a redundant `cd <workspace> &&` prefix removed. */
  readonly preview: string
  readonly description?: string
  readonly workdir?: string
  readonly tool: string
  readonly nested: boolean
  readonly status: CommandStatus
  readonly exit?: number
  readonly duration?: number
  readonly background: boolean
  readonly truncated: boolean
  readonly timeoutMs?: number
  readonly program: string
  readonly programs: readonly string[]
  readonly lines: number
  readonly heredoc: boolean
  readonly inline: boolean
  readonly output: string
  readonly outChars: number
  readonly outLines: number
}

export interface CommandSummary {
  readonly runs: number
  readonly failed: number
  readonly totalMs: number
  readonly background: number
  readonly programs: ReadonlyArray<{ readonly name: string; readonly count: number }>
  readonly slowest?: { readonly command: string; readonly preview: string; readonly ms: number }
  readonly failing?: { readonly program: string; readonly count: number }
  readonly repeats?: { readonly command: string; readonly preview: string; readonly count: number }
}

export function buildCommands(messages: readonly SessionMessageInfo[], workspace?: string): CommandRow[] {
  return buildToolScan(messages, workspace).commands
}

export function summarizeCommands(rows: readonly CommandRow[]): CommandSummary {
  const programCounts = new Map<string, number>()
  const failByProgram = new Map<string, number>()
  const repeats = new Map<string, { command: string; preview: string; count: number }>()
  let runs = 0
  let failed = 0
  let totalMs = 0
  let background = 0
  let slowest: CommandSummary["slowest"]
  for (const row of rows) {
    if (row.background) background += 1
    for (const name of row.programs) programCounts.set(name, (programCounts.get(name) ?? 0) + 1)
    if (row.status === "running") continue
    runs += 1
    if (row.status === "failed") failed += 1
    totalMs += row.duration ?? 0
    const duration = row.duration ?? 0
    if (duration >= 1000 && (slowest === undefined || duration > slowest.ms)) {
      slowest = { command: row.command, preview: row.preview, ms: duration }
    }
    if (row.status === "failed") {
      for (const name of row.programs) failByProgram.set(name, (failByProgram.get(name) ?? 0) + 1)
    }
    const repeat = repeats.get(row.command)
    if (repeat === undefined) repeats.set(row.command, { command: row.command, preview: row.preview, count: 1 })
    else repeat.count += 1
  }
  let failing: CommandSummary["failing"]
  for (const [program, count] of failByProgram) {
    if (failing === undefined || count > failing.count) failing = { program, count }
  }
  let topRepeat: CommandSummary["repeats"]
  for (const entry of repeats.values()) {
    if (entry.count >= 2 && (topRepeat === undefined || entry.count > topRepeat.count)) topRepeat = entry
  }
  return {
    runs,
    failed,
    totalMs,
    background,
    programs: [...programCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name)),
    slowest,
    failing,
    repeats: topRepeat,
  }
}

