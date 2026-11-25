import type { SessionMessageInfo } from "@opencode/client"
import { CATEGORY_ORDER, clip, estimateTokens, type Category, type Item } from "./estimate.ts"
import type { HeaderDetail } from "./header.ts"
import { emptyCategories, sumCategories, textOf, type JsonRecord } from "./reportInternal.ts"
import { buildSurface, isToolEntry } from "./surface.ts"

export interface ToolRow {
  readonly name: string
  readonly calls: number
  readonly failed: number
  readonly unfinished: number
  /** Median run time of the calls that reported one. */
  readonly p50?: number
  /** Total run time of the calls that reported one. */
  readonly total: number
}
export function toolRowsOf(
  entries: Map<string, { calls: number; failed: number; unfinished: number; durations: number[] }>,
): ToolRow[] {
  return [...entries.entries()]
    .map(([name, entry]) => ({
      name,
      calls: entry.calls,
      failed: entry.failed,
      unfinished: entry.unfinished,
      p50: median(entry.durations),
      total: entry.durations.reduce((sum, value) => sum + value, 0),
    }))
    .sort((left, right) => right.calls - left.calls || left.name.localeCompare(right.name))
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
export interface StepComposition {
  readonly total: number
  readonly byCategory: Record<Category, number>
  readonly items: readonly Item[]
  readonly prompt?: number
  /** Header list is still loading. */
  readonly headerPending: boolean
  /** No system/tools snapshot exists for this step. */
  readonly headerMissing: boolean
}

export function stepComposition(
  messages: readonly SessionMessageInfo[],
  stepID: string | undefined,
  header: HeaderDetail | null | undefined,
): StepComposition {
  const byCategory = emptyCategories()
  const items: Item[] = []
  const add = (category: Category, name: string, tokens: number) => {
    if (tokens <= 0) return
    byCategory[category] += tokens
    if (items.length < 400) items.push({ category, name: clip(name), tokens })
  }

  if (header?.summary) {
    for (const part of header.summary.system) add("system", `System · ${part.key}`, part.tokens)
    for (const tool of header.summary.tools) add("tools", tool.name, tool.tokens)
  }

  const surface = stepID === undefined ? buildSurface(messages) : buildSurface(messages, stepID, false)
  for (const entry of surface) {
    if (isToolEntry(entry)) {
      add("toolCalls", entry.name, entry.callTokens)
      add("toolResults", entry.name, entry.resultTokens)
      continue
    }
    if (entry.kind === "user") add("user", entry.name, entry.tokens)
    else if (entry.kind === "skill") add("skills", entry.name, entry.tokens)
    else if (entry.kind === "reply") add("assistant", entry.name, entry.tokens)
    else if (entry.kind === "reasoning") add("reasoning", entry.name, entry.tokens)
    else add("injected", entry.name, entry.tokens)
  }

  let prompt: number | undefined
  if (stepID !== undefined) {
    const step = messages.find((message) => message.id === stepID)
    if (step?.type === "assistant" && step.tokens) prompt = step.tokens.input + step.tokens.cache.read + step.tokens.cache.write
  }

  return {
    total: sumCategories(byCategory),
    byCategory,
    items,
    prompt,
    headerPending: header === undefined,
    headerMissing: header === null,
  }
}

export interface TokenStepRow {
  readonly id: string
  readonly at: number
  readonly turn: number
  readonly step: number
  readonly prompt: number
  /** Completion tokens, including reasoning. */
  readonly output: number
  /** Active time: the step window minus question and subagent waits. */
  readonly duration?: number
  /** Time the step waited for the user to answer a question tool. */
  readonly wait: number
  /** Time the step waited for a delegated subagent; also excluded from duration. */
  readonly delegation: number
  readonly total: number
  readonly byCategory: Record<Category, number>
  readonly headerMissing: boolean
  readonly afterCompaction: boolean
}

/** Union of a step's question-tool waits, clipped to the step's own window. */
export interface TokenScan {
  readonly steps: TokenStepRow[]
  /** Estimated split of everything the model generated; shares the same text estimates. */
  readonly generated: GeneratedMix
  readonly tools: ToolRow[]
}

export interface TokenTurnRow {
  readonly id: string
  readonly at: number
  readonly turn: number
  readonly steps: number
  readonly prompt: number
  /** Completion tokens, including reasoning. */
  readonly output: number
  /** Sum of active step time; question and subagent waits are excluded. */
  readonly duration: number
  readonly wait: number
  readonly delegation: number
  readonly total: number
  readonly byCategory: Record<Category, number>
  readonly headerMissing: boolean
  readonly afterCompaction: boolean
}

/** A turn's size is its last step's composition; usage fields are summed. */
export function buildTokenTurns(steps: readonly TokenStepRow[]): TokenTurnRow[] {
  const turns = new Map<number, TokenStepRow[]>()
  for (const step of steps) {
    // Turn 0 is an assistant step before any user message; `buildTurns` drops it too.
    if (step.turn <= 0) continue
    const list = turns.get(step.turn)
    if (list) list.push(step)
    else turns.set(step.turn, [step])
  }
  return [...turns.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([turn, list]) => {
      const last = list[list.length - 1]
      return {
        id: last.id,
        at: list[0].at,
        turn,
        steps: list.length,
        prompt: last.prompt,
        output: list.reduce((sum, row) => sum + row.output, 0),
        duration: list.reduce((sum, row) => sum + (row.duration ?? 0), 0),
        wait: list.reduce((sum, row) => sum + row.wait, 0),
        delegation: list.reduce((sum, row) => sum + row.delegation, 0),
        total: last.total,
        byCategory: last.byCategory,
        headerMissing: last.headerMissing,
        afterCompaction: list[0].afterCompaction,
      }
    })
}

/** Signed category change between consecutive rows. */
export function categoryDeltas(
  rows: ReadonlyArray<{
    readonly byCategory: Record<Category, number>
    readonly headerMissing?: boolean
  }>,
): Record<Category, number>[] {
  return rows.map((row, index) => {
    const previous = index > 0 ? rows[index - 1] : undefined
    const headerUnknown = row.headerMissing === true || previous?.headerMissing === true
    return Object.fromEntries(
      CATEGORY_ORDER.map((category) => {
        if (headerUnknown && (category === "system" || category === "tools")) return [category, 0]
        return [category, row.byCategory[category] - (previous?.byCategory[category] ?? 0)]
      }),
    ) as Record<Category, number>
  })
}

export interface GeneratedMix {
  readonly reasoning: number
  readonly answers: number
  readonly calls: number
}

/** Estimated split of one assistant message, used for the streaming tail. */
export function generatedOfMessage(message: SessionMessageInfo | undefined): GeneratedMix {
  let reasoning = 0
  let answers = 0
  let calls = 0
  if (message?.type !== "assistant") return { reasoning, answers, calls }
  for (const part of message.content) {
    if (part.type === "reasoning") reasoning += estimateTokens(part.text)
    else if (part.type === "text") answers += estimateTokens(part.text)
    else if (part.type === "tool") {
      const state = part.state as unknown as JsonRecord
      calls += estimateTokens(`${part.name} ${textOf(state.input)}`)
    }
  }
  return { reasoning, answers, calls }
}

/** Estimated split of everything the model generated in the session. */
export function generatedMix(messages: readonly SessionMessageInfo[]): GeneratedMix {
  const mix = { reasoning: 0, answers: 0, calls: 0 }
  for (const message of messages) {
    if (message.type !== "assistant") continue
    const one = generatedOfMessage(message)
    mix.reasoning += one.reasoning
    mix.answers += one.answers
    mix.calls += one.calls
  }
  return mix
}

export interface SessionTokenStats {
  readonly total: number
  readonly input: number
  /** Completion tokens, including reasoning when the provider reports it separately. */
  readonly output: number
  /** Cache-read share of the prompt, in percent with two decimals. */
  readonly cacheHit?: number
  readonly byCategory: Record<Category, number>
}

/**
 * Session totals from provider usage, split by the current composition's
 * proportions and the generated reasoning/answer/tool-call mix. The split is
 * estimated; only the total and cache hit are provider numbers.
 */
export function sessionTokenStats(
  composition: { readonly byCategory: Record<Category, number> } | undefined,
  usage:
    | {
        readonly input: number
        readonly output: number
        readonly reasoning?: number
        readonly cache: { readonly read: number; readonly write: number }
      }
    | undefined,
  generated: GeneratedMix,
): SessionTokenStats | undefined {
  if (usage === undefined) return undefined
  const input = usage.input + usage.cache.read + usage.cache.write
  // Providers report reasoning apart from visible output; both are completion tokens.
  const output = usage.output + (usage.reasoning ?? 0)
  const total = input + output
  if (total <= 0) return undefined

  const byCategory = emptyCategories()
  const source = composition?.byCategory
  const sourceTotal = source === undefined ? 0 : sumCategories(source)
  if (source !== undefined && sourceTotal > 0 && input > 0) {
    for (const category of CATEGORY_ORDER) {
      byCategory[category] = Math.round((source[category] / sourceTotal) * input)
    }
  } else if (input > 0) {
    byCategory.injected = input
  }

  const genTotal = generated.reasoning + generated.answers + generated.calls
  if (output > 0) {
    if (genTotal > 0) {
      byCategory.reasoning += Math.round((generated.reasoning / genTotal) * output)
      byCategory.assistant += Math.round((generated.answers / genTotal) * output)
      byCategory.toolCalls += Math.round((generated.calls / genTotal) * output)
    } else {
      byCategory.assistant += output
    }
  }

  // Rounding above can leave a few tokens unassigned; put them on the largest part.
  const diff = total - sumCategories(byCategory)
  if (diff !== 0) {
    let largest: Category = "injected"
    for (const category of CATEGORY_ORDER) {
      if (byCategory[category] > byCategory[largest]) largest = category
    }
    byCategory[largest] = Math.max(0, byCategory[largest] + diff)
  }

  return {
    total,
    input,
    output,
    cacheHit: input > 0 ? Math.round((usage.cache.read / input) * 10000) / 100 : undefined,
    byCategory,
  }
}
