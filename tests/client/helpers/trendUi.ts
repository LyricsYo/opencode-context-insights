import { createSignal, type Accessor } from "solid-js"
import { CATEGORY_ORDER, type Category } from "../../../src/shared/estimate.ts"
import type { StepBrief, StepBriefEntry, StepRow } from "../../../src/shared/report.ts"
import { TREND_BAR, TREND_GAP } from "../../../src/client/styleMetrics.ts"

export function zeroDelta(): Record<Category, number> {
  return Object.fromEntries(CATEGORY_ORDER.map((category) => [category, 0])) as Record<Category, number>
}

export interface TrendRowLike {
  id: string
  turn: number
  step: number
  at: number
  prompt: number
  output: number
  total: number
  byCategory: Record<Category, number>
  duration?: number
  wait: number
  delegation: number
  headerMissing: boolean
  afterCompaction: boolean
}

export function trendRow(patch: Partial<TrendRowLike> = {}): TrendRowLike {
  return {
    id: "a1",
    turn: 1,
    step: 1,
    at: Date.UTC(2026, 10, 16, 8, 41),
    prompt: 100,
    output: 10,
    total: 100,
    byCategory: { ...zeroDelta(), system: 60, user: 40 },
    duration: 1000,
    wait: 0,
    delegation: 0,
    headerMissing: false,
    afterCompaction: false,
    ...patch,
  }
}

export function stepRow(patch: Partial<StepRow> = {}): StepRow {
  return {
    id: "a1",
    at: Date.UTC(2026, 10, 16, 8, 41),
    turn: 1,
    step: 1,
    prompt: 100,
    output: 10,
    reasoning: 0,
    cacheRead: 50,
    cacheWrite: 10,
    cost: 0,
    duration: 1000,
    agent: "build",
    afterCompaction: false,
    ...patch,
  }
}

export function briefEntry(patch: Partial<StepBriefEntry> = {}): StepBriefEntry {
  return { id: "e1", kind: "user", name: "User", preview: "inspect the repo", tokens: 10, messageID: "u1", ...patch }
}

export function brief(patch: Partial<StepBrief> = {}): StepBrief {
  return { opener: briefEntry(), inputs: [briefEntry({ id: "i1", name: "file.tsx" })], response: [briefEntry({ id: "r1", name: "Reply" })], ...patch }
}

export interface UiCalls {
  refreshTrendWindow: number
  refreshTimingWindow: number
  hoverTrendRow: Array<string | undefined>
  hoverTimingRow: Array<string | undefined>
  selectStep: string[]
  focusBrief: Array<[string, string, boolean]>
  measureTrendWindow: HTMLDivElement[]
  measureTimingWindow: HTMLDivElement[]
  rememberChartScroll: Array<"trend" | "timing">
  setBrowserFlat: boolean[]
  setBrowserOpen: Array<Category | undefined>
  setBrowserRowQuery: string[]
  scrollToBrowser: number
}

/** A BrowserUi-shaped object holding the signals and spies the two trend sections read. */
export function makeTrendUi() {
  const [trendAdaptive, setTrendAdaptive] = createSignal(false)
  const [trendDuration, setTrendDuration] = createSignal(false)
  const [trendOverview, setTrendOverview] = createSignal(false)
  const [trendMode, setTrendMode] = createSignal<"total" | "delta">("total")
  const [granularity, setGranularity] = createSignal<"step" | "turn">("step")
  const [trendHover, setTrendHover] = createSignal<string | undefined>(undefined)
  const [trendRibbonCat, setTrendRibbonCat] = createSignal<Category | undefined>(undefined)
  const [timingAdaptive, setTimingAdaptive] = createSignal(false)
  const [timingOverview, setTimingOverview] = createSignal(false)
  const [timingGranularity, setTimingGranularity] = createSignal<"step" | "turn">("step")
  const [timingHover, setTimingHover] = createSignal<string | undefined>(undefined)
  const [selectedStep, setSelectedStep] = createSignal<{ id: string; turn: number } | undefined>(undefined)
  const [turnStepCounts, setTurnStepCounts] = createSignal<ReadonlyMap<number, number>>(new Map())
  const [timingWall, setTimingWall] = createSignal(60_000)
  const calls: UiCalls = {
    refreshTrendWindow: 0,
    refreshTimingWindow: 0,
    hoverTrendRow: [],
    hoverTimingRow: [],
    selectStep: [],
    focusBrief: [],
    measureTrendWindow: [],
    measureTimingWindow: [],
    rememberChartScroll: [],
    setBrowserFlat: [],
    setBrowserOpen: [],
    setBrowserRowQuery: [],
    scrollToBrowser: 0,
  }
  const ui = {
    trendAdaptive,
    setTrendAdaptive,
    trendDuration,
    setTrendDuration,
    trendOverview,
    setTrendOverview,
    trendMode,
    setTrendMode,
    granularity,
    setGranularity,
    trendHover,
    setTrendHover,
    trendRibbonCat,
    setTrendRibbonCat,
    timingAdaptive,
    setTimingAdaptive,
    timingOverview,
    setTimingOverview,
    timingGranularity,
    setTimingGranularity,
    timingHover,
    setTimingHover,
    selectedStep,
    setSelectedStep,
    turnStepCounts,
    setTurnStepCounts,
    timingWall,
    setTimingWall,
    hoverTrendRow: (id: string | undefined) => {
      calls.hoverTrendRow.push(id)
      setTrendHover(id)
    },
    hoverTimingRow: (key: string | undefined) => {
      calls.hoverTimingRow.push(key)
      setTimingHover(key)
    },
    selectStep: (id: string) => {
      calls.selectStep.push(id)
    },
    focusBrief: (entry: StepBriefEntry, id: string, response: boolean) => {
      calls.focusBrief.push([entry.id, id, response])
    },
    measureTrendWindow: (el: HTMLDivElement) => {
      calls.measureTrendWindow.push(el)
    },
    measureTimingWindow: (el: HTMLDivElement) => {
      calls.measureTimingWindow.push(el)
    },
    rememberChartScroll: (which: "trend" | "timing") => {
      calls.rememberChartScroll.push(which)
    },
    setBrowserFlat: (value: boolean) => {
      calls.setBrowserFlat.push(value)
    },
    setBrowserOpen: (value: Category | undefined) => {
      calls.setBrowserOpen.push(value)
    },
    setBrowserRowQuery: (value: string) => {
      calls.setBrowserRowQuery.push(value)
    },
    scrollToBrowser: () => {
      calls.scrollToBrowser += 1
    },
    trendKeyOfTiming: (row: { id?: string }) => ("id" in row ? row.id : undefined),
  }
  return { ui, calls, signals: { setTurnStepCounts, setSelectedStep, setTimingWall, setTrendHover, setTimingHover } }
}

export interface TrendFixtureOptions {
  rows?: TrendRowLike[]
  deltas?: Array<Record<Category, number>>
  indexOf?: () => Map<string, number>
  steps?: StepRow[]
  render?: { from: number; to: number }
  missing?: number
  legend?: Category[]
  maxima?: { maxTotal: number; maxUp: number; maxDown: number }
  durationLabels?: string[]
  durationLines?: string[]
  width?: number
  selected?: TrendRowLike
  active?: TrendRowLike
  marker?: number
  activeDelta?: Record<Category, number>
  activeStep?: StepRow
  cacheRate?: string
  groups?: Array<{ turn: number; count: number; id: string }>
  axisLabels?: string[]
  ribbonAxisLabels?: string[]
  ribbon?: { polygons: Array<{ category: Category; points: string }>; max: number }
  brief?: StepBrief
  hover?: Accessor<string | undefined>
}

/** The accessors TrendSection reads from createTrendModel, over plain fixture rows. */
export function makeTrendFixture(options: TrendFixtureOptions = {}) {
  const rows = options.rows ?? [trendRow()]
  const deltas = options.deltas ?? rows.map(() => zeroDelta())
  const steps = options.steps ?? [stepRow()]
  const activeIndex = () => {
    if (options.active !== undefined) return rows.findIndex((row) => row.id === options.active!.id)
    const hovered = options.hover?.()
    const found = rows.findIndex((row) => row.id === hovered)
    return found >= 0 ? found : rows.length - 1
  }
  const active = () => options.active ?? rows[activeIndex()]
  const activeDelta = () => options.activeDelta ?? deltas[activeIndex()]
  const groups = () => {
    const result: Array<{ turn: number; count: number; id: string }> = []
    rows.forEach((row) => {
      const last = result.at(-1)
      if (last !== undefined && last.turn === row.turn) {
        last.count += 1
        last.id = row.id
      } else {
        result.push({ turn: row.turn, count: 1, id: row.id })
      }
    })
    return result
  }
  return {
    trendRows: () => rows,
    trendIndexOf: () => options.indexOf?.() ?? new Map(rows.map((row, index) => [row.id, index])),
    trendRender: () => options.render ?? { from: 0, to: rows.length - 1 },
    trendMissingCount: () => options.missing ?? rows.filter((row) => row.headerMissing).length,
    trendDeltas: () => deltas,
    trendLegend: () => options.legend ?? CATEGORY_ORDER.filter((category) => rows.some((row) => row.byCategory[category] > 0)),
    trendMaxima: () => options.maxima ?? { maxTotal: Math.max(1, ...rows.map((row) => row.total)), maxUp: 1, maxDown: 1 },
    trendDurationLabels: () => options.durationLabels ?? ["1s", "0.75s", "0.5s", "0.25s", "0"],
    trendWidth: () => options.width ?? Math.max(1, rows.length * (TREND_BAR + TREND_GAP) - TREND_GAP),
    trendSelected: () => options.selected,
    trendActive: active,
    trendRowLabel: (row: TrendRowLike) => `T${row.turn} S${row.step}`,
    trendRibbonMarker: () => options.marker,
    trendActiveDelta: activeDelta,
    trendActiveNet: () => {
      const delta = activeDelta()
      return delta === undefined ? 0 : CATEGORY_ORDER.reduce((sum, category) => sum + delta[category], 0)
    },
    trendActiveStep: () => options.activeStep ?? steps.find((step) => step.id === active()?.id),
    trendCacheRate: () => options.cacheRate ?? "50.0%",
    trendBrief: () => options.brief,
    trendGroups: options.groups === undefined ? groups : () => options.groups!,
    trendDurationLines: () => options.durationLines ?? [],
    trendAxisLabels: () => options.axisLabels ?? ["100", "75", "50", "25", "0"],
    trendRibbonAxisLabels: () => options.ribbonAxisLabels ?? ["100", "75", "50", "25", "0"],
    trendRibbon: () => options.ribbon ?? { polygons: [], max: 1 },
  }
}

export interface TimingRowLike {
  id?: string
  at?: number
  turn: number
  step?: number
  steps?: number
  ttft?: number
  gen: number
  reasoning: number
  text: number
  toolArgs: number
  split: boolean
  genLeftover: number
  tool: number
  question: number
  delegation: number
  overhead: number
  wall: number
  output: number
  decoded: number
  rate: number
}

export function stepTimingRow(patch: Partial<TimingRowLike> = {}): TimingRowLike {
  return {
    id: "a1",
    at: Date.UTC(2026, 10, 16, 8, 41),
    turn: 1,
    step: 1,
    ttft: 100,
    gen: 1000,
    reasoning: 100,
    text: 600,
    toolArgs: 100,
    split: true,
    genLeftover: 200,
    tool: 0,
    question: 0,
    delegation: 0,
    overhead: 100,
    wall: 1200,
    output: 100,
    decoded: 100,
    rate: 100,
    ...patch,
  }
}

export function turnTimingRow(patch: Partial<TimingRowLike> = {}): TimingRowLike {
  const row: TimingRowLike = { ...stepTimingRow(), turn: 1, steps: 2, ...patch }
  delete row.id
  delete row.step
  return row
}

export interface SegmentLike {
  key: string
  label: string
  ms: number
  color: string
}

export interface TimingFixtureOptions {
  rows?: TimingRowLike[]
  render?: { from: number; to: number }
  max?: number
  segmentsOf?: (row: TimingRowLike, withWait?: boolean) => SegmentLike[]
  labelOf?: (row: TimingRowLike) => string
  ribbon?: {
    polygons: Array<{ key: string; points: string; color: string }>
    max: number
  }
  ribbonAxis?: string[]
  groups?: Array<{ turn: number; count: number; key: string }>
  active?: TimingRowLike
  groupSteps?: (group: { turn: number; count: number; key: string }) => number
  marker?: number
  hover?: Accessor<string | undefined>
  attachTimingScroll?: (el: HTMLDivElement) => void
}

/** The accessors TimingTrendSection reads from createTimingModel, over plain fixture rows. */
export function makeTimingFixture(options: TimingFixtureOptions = {}) {
  const rows = options.rows ?? [stepTimingRow()]
  const keyOf = (row: TimingRowLike) => ("id" in row ? row.id! : `turn:${row.turn}`)
  const groups = () => {
    const result: Array<{ turn: number; count: number; key: string }> = []
    for (const row of rows) {
      const last = result.at(-1)
      if (last !== undefined && last.turn === row.turn) {
        last.count += 1
        last.key = keyOf(row)
        continue
      }
      result.push({ turn: row.turn, count: 1, key: keyOf(row) })
    }
    return result
  }
  const active = () => {
    if (options.active !== undefined) return options.active
    const hovered = options.hover?.()
    return rows.find((row) => keyOf(row) === hovered) ?? rows.at(-1)
  }
  return {
    timingTrendRows: () => rows,
    timingTrendKey: keyOf,
    timingRender: () => options.render ?? { from: 0, to: rows.length - 1 },
    timingTrendMax: () => options.max ?? Math.max(1, ...rows.map((row) => row.wall)),
    timingSegmentsOf: (row: TimingRowLike, withWait = false): SegmentLike[] =>
      options.segmentsOf?.(row, withWait) ?? (withWait
        ? [
            { key: "ttft", label: "TTFT", ms: 100, color: "#111111" },
            { key: "question", label: "User wait", ms: 50, color: "#222222" },
          ]
        : [{ key: "ttft", label: "TTFT", ms: 100, color: "#111111" }]),
    timingTrendLabel: (row: TimingRowLike) =>
      options.labelOf?.(row) ?? ("id" in row ? `T${row.turn} S${row.step}` : `T${row.turn} · ${row.steps} steps`),
    timingRibbon: () => options.ribbon ?? { polygons: [], max: 1 },
    timingRibbonAxis: () => options.ribbonAxis ?? ["1.2s", "0.9s", "0.6s", "0.3s", "0"],
    timingTrendGroups: options.groups === undefined ? groups : () => options.groups!,
    timingTrendActive: active,
    timingGroupSteps: options.groupSteps ?? ((group) => group.count),
    timingRibbonMarker: () => options.marker,
  }
}
