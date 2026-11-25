import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { createRoot, createSignal } from "solid-js"
import type { SessionMessageInfo } from "@opencode/client"
import type { Category } from "../../../src/shared/estimate.ts"
import { CATEGORY_ORDER } from "../../../src/shared/estimate.ts"
import type { StepRow, TokenStepRow, TokenTurnRow } from "../../../src/shared/report.ts"
import { createTrendModel } from "../../../src/client/models/trend.ts"
import { NO_TREND_ROWS, type PanelView } from "../../../src/client/panelSupport.ts"

const now = Date.UTC(2026, 10, 16, 8, 41)

const t = (key: string, params?: Record<string, string>) =>
  params === undefined ? key : `${key}:${Object.entries(params).map(([name, value]) => `${name}=${value}`).join(",")}`

const zero = (): Record<Category, number> => Object.fromEntries(CATEGORY_ORDER.map((key) => [key, 0])) as Record<Category, number>

const tokenStep = (patch: Partial<TokenStepRow> = {}): TokenStepRow => ({
  id: "a1",
  at: now,
  turn: 1,
  step: 1,
  prompt: 100,
  output: 10,
  duration: 1000,
  wait: 0,
  delegation: 0,
  total: 100,
  byCategory: { ...zero(), system: 60, user: 40 },
  headerMissing: false,
  afterCompaction: false,
  ...patch,
})

const tokenTurn = (patch: Partial<TokenTurnRow> = {}): TokenTurnRow => ({
  id: "turn:1",
  turn: 1,
  at: now,
  steps: 2,
  prompt: 100,
  output: 10,
  duration: 2000,
  wait: 0,
  delegation: 0,
  total: 100,
  byCategory: { ...zero(), system: 60, user: 40 },
  headerMissing: false,
  afterCompaction: false,
  ...patch,
})

const step = (patch: Partial<StepRow> = {}): StepRow => ({
  id: "a1",
  at: now,
  turn: 1,
  step: 1,
  prompt: 100,
  output: 10,
  reasoning: 0,
  cacheRead: 25,
  cacheWrite: 0,
  cost: 0,
  duration: 1000,
  agent: "build",
  afterCompaction: false,
  ...patch,
})

const messages: SessionMessageInfo[] = [
  { id: "u1", type: "user", text: "inspect the repo", time: { created: now } } as unknown as SessionMessageInfo,
  {
    id: "a1",
    type: "assistant",
    agent: "build",
    model: { id: "m", providerID: "p" },
    time: { created: now + 1000, completed: now + 2000 },
    content: [{ type: "text", text: "the answer" }],
    tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
    cost: 0.01,
  } as unknown as SessionMessageInfo,
]

function setup(overrides: Record<string, unknown> = {}) {
  const [view, setView] = createSignal<PanelView>("browser")
  const [granularity, setGranularity] = createSignal<"step" | "turn">("step")
  const [browserFlat, setBrowserFlat] = createSignal(false)
  const [browserOpen, setBrowserOpen] = createSignal<Category | undefined>(undefined)
  const [selectedID, setSelectedID] = createSignal<string | undefined>(undefined)
  const [selectedStep, setSelectedStep] = createSignal<StepRow | undefined>(undefined)
  const [tokenSteps, setTokenSteps] = createSignal<TokenStepRow[]>([
    tokenStep({ id: "a1", turn: 1, step: 1 }),
    tokenStep({ id: "a2", turn: 2, step: 1, byCategory: { ...zero(), system: 60, user: 40 } }),
    tokenStep({ id: "a3", turn: 2, step: 2, byCategory: { ...zero(), system: 60, user: 40 } }),
  ])
  const [tokenTurns, setTokenTurns] = createSignal<TokenTurnRow[]>([
    tokenTurn({ id: "turn:1", turn: 1 }),
    tokenTurn({ id: "turn:2", turn: 2 }),
  ])
  const [turnStepCounts, setTurnStepCounts] = createSignal<ReadonlyMap<number, number>>(new Map([[1, 3]]))
  const [steps, setSteps] = createSignal<StepRow[]>([step({ id: "a1" }), step({ id: "a2", turn: 2 }), step({ id: "a3", turn: 2 })])
  const [messageList, setMessageList] = createSignal<SessionMessageInfo[]>(messages)
  const [trendMode, setTrendMode] = createSignal<"total" | "delta">("total")
  const [trendHover, setTrendHover] = createSignal<string | undefined>(undefined)
  const [trendWindow, setTrendWindow] = createSignal<{ from: number; to: number } | undefined>(undefined)
  const [trendAdaptive, setTrendAdaptive] = createSignal(false)
  const deps = {
    view,
    granularity,
    browserFlat,
    browserOpen,
    selectedID,
    selectedStep,
    tokenSteps,
    tokenTurns,
    turnStepCounts,
    steps,
    messageList,
    trendMode,
    trendHover,
    trendWindow,
    trendAdaptive,
    ...overrides,
  }
  let dispose = () => {}
  const model = createRoot((stop) => {
    dispose = stop
    return createTrendModel({
      ctx: { t },
      view: deps.view,
      granularity: deps.granularity,
      browserFlat: deps.browserFlat,
      browserOpen: deps.browserOpen,
      selectedID: deps.selectedID,
      selectedStep: deps.selectedStep,
      tokenSteps: deps.tokenSteps,
      tokenTurns: deps.tokenTurns,
      turnStepCounts: deps.turnStepCounts,
      steps: deps.steps,
      messages: deps.messageList,
      trendMode: deps.trendMode,
      trendHover: deps.trendHover,
      trendWindow: deps.trendWindow,
      trendAdaptive: deps.trendAdaptive,
    })
  })
  return {
    model,
    dispose,
    signals: {
      setView,
      setGranularity,
      setBrowserFlat,
      setBrowserOpen,
      setSelectedID,
      setSelectedStep,
      setTokenSteps,
      setTokenTurns,
      setTurnStepCounts,
      setSteps,
      setMessageList,
      setTrendMode,
      setTrendHover,
      setTrendWindow,
      setTrendAdaptive,
    },
  }
}

describe("createTrendModel", () => {
  test("returns no rows outside the browser tab", () => {
    const { model, dispose, signals } = setup()
    signals.setView("overview")
    assert.deepEqual(model.trendAll(), NO_TREND_ROWS)
    assert.deepEqual(model.trendRows(), [])
    assert.deepEqual(model.trendDeltas(), [])
    assert.deepEqual(model.trendCategories(), [])
    assert.deepEqual(model.trendLegend(), [])
    dispose()
  })

  test("tracks the focus from the open category unless the flat list is shown", () => {
    const { model, dispose, signals } = setup()
    assert.equal(model.trendFocus(), undefined)

    signals.setBrowserOpen("user")
    assert.equal(model.trendFocus(), "user")

    signals.setBrowserFlat(true)
    assert.equal(model.trendFocus(), undefined)

    // Flat still wins when a category remains open.
    signals.setBrowserFlat(false)
    signals.setBrowserFlat(true)
    assert.equal(model.trendFocus(), undefined)
    dispose()
  })

  test("narrows every row to the focused category", () => {
    const { model, dispose, signals } = setup()
    signals.setBrowserOpen("user")
    const rows = model.trendAll()
    assert.deepEqual(rows.map((row) => row.total), [40, 40, 40])
    for (const row of rows) {
      assert.equal(row.byCategory.user, 40)
      assert.equal(row.byCategory.system, 0)
    }
    dispose()
  })

  test("switches between step and turn rows", () => {
    const { model, dispose, signals } = setup()
    assert.deepEqual(model.trendRows().map((row) => row.id), ["a1", "a2", "a3"])
    assert.deepEqual(model.trendDeltas().length, 3)

    signals.setGranularity("turn")
    assert.deepEqual(model.trendRows().map((row) => row.id), ["turn:1", "turn:2"])

    signals.setView("overview")
    assert.deepEqual(model.trendRows(), [])
    dispose()
  })

  test("indexes the rows by id", () => {
    const { model, dispose } = setup()
    const index = model.trendIndexOf()
    assert.equal(index.get("a2"), 1)
    assert.equal(index.size, 3)
    dispose()
  })

  test("renders an empty window, the last 80 rows and a padded window", () => {
    const rows = Array.from({ length: 200 }, (_, index) => tokenStep({ id: `a${index}`, turn: 1 }))
    const { model, dispose, signals } = setup()
    signals.setTokenSteps(rows)
    assert.deepEqual(model.trendRender(), { from: 120, to: 199 })

    signals.setTrendWindow({ from: 10, to: 20 })
    const padded = model.trendRender()
    assert.ok(padded.from < 10)
    assert.ok(padded.to > 20)

    signals.setTrendWindow({ from: 0, to: 500 })
    assert.deepEqual(model.trendRender(), { from: 0, to: 199 })

    signals.setTokenSteps([])
    assert.deepEqual(model.trendRender(), { from: 0, to: -1 })
    dispose()
  })

  test("counts the rows whose header is missing", () => {
    const { model, dispose, signals } = setup()
    assert.equal(model.trendMissingCount(), 0)
    signals.setTokenSteps([tokenStep({ id: "a1", headerMissing: true }), tokenStep({ id: "a2" })])
    assert.equal(model.trendMissingCount(), 1)
    dispose()
  })

  test("keeps only the categories that some row or delta uses", () => {
    const { model, dispose, signals } = setup()
    assert.deepEqual(model.trendCategories(), ["system", "user"])
    assert.deepEqual(model.deltaCategories(), ["system", "user"])
    assert.deepEqual(model.trendLegend(), ["system", "user"])

    signals.setTrendMode("delta")
    assert.deepEqual(model.trendLegend(), ["system", "user"])

    signals.setTokenSteps([tokenStep({ id: "a1", total: 0, byCategory: zero() })])
    assert.deepEqual(model.trendCategories(), [])
    assert.deepEqual(model.deltaCategories(), [])
    dispose()
  })

  test("slices a window only while adaptive", () => {
    const { model, dispose, signals } = setup()
    assert.equal(model.trendWindowed(), undefined)

    signals.setTrendAdaptive(true)
    assert.equal(model.trendWindowed(), undefined)

    signals.setTrendWindow({ from: 1, to: 2 })
    assert.deepEqual(model.trendWindowed()?.rows.map((row) => row.id), ["a2", "a3"])
    assert.equal(model.trendWindowed()?.deltas.length, 2)

    signals.setTrendAdaptive(false)
    assert.equal(model.trendWindowed(), undefined)
    dispose()
  })

  test("takes the maxima from the window when it is shown", () => {
    const { model, dispose, signals } = setup()
    assert.deepEqual(model.trendMaxima(), { maxTotal: 100, maxUp: 100, maxDown: 1 })

    signals.setTrendAdaptive(true)
    signals.setTrendWindow({ from: 0, to: 0 })
    signals.setTokenSteps([
      tokenStep({ id: "a1", total: 50, byCategory: { ...zero(), system: 50 } }),
      tokenStep({ id: "a2", total: 90, byCategory: { ...zero(), system: 90 } }),
    ])
    assert.equal(model.trendMaxima().maxTotal, 50)
    dispose()
  })

  test("measures both up and down deltas", () => {
    const { model, dispose, signals } = setup()
    signals.setTokenSteps([
      tokenStep({ id: "a1", total: 50, byCategory: { ...zero(), system: 50 } }),
      tokenStep({ id: "a2", total: 80, byCategory: { ...zero(), system: 30 } }),
    ])
    const maxima = model.trendMaxima()
    assert.equal(maxima.maxUp, 50)
    assert.equal(maxima.maxDown, 20)
    assert.equal(maxima.maxTotal, 80)
    dispose()
  })

  test("takes the longest duration from the window when it is shown", () => {
    const { model, dispose, signals } = setup()
    assert.equal(model.trendMaxDuration(), 1000)
    assert.equal(model.trendDurationLabels().at(-1), "0")

    signals.setTrendAdaptive(true)
    signals.setTrendWindow({ from: 2, to: 2 })
    signals.setTokenSteps([
      tokenStep({ id: "a1", duration: 9000 }),
      tokenStep({ id: "a2", duration: 100 }),
      tokenStep({ id: "a3", duration: 250 }),
    ])
    assert.equal(model.trendMaxDuration(), 250)
    dispose()
  })

  test("falls back to one when no row reports a duration", () => {
    const { model, dispose, signals } = setup()
    signals.setTokenSteps([tokenStep({ id: "a1", duration: undefined })])
    assert.equal(model.trendMaxDuration(), 1)
    dispose()
  })

  test("sizes the chart from the row count", () => {
    const { model, dispose, signals } = setup()
    assert.deepEqual(model.trendWidth(), 3 * (18 + 4) - 4)
    signals.setTokenSteps([])
    assert.equal(model.trendWidth(), 1)
    dispose()
  })

  test("selects a row by id, then by the selected step's turn", () => {
    const { model, dispose, signals } = setup()
    assert.equal(model.trendSelected(), undefined)

    signals.setSelectedID("a2")
    assert.equal(model.trendSelected()?.id, "a2")

    signals.setSelectedID(undefined)
    signals.setSelectedStep(step({ id: "a9", turn: 2 }))
    assert.equal(model.trendSelected(), undefined)

    signals.setGranularity("turn")
    assert.equal(model.trendSelected()?.turn, 2)

    signals.setSelectedStep(undefined)
    assert.equal(model.trendSelected(), undefined)
    dispose()
  })

  test("activates the hovered, selected or last row", () => {
    const { model, dispose, signals } = setup()
    assert.equal(model.trendActive()?.id, "a3")

    signals.setSelectedID("a1")
    assert.equal(model.trendActive()?.id, "a1")

    signals.setTrendHover("a2")
    assert.equal(model.trendActive()?.id, "a2")

    signals.setTokenSteps([])
    assert.equal(model.trendActive(), undefined)
    dispose()
  })

  test("labels a turn row and a step row with its turn's step count", () => {
    const { model, dispose, signals } = setup()
    assert.equal(model.trendRowLabel(tokenTurn({ turn: 2, steps: 4 })), "trend.turnLabel:turn=2,steps=4")
    assert.equal(model.trendRowLabel(tokenStep({ turn: 1, step: 2 })), "trend.stepLabel:turn=1,step=2,steps=3")

    signals.setTurnStepCounts(new Map())
    assert.equal(model.trendRowLabel(tokenStep({ turn: 9, step: 2 })), "trend.stepLabel:turn=9,step=2,steps=2")
    dispose()
  })

  test("places the ribbon marker at the active index", () => {
    const { model, dispose, signals } = setup()
    assert.equal(model.trendActiveIndex(), 2)
    assert.equal(model.trendRibbonMarker(), 1000)

    signals.setSelectedID("a1")
    assert.equal(model.trendRibbonMarker(), 0)

    signals.setTokenSteps([tokenStep({ id: "only" })])
    assert.equal(model.trendRibbonMarker(), 500)

    signals.setTokenSteps([])
    assert.equal(model.trendActiveIndex(), -1)
    assert.equal(model.trendRibbonMarker(), undefined)
    dispose()
  })

  test("norms the active delta and answers zero without one", () => {
    const { model, dispose, signals } = setup()
    signals.setSelectedID("a1")
    assert.equal(model.trendActiveNet(), 100)

    signals.setTokenSteps([tokenStep({ id: "a1", byCategory: { ...zero(), system: 30 }, total: 30 })])
    assert.equal(model.trendActiveNet(), 30)

    signals.setTokenSteps([])
    assert.equal(model.trendActiveDelta(), undefined)
    assert.equal(model.trendActiveNet(), 0)
    dispose()
  })

  test("finds the step behind the active row and its cache rate", () => {
    const { model, dispose, signals } = setup()
    assert.equal(model.trendActiveStep()?.id, "a3")
    assert.equal(model.trendCacheRate(), "25.00%")

    signals.setSteps([step({ id: "a3", cacheRead: 100 })])
    assert.equal(model.trendCacheRate(), "100.00%")

    signals.setSteps([])
    assert.equal(model.trendActiveStep(), undefined)
    assert.equal(model.trendCacheRate(), "—")
    dispose()
  })

  test("builds the brief once per row and clears with the log length", () => {
    const { model, dispose, signals } = setup()
    signals.setSelectedID("a1")
    const brief = model.trendBrief()
    assert.equal(brief?.opener?.id, "u1")

    // Same active row: the cached brief comes back by identity.
    assert.equal(model.trendBrief(), brief)

    // A new message list length drops the cache.
    signals.setMessageList([...messages])
    assert.equal(model.trendBrief(), brief)

    signals.setSelectedID("missing")
    signals.setTokenSteps([])
    assert.equal(model.trendBrief(), undefined)

    model.clearBriefCache()
    assert.equal(model.trendBrief(), undefined)
    dispose()
  })

  test("groups consecutive rows by turn", () => {
    const { model, dispose } = setup()
    assert.deepEqual(model.trendGroups(), [
      { turn: 1, from: 0, count: 1, id: "a1" },
      { turn: 2, from: 1, count: 2, id: "a3" },
    ])
    dispose()
  })

  test("draws duration lines only for runs of two or more rows", () => {
    const { model, dispose, signals } = setup()
    assert.deepEqual(model.trendDurationLines().length, 1)

    signals.setTokenSteps([
      tokenStep({ id: "a1", duration: 500 }),
      tokenStep({ id: "a2", duration: undefined }),
      tokenStep({ id: "a3", duration: 250 }),
      tokenStep({ id: "a4", duration: 100 }),
    ])
    assert.equal(model.trendDurationLines().length, 1)
    assert.equal(model.trendDurationLines()[0].split(" ").length, 2)
    dispose()
  })

  test("labels the axis differently for total and delta modes", () => {
    const { model, dispose, signals } = setup()
    const total = model.trendAxisLabels()
    assert.equal(total.length, 5)
    assert.equal(total.at(-1), "0")
    assert.equal(total[0], "100")

    signals.setTrendMode("delta")
    const delta = model.trendAxisLabels()
    assert.equal(delta.length, 5)
    assert.match(delta[0], /^\+/)
    assert.match(delta[3], /^-/)
    dispose()
  })

  test("labels the ribbon axis from the up maximum in delta mode", () => {
    const { model, dispose, signals } = setup()
    assert.equal(model.trendRibbonAxisLabels()[0], "100")

    signals.setTrendMode("delta")
    assert.equal(model.trendRibbonAxisLabels()[0], "100")

    signals.setTokenSteps([tokenStep({ id: "a1", total: 0, byCategory: zero() })])
    assert.equal(model.trendRibbonAxisLabels()[0], "1")
    dispose()
  })

  test("builds the ribbon from totals and from positive deltas", () => {
    const { model, dispose, signals } = setup()
    const total = model.trendRibbon()
    assert.deepEqual(total.polygons.map((polygon) => polygon.category), ["system", "user"])
    assert.equal(total.max, 100)

    signals.setTrendMode("delta")
    const delta = model.trendRibbon()
    assert.deepEqual(delta.polygons.map((polygon) => polygon.category), ["system", "user"])

    signals.setTokenSteps([])
    assert.deepEqual(model.trendRibbon(), { polygons: [], max: 1 })
    dispose()
  })
})
