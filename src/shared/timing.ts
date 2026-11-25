import type { SessionMessageInfo } from "@opencode/client"
import { isDelegationTool, isQuestionTool, unionMs } from "./reportInternal.ts"

interface StepMeasure {
  /** Request start to the first token; undefined when no block time was stored. */
  readonly ttft?: number
  /** First token to the end of streaming. */
  readonly gen: number
  /** Provider-reported output plus reasoning tokens for the step. */
  readonly decoded: number
  /** Denominator for throughput: the decode window, or the request window for a batched burst. */
  readonly decode: number
  /** Measured generation split: reasoning block time. */
  readonly reasoning: number
  /** Measured generation split: answer text time (inferred from the remaining generation window). */
  readonly text: number
  /** Measured generation split: tool call setup time (`created` to `ran`). */
  readonly toolArgs: number
  readonly reasoningBlocks: number
  readonly textBlocks: number
  readonly toolArgBlocks: number
  /** Busy time with at least one non-question tool running. */
  readonly tool: number
  readonly toolCalls: number
  /** Time a question tool waited for the user, separate from real tool work. */
  readonly question: number
  /** Time a step waited for a delegated subagent, separate from real tool work. */
  readonly delegation: number
  readonly overhead: number
  readonly wall: number
}


/** Timing scans revisit every completed step; measure only messages whose timing fields moved. */
const stepMeasureCache = new Map<string, { key: string; value: StepMeasure }>()
/** The host keeps stable message objects in place; cache settled objects by identity to skip the key walk. */
const stepMeasureSettled = new WeakMap<SessionMessageInfo, { created: number; value: StepMeasure }>()
// shortcut: a step whose tools all completed cannot move again; late payload-only changes do not affect timing.

type AssistantMessage = Extract<SessionMessageInfo, { type: "assistant" }>

/**
 * `firstToken` is delivered by the server but is missing from the pinned client types; it is the
 * only honest start of the decode window, because a step whose whole output is a tool call has
 * no content block until streaming has already ended.
 */
type AssistantTime = { readonly firstToken?: number }

function measureStepKey(message: AssistantMessage): { key: string; settled: boolean } {
  const firstToken = (message.time as AssistantTime).firstToken
  let key = `${message.time.created}|${message.time.streamed ?? 0}|${firstToken ?? 0}|${message.time.completed ?? 0}|${message.content.length}`
  let settled = message.time.completed !== undefined
  for (const part of message.content) {
    const time = (part as { readonly time?: { readonly created?: number; readonly ran?: number; readonly completed?: number } }).time
    key += `|${part.type}:${time?.created ?? 0}:${time?.ran ?? 0}:${time?.completed ?? 0}`
    if (part.type === "tool") {
      key += `:${part.name}`
      if (time?.completed === undefined) settled = false
    }
  }
  return { key, settled }
}

export function measureStep(message: SessionMessageInfo): StepMeasure | undefined {
  return message.type === "assistant" ? measureAssistant(message) : undefined
}

/** The measurement of one assistant step; callers already know the message kind. */
export function measureAssistant(message: AssistantMessage): StepMeasure {
  const settled = stepMeasureSettled.get(message)
  if (settled !== undefined && settled.created === message.time.created && message.time.completed !== undefined) {
    return settled.value
  }
  const measured = measureStepKey(message)
  const cached = stepMeasureCache.get(message.id)
  if (cached !== undefined && cached.key === measured.key) {
    if (measured.settled) stepMeasureSettled.set(message, { created: message.time.created, value: cached.value })
    return cached.value
  }
  const value = measureStepUncached(message)
  stepMeasureCache.set(message.id, { key: measured.key, value })
  if (measured.settled) stepMeasureSettled.set(message, { created: message.time.created, value })
  if (stepMeasureCache.size > 4096) stepMeasureCache.delete(stepMeasureCache.keys().next().value as string)
  return value
}

function measureStepUncached(message: AssistantMessage): StepMeasure {
  const started = message.time.created
  const streamed = message.time.streamed
  let stepEnd = message.time.completed ?? streamed ?? started
  let first: number | undefined
  /** Latest moment a generated block was finished: reasoning end or tool-call args end. */
  let lastGeneration: number | undefined
  const toolIntervals: Array<{ start: number; end: number }> = []
  const questionIntervals: Array<{ start: number; end: number }> = []
  const delegationIntervals: Array<{ start: number; end: number }> = []
  let toolCalls = 0
  const blocks: Array<{ type: "reasoning" | "text" | "tool"; start?: number; end?: number }> = []
  for (const part of message.content) {
    if (part.type === "text") blocks.push({ type: "text" })
    const created = (part as { readonly time?: { readonly created?: number } }).time?.created
    if (created !== undefined && created >= started) {
      first = first === undefined ? created : Math.min(first, created)
      if (part.type === "reasoning") {
        const completed = (part as { readonly time?: { readonly completed?: number } }).time?.completed
        const end = completed !== undefined && completed >= started ? completed : created
        lastGeneration = lastGeneration === undefined ? end : Math.max(lastGeneration, end)
        blocks.push({ type: "reasoning", start: created, end: completed })
      } else if (part.type === "tool") {
        const ran = part.time.ran ?? created
        lastGeneration = lastGeneration === undefined ? ran : Math.max(lastGeneration, ran)
        blocks.push({ type: "tool", start: created, end: part.time.ran })
      }
    }
    if (part.type !== "tool") continue
    const ran = part.time.ran ?? part.time.created
    if (part.time.completed !== undefined && part.time.completed > ran) {
      const interval = { start: ran, end: part.time.completed }
      if (isQuestionTool(part.name)) questionIntervals.push(interval)
      else {
        if (isDelegationTool(part.name)) delegationIntervals.push(interval)
        else toolIntervals.push(interval)
        toolCalls += 1
      }
      stepEnd = Math.max(stepEnd, part.time.completed)
    }
  }
  const wall = Math.max(0, stepEnd - started)
  // shortcut: OpenCode reports when streaming ended, not when the first token
  // arrived; `firstToken` is the real marker and the first content block is the
  // fallback. Upgrade when the client types expose `firstToken`.
  const tokenAt = (message.time as AssistantTime).firstToken
  const tokenStart = tokenAt !== undefined && tokenAt >= started && tokenAt <= stepEnd ? tokenAt : undefined
  const firstAt = tokenStart ?? (first === undefined ? undefined : Math.min(first, streamed ?? first, stepEnd))
  const ttft = firstAt === undefined ? undefined : Math.min(wall, Math.max(0, firstAt - started))
  // Generation ends when streaming ends; a step without `streamed` ends at its last
  // generated block. `completed` is too late: it also covers tool execution.
  const genEnd = Math.min(stepEnd, streamed ?? lastGeneration ?? stepEnd)
  const gen = Math.min(
    Math.max(0, wall - (ttft ?? 0)),
    Math.max(0, genEnd - (firstAt ?? started)),
  )
  // Generation split, same categories as dsh-context: reasoning and tool-call
  // setup come from stored part times, answer text takes the rest of the window.
  let reasoning = 0
  let toolArgs = 0
  let reasoningBlocks = 0
  let textBlocks = 0
  let toolArgBlocks = 0
  for (const block of blocks) {
    if (block.type === "text") {
      textBlocks += 1
      continue
    }
    if (block.type === "reasoning") reasoningBlocks += 1
    else toolArgBlocks += 1
    if (block.start === undefined || block.end === undefined || firstAt === undefined) continue
    const from = Math.max(block.start, firstAt)
    const to = Math.min(block.end, genEnd)
    const span = Math.max(0, to - from)
    if (block.type === "reasoning") reasoning += span
    else toolArgs += span
  }
  reasoning = Math.min(reasoning, gen)
  toolArgs = Math.min(toolArgs, Math.max(0, gen - reasoning))
  const text = textBlocks > 0 ? Math.max(0, gen - reasoning - toolArgs) : 0
  // Question calls block on a person and delegation calls block on another agent;
  // both waits are excluded from active time. Their overlap is counted once.
  const wait = Math.min(
    unionMs([...questionIntervals, ...delegationIntervals]),
    Math.max(0, wall - (ttft ?? 0) - gen),
  )
  const question = Math.min(unionMs(questionIntervals), wait)
  const delegation = Math.max(0, wait - question)
  const busy = Math.min(unionMs(toolIntervals), Math.max(0, wall - (ttft ?? 0) - gen - wait))
  // Throughput uses the decode window only when it can physically hold the output.
  // A step that emitted 173 tokens in 5ms streamed them as one batch, so the
  // request window is the honest denominator instead of a rate of 34,600 tok/s.
  const decoded = (message.tokens?.output ?? 0) + (message.tokens?.reasoning ?? 0)
  const decode = gen > 0 && decoded <= gen ? gen : Math.max(0, wall - busy - question - delegation)
  return {
    ttft,
    gen,
    decoded,
    decode,
    reasoning,
    text,
    toolArgs,
    reasoningBlocks,
    textBlocks,
    toolArgBlocks,
    tool: busy,
    toolCalls,
    question,
    delegation,
    overhead: Math.max(0, wall - (ttft ?? 0) - gen - busy - question - delegation),
    wall,
  }
}

export interface StepTimingRow {
  readonly id: string
  readonly at: number
  readonly turn: number
  readonly step: number
  readonly ttft?: number
  readonly gen: number
  readonly reasoning: number
  readonly text: number
  readonly toolArgs: number
  readonly split: boolean
  /** Generation not covered by the three measured slices; shown inside overhead. */
  readonly genLeftover: number
  readonly reasoningBlocks: number
  readonly textBlocks: number
  readonly toolArgBlocks: number
  readonly tool: number
  readonly toolCalls: number
  readonly question: number
  /** Time the step waited for a delegated subagent; excluded from active time. */
  readonly delegation: number
  readonly overhead: number
  readonly wall: number
  readonly output: number
  /** Output plus reasoning tokens: what the decode window actually produced. */
  readonly decoded: number
  /** Throughput denominator: the decode window, or the request window for a batched burst. */
  readonly decode: number
  readonly rate: number
}

export function stepTimingRowOf(
  message: SessionMessageInfo,
  measure: StepMeasure,
  turn: number,
  step: number,
): StepTimingRow {
  const output = message.type === "assistant" && message.tokens ? message.tokens.output : 0
  return {
    id: message.id,
    at: message.time.created,
    turn,
    step,
    ttft: measure.ttft,
    gen: measure.gen,
    reasoning: measure.reasoning,
    text: measure.text,
    toolArgs: measure.toolArgs,
    split: measure.reasoning + measure.text + measure.toolArgs > 0,
    genLeftover: Math.max(0, measure.gen - measure.reasoning - measure.text - measure.toolArgs),
    reasoningBlocks: measure.reasoningBlocks,
    textBlocks: measure.textBlocks,
    toolArgBlocks: measure.toolArgBlocks,
    tool: measure.tool,
    toolCalls: measure.toolCalls,
    question: measure.question,
    delegation: measure.delegation,
    overhead: measure.overhead,
    wall: measure.wall,
    output,
    decoded: measure.decoded,
    decode: measure.decode,
    rate: measure.decode > 0 ? Math.round(measure.decoded / (measure.decode / 1000)) : 0,
  }
}

export function buildStepTiming(messages: readonly SessionMessageInfo[]): StepTimingRow[] {
  const rows: StepTimingRow[] = []
  let turn = 0
  let step = 0
  for (const message of messages) {
    if (message.type === "user") {
      turn += 1
      step = 0
      continue
    }
    if (message.type !== "assistant" || !message.tokens) continue
    const measure = measureAssistant(message)
    step += 1
    rows.push(stepTimingRowOf(message, measure, turn, step))
  }
  return rows
}

/** Totals shown above the charts, reduced from the already built step rows. */
export function timingOfRows(rows: readonly StepTimingRow[]): TimingStats {
  let ttft = 0
  let gen = 0
  let reasoning = 0
  let text = 0
  let toolArgs = 0
  let genLeftover = 0
  let reasoningBlocks = 0
  let textBlocks = 0
  let toolArgBlocks = 0
  let tool = 0
  let toolCalls = 0
  let question = 0
  let delegation = 0
  let overhead = 0
  let wall = 0
  let output = 0
  let decoded = 0
  let decode = 0
  let ttftSteps = 0
  let split = false
  for (const row of rows) {
    if (row.ttft !== undefined) {
      ttft += row.ttft
      ttftSteps += 1
    }
    gen += row.gen
    reasoning += row.reasoning
    text += row.text
    toolArgs += row.toolArgs
    genLeftover += row.genLeftover
    reasoningBlocks += row.reasoningBlocks
    textBlocks += row.textBlocks
    toolArgBlocks += row.toolArgBlocks
    if (row.split) split = true
    tool += row.tool
    toolCalls += row.toolCalls
    question += row.question
    delegation += row.delegation
    overhead += row.overhead
    wall += row.wall
    output += row.output
    decoded += row.decoded
    decode += row.decode
  }
  return {
    ttft: ttftSteps > 0 ? ttft : undefined,
    gen,
    reasoning,
    text,
    toolArgs,
    split,
    genLeftover,
    reasoningBlocks,
    textBlocks,
    toolArgBlocks,
    tool,
    toolCalls,
    question,
    delegation,
    overhead,
    wall,
    ttftAvg: ttftSteps > 0 ? Math.round(ttft / ttftSteps) : undefined,
    ttftSteps,
    steps: rows.length,
    output,
    decoded,
    rate: decode > 0 ? Math.round(decoded / (decode / 1000)) : 0,
  }
}

export interface TurnTimingRow {
  readonly turn: number
  readonly steps: number
  readonly ttft?: number
  readonly gen: number
  readonly reasoning: number
  readonly text: number
  readonly toolArgs: number
  readonly split: boolean
  readonly genLeftover: number
  readonly reasoningBlocks: number
  readonly textBlocks: number
  readonly toolArgBlocks: number
  readonly tool: number
  readonly question: number
  /** Time the turn waited for delegated subagents; excluded from active time. */
  readonly delegation: number
  readonly overhead: number
  readonly wall: number
  /** Output tokens, as reported by the provider. */
  readonly output: number
  /** Output plus reasoning tokens for the turn. */
  readonly decoded: number
  readonly rate: number
}

export function buildTurnTiming(steps: readonly StepTimingRow[]): TurnTimingRow[] {
  const turns = new Map<number, StepTimingRow[]>()
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
      const gen = list.reduce((sum, row) => sum + row.gen, 0)
      const output = list.reduce((sum, row) => sum + row.output, 0)
      const decoded = list.reduce((sum, row) => sum + row.decoded, 0)
      const decode = list.reduce((sum, row) => sum + row.decode, 0)
      const ttfts = list.flatMap((row) => (row.ttft === undefined ? [] : [row.ttft]))
      return {
        turn,
        steps: list.length,
        ttft: ttfts.length > 0 ? ttfts.reduce((sum, value) => sum + value, 0) : undefined,
        gen,
        reasoning: list.reduce((sum, row) => sum + row.reasoning, 0),
        text: list.reduce((sum, row) => sum + row.text, 0),
        toolArgs: list.reduce((sum, row) => sum + row.toolArgs, 0),
        split: list.some((row) => row.split),
        genLeftover: list.reduce((sum, row) => sum + row.genLeftover, 0),
        reasoningBlocks: list.reduce((sum, row) => sum + row.reasoningBlocks, 0),
        textBlocks: list.reduce((sum, row) => sum + row.textBlocks, 0),
        toolArgBlocks: list.reduce((sum, row) => sum + row.toolArgBlocks, 0),
        tool: list.reduce((sum, row) => sum + row.tool, 0),
        question: list.reduce((sum, row) => sum + row.question, 0),
        delegation: list.reduce((sum, row) => sum + row.delegation, 0),
        overhead: list.reduce((sum, row) => sum + row.overhead, 0),
        wall: list.reduce((sum, row) => sum + row.wall, 0),
        output,
        decoded,
        rate: decode > 0 ? Math.round(decoded / (decode / 1000)) : 0,
      }
    })
}

export interface TimingStats {
  /** Request start to the first token, over the steps that reported one. */
  readonly ttft?: number
  /** First token to end of streaming. */
  readonly gen: number
  /** Generation split, same categories as dsh-context. */
  readonly reasoning: number
  readonly text: number
  readonly toolArgs: number
  readonly split: boolean
  /** Generation not covered by the three measured slices; shown inside overhead. */
  readonly genLeftover: number
  readonly reasoningBlocks: number
  readonly textBlocks: number
  readonly toolArgBlocks: number
  /** Busy time with at least one non-question, non-delegation tool running. */
  readonly tool: number
  readonly toolCalls: number
  /** Time question tools waited for the user; excluded from active time. */
  readonly question: number
  /** Time steps waited for delegated subagents; excluded from active time. */
  readonly delegation: number
  /** Active time not covered by the measured categories. */
  readonly overhead: number
  readonly wall: number
  /** Average TTFT over the steps that reported one. */
  readonly ttftAvg?: number
  /** Steps with a measured TTFT. */
  readonly ttftSteps: number
  /** Steps with provider usage. */
  readonly steps: number
  readonly output: number
  /** Output plus reasoning tokens: what the decode window actually produced. */
  readonly decoded: number
  /** Output plus reasoning tokens per second of decode time. */
  readonly rate: number
}

export function buildTiming(messages: readonly SessionMessageInfo[]): TimingStats {
  return timingOfRows(buildStepTiming(messages))
}

