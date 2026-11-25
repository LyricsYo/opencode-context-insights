import type { SessionInfo, SessionMessageInfo } from "@opencode/client"
import { estimateTokens } from "./estimate.ts"

export interface StepRow {
  readonly id: string
  readonly at: number
  /** 1-based user turn; 0 for a step before any user message. */
  readonly turn: number
  /** 1-based step within its turn. */
  readonly step: number
  readonly prompt: number
  readonly output: number
  readonly reasoning: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly cost: number
  readonly duration?: number
  readonly model?: string
  readonly agent: string
  readonly afterCompaction: boolean
}

/** Provider-reported steps, oldest first. */
export function buildSteps(messages: readonly SessionMessageInfo[]): StepRow[] {
  const rows: StepRow[] = []
  let compacted = false
  let turn = 0
  let step = 0
  for (const message of messages) {
    if (message.type === "user") {
      turn += 1
      step = 0
      continue
    }
    if (message.type === "compaction" && message.status === "completed") {
      compacted = true
      continue
    }
    if (message.type !== "assistant" || !message.tokens) continue
    const tokens = message.tokens
    const ended = message.time.completed ?? message.time.streamed
    step += 1
    rows.push({
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
    compacted = false
  }
  return rows
}

export interface TurnRow {
  readonly id: string
  readonly turn: number
  readonly at: number
  /** Prompt size at the turn's last step. */
  readonly prompt: number
  readonly output: number
  readonly cost: number
  readonly duration: number
  readonly steps: number
}

/** Steps grouped by user turn. */
export function buildTurns(steps: readonly StepRow[]): TurnRow[] {
  const turns = new Map<number, StepRow[]>()
  for (const step of steps) {
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
        turn,
        at: list[0].at,
        prompt: last.prompt,
        output: list.reduce((sum, row) => sum + row.output, 0),
        cost: list.reduce((sum, row) => sum + row.cost, 0),
        duration: list.reduce((sum, row) => sum + (row.duration ?? 0), 0),
        steps: list.length,
      }
    })
}

export interface WindowStats {
  readonly latest: number
  readonly peak: number
  readonly average: number
  /** Average prompt growth between consecutive steps; skips the step after a compaction. */
  readonly growth: number
  readonly stepsToLimit?: number
}

export function windowStats(steps: readonly StepRow[], limit?: number): WindowStats {
  if (steps.length === 0) return { latest: 0, peak: 0, average: 0, growth: 0 }
  const prompts = steps.map((step) => step.prompt)
  const latest = prompts[prompts.length - 1]
  const peak = Math.max(...prompts)
  const average = Math.round(prompts.reduce((sum, value) => sum + value, 0) / prompts.length)
  const deltas: number[] = []
  for (let index = 1; index < prompts.length; index++) {
    if (!steps[index].afterCompaction) deltas.push(prompts[index] - prompts[index - 1])
  }
  const growth = deltas.length > 0 ? Math.round(deltas.reduce((sum, value) => sum + value, 0) / deltas.length) : 0
  const stepsToLimit =
    limit !== undefined && growth > 0 && latest < limit ? Math.max(1, Math.ceil((limit - latest) / growth)) : undefined
  return { latest, peak, average, growth, stepsToLimit }
}

export interface CompactionTrigger {
  /** Prompt tokens at which auto-compaction starts. */
  readonly at: number
  /** Window tokens kept free before the limit. */
  readonly buffer: number
  readonly auto: boolean
}

/**
 * Auto-compaction starts at `limit - buffer`. `buffer` is a share of the
 * window (default 15%) and at least 16k tokens when the window is larger than
 * that; a smaller window uses the share so the trigger never collapses to 0.
 * A token count is used as-is unless it is at least the window, in which case
 * the default applies.
 */
export function compactionTrigger(
  limit: number | undefined,
  options?: { readonly auto?: boolean; readonly buffer?: string | number },
): CompactionTrigger | undefined {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return undefined
  const configured = options?.buffer
  let buffer: number
  if (typeof configured === "number" && Number.isFinite(configured) && configured > 0 && configured < limit) {
    buffer = configured
  } else {
    const percent = typeof configured === "string" ? Number.parseFloat(configured) : Number.NaN
    const share = Number.isFinite(percent) && percent >= 1 && percent <= 99 ? percent / 100 : 0.15
    // The 16k floor only applies when the window can hold it; a tiny window gets a share, not a zero trigger.
    buffer = limit > 16_000 ? Math.max(16_000, limit * share) : limit * share
  }
  return { at: Math.max(0, limit - buffer), buffer, auto: options?.auto !== false }
}

export interface CompactionRow {
  readonly id: string
  readonly at: number
  readonly reason: string
  readonly summary: number
  readonly before?: number
  readonly after?: number
  readonly reclaimed?: number
  /** The first request that carries the post-compaction context. */
  readonly stepID?: string
}

export function buildCompactions(messages: readonly SessionMessageInfo[]): CompactionRow[] {
  const prompts: Array<{ at: number; prompt: number }> = []
  for (const message of messages) {
    if (message.type !== "assistant" || !message.tokens) continue
    prompts.push({
      at: message.time.created,
      prompt: message.tokens.input + message.tokens.cache.read + message.tokens.cache.write,
    })
  }
  const rows: CompactionRow[] = []
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]
    if (message.type !== "compaction" || message.status !== "completed") continue
    const before = prompts.filter((entry) => entry.at < message.time.created).at(-1)?.prompt
    const after = prompts.find((entry) => entry.at >= message.time.created)?.prompt
    let stepID: string | undefined
    for (let next = index + 1; next < messages.length; next++) {
      const item = messages[next]
      if (item.type === "assistant" && item.tokens) {
        stepID = item.id
        break
      }
    }
    rows.push({
      id: message.id,
      at: message.time.created,
      reason: message.reason,
      summary: estimateTokens(message.summary),
      before,
      after,
      reclaimed: before !== undefined && after !== undefined ? before - after : undefined,
      stepID,
    })
  }
  return rows
}

export interface ChildRow {
  readonly id: string
  readonly title: string
  readonly agent?: string
  readonly model?: string
  readonly cost: number
  readonly prompt: number
  /** Completion tokens, including reasoning. */
  readonly output: number
}

/** Sessions a session spawned, usually subagents, oldest first. */
export function buildChildren(sessions: readonly SessionInfo[], parentID: string): ChildRow[] {
  return sessions
    // Archived children stay out of the active list, matching the fleet tree.
    .filter((session) => session.parentID === parentID && session.time.archived === undefined)
    .sort((left, right) => left.time.created - right.time.created)
    .map((session) => ({
      id: session.id,
      title: session.title ?? session.id,
      agent: session.agent,
      model: session.model?.id,
      cost: session.cost,
      prompt: session.tokens.input + session.tokens.cache.read + session.tokens.cache.write,
      output: session.tokens.output + session.tokens.reasoning,
    }))
}
