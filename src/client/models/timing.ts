import { createMemo, type Accessor } from "solid-js"
import { buildTurnTiming, span, type SessionIndex, type StepTimingRow, type TurnTimingRow } from "../../shared/report.ts"
import { NO_STEP_TIMING, stackedRibbon, TIMING_COLOR, type PanelView } from "../panelSupport.ts"
import { TREND_PAD } from "../styleMetrics.ts"

export interface TimingModelParams {
  readonly ctx: { t: (key: string, params?: Record<string, string>) => string }
  readonly view: Accessor<PanelView>
  readonly sessionIndex: Accessor<SessionIndex>
  readonly timingGranularity: Accessor<'step' | 'turn'>
  readonly timingWindow: Accessor<{ from: number; to: number } | undefined>
  readonly timingAdaptive: Accessor<boolean>
  readonly timingHover: Accessor<string | undefined>
  readonly selectedStep: Accessor<{ id: string; turn: number } | undefined>
}

export function createTimingModel(params: TimingModelParams) {
  const { ctx, view, sessionIndex, timingGranularity, timingWindow, timingAdaptive, timingHover, selectedStep } = params
  const stepTiming = createMemo(() =>
    view() === "browser" ? (sessionIndex().stepTiming ?? NO_STEP_TIMING) : NO_STEP_TIMING,
  )
  const turnTiming = createMemo(() => buildTurnTiming(stepTiming()))
  const timingTrendRows = createMemo(() => (timingGranularity() === "turn" ? turnTiming() : stepTiming()))
  const timingTrendKey = (row: StepTimingRow | TurnTimingRow) => ("id" in row ? row.id : `turn:${row.turn}`)
  /** Only the visible bars (plus a pad) are mounted; two spacers keep the full scroll width. */
  const timingRender = createMemo(() => {
    const count = timingTrendRows().length
    if (count === 0) return { from: 0, to: -1 }
    const window = timingWindow()
    if (window === undefined) return { from: Math.max(0, count - 80), to: count - 1 }
    return {
      from: Math.max(0, window.from - TREND_PAD),
      to: Math.min(count - 1, window.to + TREND_PAD),
    }
  })
  const timingTrendTotal = (row: StepTimingRow | TurnTimingRow) =>
    (row.ttft ?? 0) +
    (row.split ? row.reasoning + row.text + row.toolArgs + row.genLeftover : row.gen) +
    row.tool +
    row.question +
    row.overhead
  /** Chart scale: user wait is dropped so one long answer gap cannot flatten every bar. */
  const timingChartTotal = (row: StepTimingRow | TurnTimingRow) =>
    Math.max(0, timingTrendTotal(row) - row.question)
  const timingTrendMax = createMemo(() => {
    const window = timingWindow()
    const rows = timingAdaptive() && window ? timingTrendRows().slice(window.from, window.to + 1) : timingTrendRows()
    return Math.max(1, ...rows.map((row) => timingChartTotal(row)))
  })
  const timingSegmentsOf = (row: StepTimingRow | TurnTimingRow, withWait = false) => {
    const segments: Array<{ key: string; label: string; ms: number; color: string }> = [
      { key: "ttft", label: ctx.t("timing.ttft"), ms: row.ttft ?? 0, color: TIMING_COLOR.ttft },
    ]
    if (row.split) {
      segments.push(
        { key: "reasoning", label: ctx.t("timing.reasoning"), ms: row.reasoning, color: TIMING_COLOR.reasoning },
        { key: "text", label: ctx.t("timing.text"), ms: row.text, color: TIMING_COLOR.text },
        { key: "toolArgs", label: ctx.t("timing.toolArgs"), ms: row.toolArgs, color: TIMING_COLOR.toolArg },
      )
    } else {
      segments.push({ key: "gen", label: ctx.t("timing.gen"), ms: row.gen, color: TIMING_COLOR.reasoning })
    }
    segments.push(
      { key: "tools", label: ctx.t("timing.tools"), ms: row.tool, color: TIMING_COLOR.tools },
      ...(withWait
        ? [{ key: "question", label: ctx.t("timing.question"), ms: row.question, color: TIMING_COLOR.question }]
        : []),
      {
        key: "other",
        label: ctx.t("timing.other"),
        ms: row.overhead + (row.split ? row.genLeftover : 0),
        color: TIMING_COLOR.other,
      },
    )
    return segments.filter((segment) => segment.ms > 0)
  }
  const timingTrendLabel = (row: StepTimingRow | TurnTimingRow) =>
    "id" in row
      ? ctx.t("timing.stepLabel", { turn: String(row.turn), step: String(row.step) })
      : ctx.t("timing.turnLabel", { turn: String(row.turn), steps: String(row.steps) })
  const timingRibbon = createMemo(() => {
    const rows = timingTrendRows()
    let hasTtft = false
    let hasGen = false
    let hasReasoning = false
    let hasText = false
    let hasToolArgs = false
    let hasTools = false
    let hasOther = false
    let max = 1
    for (const row of rows) {
      if ((row.ttft ?? 0) > 0) hasTtft = true
      if (row.split) {
        if (row.reasoning > 0) hasReasoning = true
        if (row.text > 0) hasText = true
        if (row.toolArgs > 0) hasToolArgs = true
      } else if (row.gen > 0) hasGen = true
      if (row.tool > 0) hasTools = true
      if (row.overhead + (row.split ? row.genLeftover : 0) > 0) hasOther = true
      const total = timingChartTotal(row)
      if (total > max) max = total
    }
    const order = [
      ...(hasTtft ? ["ttft"] : []),
      ...(hasGen ? ["gen"] : []),
      ...(hasReasoning ? ["reasoning"] : []),
      ...(hasText ? ["text"] : []),
      ...(hasToolArgs ? ["toolArgs"] : []),
      ...(hasTools ? ["tools"] : []),
      ...(hasOther ? ["other"] : []),
    ]
    // Build segment maps only for the indices the ribbon actually samples.
    const sampled = new Map<number, Map<string, number>>()
    const valueAt = (index: number, key: string) => {
      let map = sampled.get(index)
      if (map === undefined) {
        map = new Map(timingSegmentsOf(rows[index]).map((segment) => [segment.key, segment.ms]))
        sampled.set(index, map)
      }
      return map.get(key) ?? 0
    }
    const colorOf = (key: string): string => {
      switch (key) {
        case "ttft":
          return TIMING_COLOR.ttft
        case "gen":
        case "reasoning":
          return TIMING_COLOR.reasoning
        case "text":
          return TIMING_COLOR.text
        case "toolArgs":
          return TIMING_COLOR.toolArg
        case "tools":
          return TIMING_COLOR.tools
        default:
          return TIMING_COLOR.other
      }
    }
    const polygons = stackedRibbon(rows.length, order, max, valueAt).map((polygon) => ({
      ...polygon,
      color: colorOf(polygon.key),
    }))
    return { polygons, max }
  })
  const timingRibbonAxis = createMemo(() => {
    const max = timingRibbon().max
    return [span(max), span(Math.round((max * 3) / 4)), span(Math.round(max / 2)), span(Math.round(max / 4)), "0"]
  })
  const timingTrendGroups = createMemo(() => {
    const groups: Array<{ turn: number; count: number; key: string }> = []
    for (const row of timingTrendRows()) {
      const last = groups.at(-1)
      if (last !== undefined && last.turn === row.turn) {
        last.count += 1
        last.key = timingTrendKey(row)
        continue
      }
      groups.push({ turn: row.turn, count: 1, key: timingTrendKey(row) })
    }
    return groups
  })
  const timingSelected = createMemo(() => {
    const step = selectedStep()
    if (step === undefined) return undefined
    if (timingGranularity() === "turn") return timingTrendRows().find((row) => row.turn === step.turn)
    return timingTrendRows().find((row) => "id" in row && row.id === step.id)
  })
  const timingTrendActive = createMemo(() => {
    const key = timingHover()
    const rows = timingTrendRows()
    return rows.find((row) => timingTrendKey(row) === key) ?? timingSelected() ?? rows.at(-1)
  })
  const timingGroupSteps = (group: { turn: number; count: number }) => {
    if (timingGranularity() === "turn") {
      const row = timingTrendRows().find((entry) => entry.turn === group.turn)
      return row !== undefined && "steps" in row ? row.steps : group.count
    }
    return group.count
  }
  const timingTrendActiveIndex = createMemo(() => {
    const row = timingTrendActive()
    return row ? timingTrendRows().findIndex((entry) => timingTrendKey(entry) === timingTrendKey(row)) : -1
  })
  const timingRibbonMarker = createMemo(() => {
    const index = timingTrendActiveIndex()
    const count = timingTrendRows().length
    return index < 0 ? undefined : count <= 1 ? 500 : (index / (count - 1)) * 1000
  })
  return {
    stepTiming, turnTiming, timingTrendRows, timingTrendKey, timingRender, timingTrendTotal,
    timingChartTotal, timingTrendMax, timingSegmentsOf, timingTrendLabel, timingRibbon,
    timingRibbonAxis, timingTrendGroups, timingSelected, timingTrendActive, timingGroupSteps,
    timingTrendActiveIndex, timingRibbonMarker,
  }
}
