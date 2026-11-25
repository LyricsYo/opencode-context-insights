import { createMemo, type Accessor } from "solid-js"
import type { SessionMessageInfo } from "@opencode/client"
import { CATEGORY_ORDER, type Category } from "../../shared/estimate.ts"
import { buildStepBrief, categoryDeltas, fmt, percent2, span, type StepBrief, type StepRow, type TokenStepRow, type TokenTurnRow } from "../../shared/report.ts"
import { TREND_BAR, TREND_GAP, TREND_HEIGHT, TREND_PAD } from "../styleMetrics.ts"
import { NO_TREND_ROWS, stackedRibbon, type PanelView } from "../panelSupport.ts"

export interface TrendModelParams {
  readonly ctx: { t: (key: string, params?: Record<string, string>) => string }
  readonly view: Accessor<PanelView>
  readonly granularity: Accessor<'step' | 'turn'>
  readonly browserFlat: Accessor<boolean>
  readonly browserOpen: Accessor<Category | undefined>
  readonly selectedID: Accessor<string | undefined>
  readonly selectedStep: Accessor<StepRow | undefined>
  readonly tokenSteps: Accessor<TokenStepRow[]>
  readonly tokenTurns: Accessor<TokenTurnRow[]>
  readonly turnStepCounts: Accessor<ReadonlyMap<number, number>>
  readonly steps: Accessor<StepRow[]>
  readonly messages: Accessor<SessionMessageInfo[]>
  readonly trendMode: Accessor<'total' | 'delta'>
  readonly trendHover: Accessor<string | undefined>
  readonly trendWindow: Accessor<{ from: number; to: number } | undefined>
  readonly trendAdaptive: Accessor<boolean>
}

export function createTrendModel(params: TrendModelParams) {
  const { ctx, view, granularity, browserFlat, browserOpen, selectedID, selectedStep, tokenSteps, tokenTurns, turnStepCounts, steps, messages, trendMode, trendHover, trendWindow, trendAdaptive } = params
  const trendFocus = createMemo(() => (browserFlat() ? undefined : browserOpen()))
  const trendAll = createMemo(() => {
    if (view() !== "browser") return NO_TREND_ROWS
    const rows: Array<TokenStepRow | TokenTurnRow> = granularity() === "turn" ? tokenTurns() : tokenSteps()
    const focus = trendFocus()
    if (focus === undefined) return rows
    return rows.map((row) => {
      const value = row.byCategory[focus]
      return {
        ...row,
        total: value,
        byCategory: Object.fromEntries(
          CATEGORY_ORDER.map((category) => [category, category === focus ? value : 0]),
        ) as Record<Category, number>,
      }
    })
  })
  const trendDeltasAll = createMemo(() => categoryDeltas(trendAll()))
  const trendRows = trendAll
  /** Index lookup for the windowed `<For>`; window changes must not recreate the kept bars. */
  const trendIndexOf = createMemo(() => {
    const map = new Map<string, number>()
    trendRows().forEach((row, index) => map.set(row.id, index))
    return map
  })
  /** Only the visible bars (plus a pad) are mounted; two spacers keep the full scroll width. */
  const trendRender = createMemo(() => {
    const count = trendRows().length
    if (count === 0) return { from: 0, to: -1 }
    const window = trendWindow()
    if (window === undefined) return { from: Math.max(0, count - 80), to: count - 1 }
    return {
      from: Math.max(0, window.from - TREND_PAD),
      to: Math.min(count - 1, window.to + TREND_PAD),
    }
  })
  const trendMissingCount = createMemo(
    () => trendRows().reduce((count, row) => count + (row.headerMissing ? 1 : 0), 0),
  )
  const trendDeltas = trendDeltasAll
  const trendCategories = createMemo(() =>
    CATEGORY_ORDER.filter((category) => trendRows().some((row) => row.byCategory[category] > 0)),
  )
  const deltaCategories = createMemo(() =>
    CATEGORY_ORDER.filter((category) => trendDeltas().some((delta) => delta[category] !== 0)),
  )
  const trendLegend = createMemo(() => (trendMode() === "delta" ? deltaCategories() : trendCategories()))
  const trendWindowed = createMemo(() => {
    const window = trendWindow()
    if (!trendAdaptive() || window === undefined) return undefined
    return { rows: trendRows().slice(window.from, window.to + 1), deltas: trendDeltas().slice(window.from, window.to + 1) }
  })
  const trendMaxima = createMemo(() => {
    const view = trendWindowed()
    const rows = view?.rows ?? trendRows()
    const deltas = view?.deltas ?? trendDeltas()
    let maxTotal = 1
    let maxUp = 1
    let maxDown = 1
    for (const row of rows) maxTotal = Math.max(maxTotal, row.total)
    for (const delta of deltas) {
      let up = 0
      let down = 0
      for (const category of CATEGORY_ORDER) {
        if (delta[category] > 0) up += delta[category]
        else down -= delta[category]
      }
      maxUp = Math.max(maxUp, up)
      maxDown = Math.max(maxDown, down)
    }
    return { maxTotal, maxUp, maxDown }
  })
  const trendMaxDuration = createMemo(() => {
    const rows = trendWindowed()?.rows ?? trendRows()
    return Math.max(1, ...rows.map((row) => row.duration ?? 0))
  })
  const trendDurationLabels = createMemo(() => {
    const max = trendMaxDuration()
    return [span(max), span(Math.round((max * 3) / 4)), span(Math.round(max / 2)), span(Math.round(max / 4)), "0"]
  })
  const trendWidth = createMemo(() => Math.max(1, trendRows().length * (TREND_BAR + TREND_GAP) - TREND_GAP))
  const trendSelected = createMemo(() => {
    const direct = trendRows().find((row) => row.id === selectedID())
    if (direct) return direct
    if (granularity() !== "turn") return undefined
    const turn = selectedStep()?.turn
    return turn === undefined ? undefined : trendRows().find((row) => row.turn === turn)
  })
  const trendActive = createMemo(() => {
    const rows = trendRows()
    if (rows.length === 0) return undefined
    return rows.find((row) => row.id === trendHover()) ?? trendSelected() ?? rows.at(-1)
  })
  const trendRowLabel = (row: TokenStepRow | TokenTurnRow) =>
    "steps" in row
      ? ctx.t("trend.turnLabel", { turn: String(row.turn), steps: String(row.steps) })
      : ctx.t("trend.stepLabel", {
          turn: String(row.turn),
          step: String(row.step),
          steps: String(turnStepCounts().get(row.turn) ?? row.step),
        })
  const trendActiveIndex = createMemo(() => {
    const row = trendActive()
    return row ? trendRows().findIndex((item) => item.id === row.id) : -1
  })
  const trendRibbonMarker = createMemo(() => {
    const index = trendActiveIndex()
    const count = trendRows().length
    return index < 0 ? undefined : count <= 1 ? 500 : (index / (count - 1)) * 1000
  })
  const trendActiveDelta = createMemo(() => trendDeltas()[trendActiveIndex()])
  const trendActiveNet = createMemo(() => {
    const delta = trendActiveDelta()
    return delta ? CATEGORY_ORDER.reduce((sum, category) => sum + delta[category], 0) : 0
  })
  const trendActiveStep = createMemo(() => {
    const row = trendActive()
    return row ? steps().find((step) => step.id === row.id) : undefined
  })
  const trendCacheRate = createMemo(() => {
    const row = trendActive()
    const step = trendActiveStep()
    return row && step ? percent2(step.cacheRead, row.prompt) : "—"
  })
  const briefCache = new Map<string, StepBrief>()
  let briefCacheLength = -1
  const clearBriefCache = () => {
    briefCache.clear()
    briefCacheLength = -1
  }
  const trendBrief = createMemo(() => {
    const list = messages()
    if (list.length !== briefCacheLength) {
      briefCache.clear()
      briefCacheLength = list.length
    }
    const row = trendActive()
    if (!row) return undefined
    const cached = briefCache.get(row.id)
    if (cached) return cached
    const brief = buildStepBrief(list, row.id)
    briefCache.set(row.id, brief)
    return brief
  })
  const trendGroups = createMemo(() => {
    const groups: { turn: number; from: number; count: number; id: string }[] = []
    trendRows().forEach((row, index) => {
      const last = groups.at(-1)
      if (last && last.turn === row.turn) {
        last.count += 1
        last.id = row.id
      } else {
        groups.push({ turn: row.turn, from: index, count: 1, id: row.id })
      }
    })
    return groups
  })
  const trendDurationLines = createMemo(() => {
    const max = trendMaxDuration()
    const lines: string[] = []
    let run: string[] = []
    const flush = () => {
      if (run.length >= 2) lines.push(run.join(" "))
      run = []
    }
    trendRows().forEach((row, index) => {
      if (row.duration === undefined) {
        flush()
        return
      }
      const x = index * (TREND_BAR + TREND_GAP) + TREND_BAR / 2
      const y = TREND_HEIGHT - (row.duration / max) * TREND_HEIGHT
      run.push(`${x},${Math.round(y * 100) / 100}`)
    })
    flush()
    return lines
  })
  const trendAxisLabels = createMemo(() => {
    const maxima = trendMaxima()
    if (trendMode() === "total") {
      return [
        fmt(maxima.maxTotal),
        fmt(Math.round((maxima.maxTotal * 3) / 4)),
        fmt(Math.round(maxima.maxTotal / 2)),
        fmt(Math.round(maxima.maxTotal / 4)),
        "0",
      ]
    }
    return [
      `+${fmt(maxima.maxUp)}`,
      `+${fmt(Math.round(maxima.maxUp / 2))}`,
      "0",
      `-${fmt(Math.round(maxima.maxDown / 2))}`,
      `-${fmt(maxima.maxDown)}`,
    ]
  })
  const trendRibbonAxisLabels = createMemo(() => {
    const max = Math.max(1, trendMode() === "delta" ? trendMaxima().maxUp : trendMaxima().maxTotal)
    return [
      fmt(max),
      fmt(Math.round((max * 3) / 4)),
      fmt(Math.round(max / 2)),
      fmt(Math.round(max / 4)),
      "0",
    ]
  })
  const trendRibbon = createMemo(() => {
    const rows = trendRows()
    const delta = trendMode() === "delta"
    const maxima = trendMaxima()
    const max = Math.max(1, delta ? maxima.maxUp : maxima.maxTotal)
    const polygons = stackedRibbon(rows.length, CATEGORY_ORDER, max, (index, category) =>
      delta ? Math.max(0, trendDeltas()[index][category as Category]) : rows[index].byCategory[category as Category],
    ).map((polygon) => ({ category: polygon.key as Category, points: polygon.points }))
    return { polygons, max }
  })
  return {
    trendFocus, trendAll, trendDeltasAll, trendRows, trendIndexOf, trendRender, trendMissingCount,
    trendDeltas, trendCategories, deltaCategories, trendLegend, trendWindowed, trendMaxima,
    trendMaxDuration, trendDurationLabels, trendWidth, trendSelected, trendActive, trendRowLabel,
    trendActiveIndex, trendRibbonMarker, trendActiveDelta, trendActiveNet, trendActiveStep,
    trendCacheRate, trendBrief, trendGroups, trendDurationLines, trendAxisLabels,
    trendRibbonAxisLabels, trendRibbon, clearBriefCache,
  }
}
