import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { createRoot, createSignal } from "solid-js"
import type { SessionIndex, StepTimingRow, TurnTimingRow } from "../../../src/shared/report.ts"
import { createTimingModel } from "../../../src/client/models/timing.ts"
import { NO_SESSION_INDEX, TIMING_COLOR, type PanelView } from "../../../src/client/panelSupport.ts"

const now = Date.UTC(2026, 10, 16, 8, 41)

const t = (key: string, params?: Record<string, string>) =>
  params === undefined ? key : `${key}:${Object.entries(params).map(([name, value]) => `${name}=${value}`).join(",")}`

const stepTimingRow = (patch: Partial<StepTimingRow> = {}): StepTimingRow => ({
  id: "a1",
  at: now,
  turn: 1,
  step: 1,
  ttft: 100,
  gen: 1000,
  reasoning: 100,
  text: 600,
  toolArgs: 100,
  split: true,
  genLeftover: 200,
  reasoningBlocks: 1,
  textBlocks: 1,
  toolArgBlocks: 1,
  tool: 0,
  toolCalls: 0,
  question: 0,
  delegation: 0,
  overhead: 100,
  wall: 1200,
  output: 100,
  decoded: 100,
  decode: 1000,
  rate: 100,
  ...patch,
})

const turnRow = (patch: Partial<TurnTimingRow> = {}): TurnTimingRow => ({
  turn: 1,
  steps: 2,
  ttft: 100,
  gen: 1000,
  reasoning: 100,
  text: 600,
  toolArgs: 100,
  split: true,
  genLeftover: 200,
  reasoningBlocks: 1,
  textBlocks: 2,
  toolArgBlocks: 1,
  tool: 0,
  question: 0,
  delegation: 0,
  overhead: 100,
  wall: 1200,
  output: 100,
  decoded: 100,
  rate: 100,
  ...patch,
})

const timingId = (row: StepTimingRow | TurnTimingRow | undefined) =>
  row !== undefined && "id" in row ? row.id : undefined

function sessionIndex(stepTiming?: StepTimingRow[]): SessionIndex {
  return { ...NO_SESSION_INDEX, ...(stepTiming === undefined ? {} : { stepTiming }) }
}

function setup(overrides: Record<string, unknown> = {}) {
  const [view, setView] = createSignal<PanelView>("browser")
  const [index, setIndex] = createSignal<SessionIndex>(sessionIndex([
    stepTimingRow({ id: "a1", turn: 1, step: 1 }),
    stepTimingRow({ id: "a2", turn: 2, step: 1 }),
    stepTimingRow({ id: "a3", turn: 2, step: 2 }),
  ]))
  const [granularity, setGranularity] = createSignal<"step" | "turn">("step")
  const [window, setWindow] = createSignal<{ from: number; to: number } | undefined>(undefined)
  const [adaptive, setAdaptive] = createSignal(false)
  const [hover, setHover] = createSignal<string | undefined>(undefined)
  const [selected, setSelected] = createSignal<{ id: string; turn: number } | undefined>(undefined)
  const deps = {
    view,
    index,
    granularity,
    window,
    adaptive,
    hover,
    selected,
    ...overrides,
  }
  let dispose = () => {}
  const model = createRoot((stop) => {
    dispose = stop
    return createTimingModel({
      ctx: { t },
      view: deps.view,
      sessionIndex: deps.index,
      timingGranularity: deps.granularity,
      timingWindow: deps.window,
      timingAdaptive: deps.adaptive,
      timingHover: deps.hover,
      selectedStep: deps.selected,
    })
  })
  return {
    model,
    dispose,
    signals: {
      setView,
      setIndex,
      setGranularity,
      setWindow,
      setAdaptive,
      setHover,
      setSelected,
    },
  }
}

describe("createTimingModel", () => {
  test("reads step timing only in the browser tab", () => {
    const { model, dispose, signals } = setup()
    assert.equal(model.stepTiming().length, 3)
    assert.equal(model.turnTiming().length, 2)
    assert.equal(model.timingTrendRows().length, 3)

    signals.setView("overview")
    assert.deepEqual(model.stepTiming(), [])
    assert.deepEqual(model.turnTiming(), [])
    assert.deepEqual(model.timingTrendRows(), [])

    signals.setView("browser")
    signals.setIndex({ ...NO_SESSION_INDEX })
    assert.deepEqual(model.stepTiming(), [])
    dispose()
  })

  test("returns the row keys used by hover", () => {
    const { model, dispose } = setup()
    assert.equal(model.timingTrendKey(stepTimingRow()), "a1")
    assert.equal(model.timingTrendKey(turnRow({ turn: 3 })), "turn:3")
    dispose()
  })

  test("renders an empty window with no rows", () => {
    const { model, dispose, signals } = setup()
    signals.setIndex(sessionIndex([]))
    assert.deepEqual(model.timingRender(), { from: 0, to: -1 })
    dispose()
  })

  test("renders the last 80 rows without a window, plus the pad around a window", () => {
    const rows = Array.from({ length: 200 }, (_, index) =>
      stepTimingRow({ id: `a${index}`, turn: 1 }),
    )
    const { model, dispose, signals } = setup()
    signals.setIndex(sessionIndex(rows))
    assert.deepEqual(model.timingRender(), { from: 120, to: 199 })

    signals.setWindow({ from: 10, to: 20 })
    const rendered = model.timingRender()
    assert.ok(rendered.from < 10)
    assert.ok(rendered.to > 20)

    signals.setWindow({ from: 0, to: 500 })
    assert.deepEqual(model.timingRender(), { from: 0, to: 199 })
    dispose()
  })

  test("totals a split row from its measured slices and a plain row from gen", () => {
    const { model, dispose } = setup()
    assert.equal(
      model.timingTrendTotal(stepTimingRow()),
      100 + (100 + 600 + 100 + 200) + 0 + 0 + 100,
    )
    assert.equal(
      model.timingTrendTotal(stepTimingRow({ split: false, gen: 500, ttft: undefined, overhead: 0 })),
      500,
    )
    assert.equal(model.timingChartTotal(stepTimingRow({ question: 50 })), 1200)
    assert.equal(model.timingChartTotal(stepTimingRow({ question: 5000 })), 1200)
    assert.equal(
      model.timingChartTotal(stepTimingRow({ split: false, gen: 0, ttft: undefined, overhead: 0, tool: 0, question: 50 })),
      0,
    )
    dispose()
  })

  test("scales to every row or only the visible window", () => {
    const rows = [
      stepTimingRow({ id: "a1" }),
      stepTimingRow({ id: "a2", split: false, gen: 4000, reasoning: 0, text: 0, toolArgs: 0, genLeftover: 0 }),
    ]
    const { model, dispose, signals } = setup()
    signals.setIndex(sessionIndex(rows))
    assert.equal(model.timingTrendMax(), 4200)

    signals.setAdaptive(true)
    signals.setWindow({ from: 1, to: 1 })
    assert.equal(model.timingTrendMax(), 4200)

    signals.setWindow({ from: 0, to: 0 })
    assert.equal(model.timingTrendMax(), 1200)
    dispose()
  })

  test("splits a measured row into ordered segments and drops empty ones", () => {
    const { model, dispose } = setup()
    const split = model.timingSegmentsOf(stepTimingRow())
    assert.deepEqual(split.map((segment) => segment.key), ["ttft", "reasoning", "text", "toolArgs", "other"])
    assert.equal(split[0].color, TIMING_COLOR.ttft)
    assert.equal(split[1].color, TIMING_COLOR.reasoning)
    assert.equal(split[2].color, TIMING_COLOR.text)
    assert.equal(split[3].color, TIMING_COLOR.toolArg)

    const plain = model.timingSegmentsOf(stepTimingRow({ split: false, ttft: undefined, tool: 30, genLeftover: 0 }))
    assert.deepEqual(plain.map((segment) => segment.key), ["gen", "tools", "other"])
    assert.equal(plain[0].label, "timing.gen")

    const withWait = model.timingSegmentsOf(stepTimingRow({ question: 40 }), true)
    assert.deepEqual(withWait.map((segment) => segment.key), [
      "ttft",
      "reasoning",
      "text",
      "toolArgs",
      "question",
      "other",
    ])
    assert.equal(withWait[4].label, "timing.question")
    dispose()
  })

  test("labels a step row and a turn row", () => {
    const { model, dispose } = setup()
    assert.equal(model.timingTrendLabel(stepTimingRow({ turn: 2, step: 3 })), "timing.stepLabel:turn=2,step=3")
    assert.equal(model.timingTrendLabel(turnRow({ turn: 2, steps: 4 })), "timing.turnLabel:turn=2,steps=4")
    dispose()
  })

  test("builds the ribbon order from the segments present", () => {
    const { model, disposeCSignals } = (() => {
      const value = setup()
      return { model: value.model, disposeCSignals: value.dispose }
    })()
    const ribbon = model.timingRibbon()
    assert.equal(ribbon.max, 1200)
    assert.deepEqual(ribbon.polygons.map((polygon) => polygon.key), ["ttft", "reasoning", "text", "toolArgs", "other"])
    const colors = new Map(ribbon.polygons.map((polygon) => [polygon.key, polygon.color]))
    assert.equal(colors.get("ttft"), TIMING_COLOR.ttft)
    assert.equal(colors.get("reasoning"), TIMING_COLOR.reasoning)
    assert.equal(colors.get("text"), TIMING_COLOR.text)
    assert.equal(colors.get("toolArgs"), TIMING_COLOR.toolArg)
    assert.equal(colors.get("other"), TIMING_COLOR.other)
    disposeCSignals()
  })

  test("builds the ribbon for the remaining bands and skips empty ones", () => {
    const { model, dispose, signals } = setup()
    // No ttft, a split row whose slices are all zero, and a plain row with only gen.
    signals.setIndex(sessionIndex([
      stepTimingRow({ id: "a1", ttft: undefined, reasoning: 0, text: 0, toolArgs: 0, tool: 0, genLeftover: 0, overhead: 0 }),
      stepTimingRow({ id: "a2", ttft: undefined, split: false, gen: 5, reasoning: 0, text: 0, toolArgs: 0, tool: 0, genLeftover: 0, overhead: 0 }),
    ]))
    assert.deepEqual(model.timingRibbon().polygons.map((polygon) => polygon.key), ["gen"])
    assert.equal(model.timingRibbon().max, 5)

    signals.setIndex(sessionIndex([stepTimingRow({ split: false, ttft: 0, gen: 0, tool: 5, overhead: 0 })]))
    signals.setGranularity("turn")
    assert.deepEqual(model.timingRibbon().polygons.map((polygon) => polygon.key), ["tools"])

    signals.setIndex(sessionIndex([]))
    assert.deepEqual(model.timingRibbon(), { polygons: [], max: 1 })
    assert.deepEqual(model.timingRibbonAxis(), ["1ms", "1ms", "1ms", "0ms", "0"])
    dispose()
  })

  test("labels the ribbon axis in quarters of the maximum", () => {
    const { model, dispose } = setup()
    const axis = model.timingRibbonAxis()
    assert.equal(axis.length, 5)
    assert.equal(axis.at(-1), "0")
    assert.equal(new Set(axis).size, 5)
    dispose()
  })

  test("groups consecutive rows by turn and keeps the last key", () => {
    const { model, dispose, signals } = setup()
    assert.deepEqual(model.timingTrendGroups(), [
      { turn: 1, count: 1, key: "a1" },
      { turn: 2, count: 2, key: "a3" },
    ])

    signals.setGranularity("turn")
    assert.deepEqual(model.timingTrendGroups(), [
      { turn: 1, count: 1, key: "turn:1" },
      { turn: 2, count: 1, key: "turn:2" },
    ])
    dispose()
  })

  test("selects the hovered, selected or last row", () => {
    const { model, dispose, signals } = setup()
    assert.equal(timingId(model.timingTrendActive()), "a3")

    signals.setSelected({ id: "a1", turn: 1 })
    assert.equal(timingId(model.timingTrendActive()), "a1")

    signals.setHover("a2")
    assert.equal(timingId(model.timingTrendActive()), "a2")

    signals.setSelected({ id: "missing", turn: 9 })
    signals.setHover(undefined)
    assert.equal(timingId(model.timingTrendActive()), "a3")

    signals.setGranularity("turn")
    signals.setSelected({ id: "a1", turn: 2 })
    assert.equal(model.timingTrendActive()?.turn, 2)

    signals.setGranularity("step")
    signals.setSelected(undefined)
    signals.setIndex(sessionIndex([]))
    assert.equal(model.timingTrendActive(), undefined)
    dispose()
  })

  test("picks the selected turn row or step row", () => {
    const { model, dispose, signals } = setup()
    assert.equal(model.timingSelected(), undefined)

    signals.setSelected({ id: "a2", turn: 2 })
    assert.equal(timingId(model.timingSelected()), "a2")

    signals.setGranularity("turn")
    assert.equal(model.timingSelected()?.turn, 2)
    dispose()
  })

  test("counts the steps behind a turn group", () => {
    const { model, dispose, signals } = setup()
    assert.equal(model.timingGroupSteps({ turn: 1, count: 7 }), 7)

    signals.setGranularity("turn")
    assert.equal(model.timingGroupSteps({ turn: 2, count: 7 }), 2)
    assert.equal(model.timingGroupSteps({ turn: 9, count: 7 }), 7)
    dispose()
  })

  test("places the ribbon marker at the active index", () => {
    const { model, dispose, signals } = setup()
    assert.equal(model.timingTrendActiveIndex(), 2)
    assert.equal(model.timingRibbonMarker(), 1000)

    signals.setSelected({ id: "a1", turn: 1 })
    assert.equal(model.timingRibbonMarker(), 0)

    signals.setIndex(sessionIndex([stepTimingRow({ id: "only" })]))
    assert.equal(model.timingRibbonMarker(), 500)

    signals.setIndex(sessionIndex([]))
    assert.equal(model.timingTrendActiveIndex(), -1)
    assert.equal(model.timingRibbonMarker(), undefined)
    dispose()
  })
})
