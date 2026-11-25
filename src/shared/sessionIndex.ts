import type { SessionMessageInfo } from "@opencode/client"
import { CATEGORY_ORDER, estimateTokens } from "./estimate.ts"
import { headerAt, type HeaderSummary } from "./header.ts"
import type { CommandRow } from "./commands.ts"
import type { EventKind } from "./events.ts"
import { cachedToolScanOf, type FileOpRow, type ToolScan } from "./files.ts"
import { measureAssistant, stepTimingRowOf, type StepTimingRow } from "./timing.ts"
import type { StepRow } from "./steps.ts"
import { toolRowsOf, type TokenScan, type TokenStepRow, type ToolRow } from "./tokens.ts"
import { userSurface } from "./surface.ts"
import { addText, contentText, emptyCategories, excludedWaitOf, isQuestionTool, objectOf, questionWaitOf, skillToolOf, sumCategories, textOf, type JsonRecord } from "./reportInternal.ts"
import { attachmentTokensOfMessage } from "./messageImages.ts"

export function buildTools(messages: readonly SessionMessageInfo[]): ToolRow[] {
  return buildTokenScan(messages, []).tools
}
export interface SessionIndexOptions {
  /** Collect command and file rows for this workspace. */
  readonly tools?: boolean
  readonly workspace?: string
  /** Collect per-step timing rows for the charts. */
  readonly timing?: boolean
}

export interface SessionIndex {
  readonly steps: StepRow[]
  readonly scan: TokenScan
  /** User messages, including turns that produced no completed step. */
  readonly turnCount: number
  readonly eventCounts: Record<EventKind, number>
  readonly eventTotal: number
  readonly toolScan?: ToolScan
  readonly stepTiming?: StepTimingRow[]
}

/** Steps, per-step composition, generated mix, tool stats and event counts in one walk. */
export function buildSessionIndex(
  messages: readonly SessionMessageInfo[],
  headers: readonly HeaderSummary[],
  options?: SessionIndexOptions,
): SessionIndex {
  const steps: StepRow[] = []
  const rows: TokenStepRow[] = []
  const stepTiming: StepTimingRow[] | undefined = options?.timing === true ? [] : undefined
  const commands: CommandRow[] | undefined = options?.tools === true ? [] : undefined
  const files: FileOpRow[] | undefined = options?.tools === true ? [] : undefined
  const eventCounts: Record<EventKind, number> = {
    inject: 0,
    skill: 0,
    compaction: 0,
    model: 0,
    agent: 0,
    error: 0,
  }
  let eventTotal = 0
  const countEvent = (kind: EventKind) => {
    eventCounts[kind] += 1
    eventTotal += 1
  }
  const byCategory = emptyCategories()
  const generated = { reasoning: 0, answers: 0, calls: 0 }
  const toolEntries = new Map<string, { calls: number; failed: number; unfinished: number; durations: number[] }>()
  let turn = 0
  let step = 0
  let compacted = false
  for (const message of messages) {
    if (message.type === "user") {
      turn += 1
      step = 0
      const surface = userSurface(message.text)
      const category = surface.kind === "skill" ? "skills" : surface.kind === "synthetic" ? "injected" : "user"
      addText(byCategory, category, message.text)
      byCategory[category] += attachmentTokensOfMessage(message)
      continue
    }
    if (message.type === "system" || message.type === "synthetic") {
      addText(byCategory, "injected", message.text)
      countEvent("inject")
      continue
    }
    if (message.type === "skill") {
      addText(byCategory, "skills", message.text)
      countEvent("skill")
      continue
    }
    if (message.type === "compaction") {
      countEvent("compaction")
      if (message.status === "completed") {
        for (const category of CATEGORY_ORDER) byCategory[category] = 0
        addText(byCategory, "injected", message.summary)
        compacted = true
      }
      continue
    }
    if (message.type === "model-switched") {
      countEvent("model")
      continue
    }
    if (message.type === "agent-switched") {
      countEvent("agent")
      continue
    }
    if (message.type === "idle") {
      if (message.outcome !== "succeeded") countEvent("error")
      continue
    }
    if (message.type !== "assistant") continue
    if (message.tokens) {
      step += 1
      const tokens = message.tokens
      const ended = message.time.completed ?? message.time.streamed
      steps.push({
        id: message.id,
        at: message.time.created,
        turn,
        step,
        prompt: tokens.input + tokens.cache.read + tokens.cache.write,
        output: tokens.output,
        reasoning: tokens.reasoning,
        cacheRead: tokens.cache.read,
        cacheWrite: tokens.cache.write,
        cost: message.cost ?? 0,
        duration: ended === undefined ? undefined : Math.max(0, ended - message.time.created),
        model: message.model?.id,
        agent: message.agent,
        afterCompaction: compacted,
      })
      const version = headerAt(headers, message.time.created)
      const snapshot = { ...byCategory }
      if (version !== undefined) {
        snapshot.system = version.system.reduce((sum, part) => sum + part.tokens, 0)
        snapshot.tools = version.tools.reduce((sum, tool) => sum + tool.tokens, 0)
      }
      const rawDuration = ended === undefined ? undefined : ended - message.time.created
      const question = rawDuration === undefined ? 0 : Math.min(rawDuration, questionWaitOf(message))
      const excluded = rawDuration === undefined ? 0 : Math.min(rawDuration, excludedWaitOf(message))
      const delegation = Math.max(0, excluded - question)
      rows.push({
        id: message.id,
        at: message.time.created,
        turn,
        step,
        prompt: tokens.input + tokens.cache.read + tokens.cache.write,
        output: tokens.output + tokens.reasoning,
        duration: rawDuration === undefined ? undefined : Math.max(0, rawDuration - excluded),
        wait: question,
        delegation,
        total: sumCategories(snapshot),
        byCategory: snapshot,
        headerMissing: version === undefined,
        afterCompaction: compacted,
      })
      compacted = false
      if (stepTiming !== undefined) {
        const measure = measureAssistant(message)
        stepTiming.push(stepTimingRowOf(message, measure, turn, step))
      }
    }
    for (const part of message.content) {
      if (part.type === "text") {
        const tokens = estimateTokens(part.text)
        byCategory.assistant += tokens
        generated.answers += tokens
      } else if (part.type === "reasoning") {
        const tokens = estimateTokens(part.text)
        byCategory.reasoning += tokens
        generated.reasoning += tokens
      } else if (part.type === "tool") {
        if (part.name !== "skill") {
          const entry = toolEntries.get(part.name) ?? { calls: 0, failed: 0, unfinished: 0, durations: [] }
          entry.calls += 1
          if (part.state.status === "error") entry.failed += 1
          else if (part.state.status !== "completed") entry.unfinished += 1
          const started = part.time.ran ?? part.time.created
          if (part.time.completed !== undefined && !isQuestionTool(part.name)) {
            entry.durations.push(Math.max(0, part.time.completed - started))
          }
          toolEntries.set(part.name, entry)
        }
        const state = part.state as unknown as JsonRecord
        const calls = estimateTokens(`${part.name} ${textOf(state.input)}`)
        generated.calls += calls
        const skill = skillToolOf(part)
        if (skill !== undefined) {
          addText(byCategory, "skills", skill.text)
          countEvent("skill")
        } else {
          const error = objectOf(state.error)
          const output = contentText(state.content) || String(error?.message ?? "")
          byCategory.toolCalls += calls
          byCategory.toolResults += estimateTokens(output)
        }
      }
    }
    if (commands !== undefined && files !== undefined) {
      const scan = cachedToolScanOf(message, options?.workspace)
      for (const row of scan.commands) commands.push(row)
      for (const row of scan.files) files.push(row)
    }
  }
  return {
    steps,
    scan: { steps: rows, generated, tools: toolRowsOf(toolEntries) },
    turnCount: turn,
    eventCounts,
    eventTotal,
    ...(stepTiming !== undefined ? { stepTiming } : {}),
    ...(commands !== undefined && files !== undefined ? { toolScan: { commands, files } } : {}),
  }
}

/** Per-step composition, the generated mix and tool stats, accumulated in one walk. */
export function buildTokenScan(
  messages: readonly SessionMessageInfo[],
  headers: readonly HeaderSummary[],
): TokenScan {
  return buildSessionIndex(messages, headers).scan
}

export function buildTokenSteps(
  messages: readonly SessionMessageInfo[],
  headers: readonly HeaderSummary[],
): TokenStepRow[] {
  return buildTokenScan(messages, headers).steps
}
