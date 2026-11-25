import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { TrendSectionProps } from "../../../src/client/components/trendSection.tsx"
import { TrendSection } from "../../../src/client/components/trendSection.tsx"
import type { StepRow } from "../../../src/shared/report.ts"
import { TREND_GAP, TREND_HEIGHT, TREND_PITCH } from "../../../src/client/styleMetrics.ts"
import {
  brief,
  briefEntry,
  makeTrendFixture,
  makeTrendUi,
  stepRow,
  trendRow,
  zeroDelta,
  type TrendFixtureOptions,
} from "../helpers/trendUi.ts"
import { mount } from "../helpers/mount.tsx"

function setup(options: TrendFixtureOptions & { steps?: StepRow[]; turns?: number; attachTrendScroll?: (el: HTMLDivElement) => void } = {}) {
  const { ui, calls, signals } = makeTrendUi()
  const steps = options.steps ?? [stepRow()]
  const trend = makeTrendFixture({ ...options, steps, hover: options.hover ?? ui.trendHover })
  const props = {
    session: { steps: () => steps, turnCount: () => options.turns ?? 2 },
    trend,
    timing: {},
    browser: {},
    ui,
    attachTrendScroll: options.attachTrendScroll ?? (() => {}),
    attachTimingScroll: () => {},
    attachBrowserAnchor: () => {},
    attachBrowserSelect: () => {},
    measureTrendWindow: () => {},
    measureTimingWindow: () => {},
    refreshTrendWindow: () => {
      calls.refreshTrendWindow += 1
    },
    refreshTimingWindow: () => {
      calls.refreshTimingWindow += 1
    },
    scrollToBrowser: () => {
      calls.scrollToBrowser += 1
    },
  } as unknown as TrendSectionProps
  const mounted = mount(() => <TrendSection {...props} />)
  return { ...mounted, ui, calls, signals, steps }
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll<HTMLButtonElement>(".oc-segment-btn")].find((node) => node.textContent === label)
  assert.ok(found, `missing ${label} button`)
  return found
}

function click(node: Element): void {
  node.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}

describe("TrendSection", () => {
  test("renders the empty state and the missing-snapshot warning", () => {
    const { container, dispose } = setup({ rows: [], steps: [], turns: 0, missing: 2 })

    assert.equal(container.querySelector(".oc-section-title")?.textContent, "Trend")
    assert.match(container.textContent ?? "", /0 turns · 0 steps/)
    assert.match(container.textContent ?? "", /No steps yet\./)
    assert.match(container.querySelector(".oc-text-warn")?.textContent ?? "", /2 steps lack system\/tools snapshots/)
    assert.equal(container.querySelector(".oc-trend-scroll"), null)
    assert.equal(container.querySelector(".oc-legend"), null)
    assert.equal(container.querySelector(".oc-trend-detail"), null)
    dispose()
  })

  test("renders the active step detail with totals, wait and cache", () => {
    const rows = [
      trendRow({ id: "a1", turn: 1, step: 1, prompt: 120, output: 30, total: 150, byCategory: { ...zeroDelta(), system: 100, user: 50 } }),
      trendRow({
        id: "a2",
        turn: 2,
        step: 1,
        prompt: 200,
        output: 40,
        total: 240,
        wait: 500,
        delegation: 400,
        headerMissing: true,
        byCategory: { ...zeroDelta(), system: 200, tools: 40 },
      }),
    ]
    const steps = [stepRow({ id: "a1" }), stepRow({ id: "a2", cacheRead: 80, cacheWrite: 20 })]
    const { container, dispose } = setup({ rows, steps, cacheRate: "40.00%" })

    const detail = container.querySelector(".oc-trend-detail")!
    assert.equal(detail.querySelector(".oc-trend-meta b")?.textContent, "T2 S1")
    assert.match(detail.querySelector(".oc-trend-meta")?.textContent ?? "", /≈240 tokens/)
    assert.match(detail.querySelector(".oc-trend-meta")?.textContent ?? "", /excludes 500ms user wait/)
    assert.match(detail.querySelector(".oc-trend-meta")?.textContent ?? "", /excludes 400ms subagent wait/)
    assert.match(detail.querySelector(".oc-trend-meta")?.textContent ?? "", /no system\/tools snapshot/)
    assert.match(detail.querySelector(".oc-trend-meta")?.textContent ?? "", /1\.0s/)

    const heroes = [...detail.querySelectorAll(".oc-hero-block")]
    assert.equal(heroes.length, 3)
    assert.match(heroes[0].textContent ?? "", /Input200/)
    assert.match(heroes[1].textContent ?? "", /Output40/)
    assert.match(heroes[2].textContent ?? "", /Cache rate40\.00%cache 80 \/ 20/)

    const chips = [...detail.querySelectorAll(".oc-chip")]
    assert.equal(chips.length, 2)
    assert.equal(chips[0].querySelector(".oc-chip-name")?.textContent, "System Prompt")
    assert.equal(chips[0].querySelector(".oc-chip-value")?.textContent, "200")
    assert.equal(chips[1].querySelector(".oc-chip-name")?.textContent, "Tool Schemas")
    assert.match(chips[1].textContent ?? "", /17%/)
    assert.match(container.querySelector(".oc-text-warn")?.textContent ?? "", /1 steps lack/)
    dispose()
  })

  test("omits the per-step cache figures when the step row is unknown", () => {
    const { container, dispose } = setup({ rows: [trendRow({ id: "a9" })], steps: [] })

    const third = container.querySelectorAll(".oc-hero-block")[2]
    assert.match(third.textContent ?? "", /Cache rate50\.0%/)
    assert.doesNotMatch(third.textContent ?? "", /cache /)
    dispose()
  })

  test("toggles adaptive, overview, duration, granularity and mode", () => {
    const { container, ui, calls, dispose } = setup({ durationLines: ["10,20 30,40"] })

    const adaptive = button(container, "Adaptive")
    click(adaptive)
    assert.equal(ui.trendAdaptive(), true)
    assert.equal(ui.trendOverview(), false)
    assert.equal(calls.refreshTrendWindow, 1)
    assert.ok(adaptive.classList.contains("oc-segment-btn-on"))
    click(adaptive)
    assert.equal(ui.trendAdaptive(), false)
    assert.equal(calls.refreshTrendWindow, 1)

    click(button(container, "Overview"))
    assert.equal(ui.trendOverview(), true)
    assert.ok(container.querySelector(".oc-trend-chart-box"))
    assert.equal(container.querySelector(".oc-trend-scroll"), null)
    click(button(container, "Delta"))
    assert.equal(ui.trendMode(), "delta")
    assert.equal(ui.trendAdaptive(), false)
    click(button(container, "Total"))
    click(button(container, "Overview"))
    assert.equal(ui.trendOverview(), false)
    assert.equal(ui.trendAdaptive(), false)

    click(button(container, "Delta"))
    assert.equal(ui.trendMode(), "delta")
    assert.equal(ui.trendAdaptive(), true)
    assert.ok(button(container, "Delta").classList.contains("oc-segment-btn-on"))
    click(button(container, "Total"))
    assert.equal(ui.trendMode(), "total")

    button(container, "Turns").click()
    assert.equal(ui.granularity(), "turn")
    assert.ok(button(container, "Turns").classList.contains("oc-segment-btn-on"))
    click(button(container, "Steps"))
    assert.equal(ui.granularity(), "step")

    click(button(container, "Duration"))
    assert.equal(ui.trendDuration(), true)
    assert.ok(container.querySelector("svg.oc-trend-overlay"))
    assert.match(container.querySelector(".oc-legend")?.textContent ?? "", /Duration/)
    click(button(container, "Duration"))
    assert.equal(ui.trendDuration(), false)
    assert.equal(container.querySelector("svg.oc-trend-overlay"), null)
    dispose()
  })

  test("shows the delta detail with signed chips and net change", () => {
    const positive = { ...zeroDelta(), system: 5, user: -3 }
    const negative = { ...zeroDelta(), system: -4, user: -1 }
    const rows = [trendRow({ id: "a1", turn: 1, step: 1 }), trendRow({ id: "a2", turn: 2, step: 1 })]
    const { container, ui, dispose } = setup({ rows, deltas: [positive, negative] })

    ui.setTrendMode("delta")
    ui.hoverTrendRow("a1")

    const meta = container.querySelector(".oc-trend-meta")!
    assert.match(meta.textContent ?? "", /\+2/)
    assert.ok(meta.querySelector(".oc-text-good"))
    let chips = [...container.querySelectorAll(".oc-chip")]
    assert.equal(chips.length, 2)
    assert.equal(chips[0].querySelector(".oc-chip-name")?.textContent, "System Prompt")
    assert.equal(chips[0].querySelector(".oc-chip-value")?.textContent, "+5")
    assert.ok(chips[0].querySelector(".oc-text-good"))
    assert.equal(chips[1].querySelector(".oc-chip-value")?.textContent, "-3")
    assert.ok(chips[1].querySelector(".oc-text-bad"))

    ui.hoverTrendRow("a2")
    assert.match(container.querySelector(".oc-trend-meta")?.textContent ?? "", /-5/)
    assert.ok(container.querySelector(".oc-trend-meta .oc-text-bad"))
    chips = [...container.querySelectorAll(".oc-chip")]
    assert.equal(chips.length, 2)
    assert.ok(chips[0].querySelector(".oc-text-bad"))
    dispose()
  })

  test("treats a category missing from a delta map as unchanged", () => {
    const rows = [trendRow({ id: "p0" }), trendRow({ id: "p1", turn: 2 })]
    const partial = { system: 4 } as unknown as Record<string, number>
    const { container, ui, dispose } = setup({ rows, deltas: [{ ...zeroDelta(), system: 4 }, partial] })

    ui.setTrendMode("delta")
    const chips = [...container.querySelectorAll(".oc-chip")]
    assert.equal(chips.length, 1)
    assert.equal(chips[0].querySelector(".oc-chip-value")?.textContent, "+4")
    dispose()
  })

  test("passes the scroll container to the attach callback", () => {
    const seen: HTMLElement[] = []
    const { container, dispose } = setup({ attachTrendScroll: (el) => seen.push(el) })

    const scroll = container.querySelector<HTMLElement>(".oc-trend-scroll")!
    assert.deepEqual(seen, [scroll])
    dispose()
  })
  test("renders the windowed chart, duration overlay and scroll interactions", () => {
    const rows = [
      trendRow({ id: "r0", turn: 1, step: 1 }),
      trendRow({ id: "r1", turn: 1, step: 2 }),
      trendRow({ id: "r2", turn: 2, step: 1 }),
      trendRow({ id: "r3", turn: 2, step: 2 }),
      trendRow({ id: "r4", turn: 2, step: 3 }),
    ]
    const { container, ui, calls, signals, dispose } = setup({
      rows,
      render: { from: 2, to: 3 },
      selected: rows[2],
      legend: [],
      durationLines: ["10,20 30,40", "50,60 70,80"],
    })
    ui.setTrendDuration(true)

    const canvas = container.querySelector<HTMLElement>(".oc-trend-canvas")!
    assert.equal(canvas.style.width, `${5 * TREND_PITCH - TREND_GAP}px`)
    assert.equal(container.querySelectorAll(".oc-trend-axis:not(.oc-trend-axis-left) span").length, 5)
    assert.equal(container.querySelectorAll(".oc-trend-axis-left span").length, 5)

    const plot = container.querySelector(".oc-trend-plot")!
    assert.equal((plot.children[0] as HTMLElement).style.width, `${2 * TREND_PITCH - TREND_GAP}px`)
    assert.equal((plot.children[plot.children.length - 1] as HTMLElement).style.width, `${1 * TREND_PITCH - TREND_GAP}px`)
    assert.equal(container.querySelectorAll(".oc-trend-bar").length, 2)
    assert.ok(container.querySelector(".oc-trend-bar")!.classList.contains("oc-trend-bar-active"))

    const overlay = container.querySelector("svg.oc-trend-overlay")!
    assert.equal(overlay.getAttribute("viewBox"), `0 0 ${5 * TREND_PITCH - TREND_GAP} ${TREND_HEIGHT}`)
    assert.equal(overlay.querySelectorAll("polyline").length, 4)

    const scroll = container.querySelector<HTMLElement>(".oc-trend-scroll")!
    scroll.dispatchEvent(new Event("scroll"))
    assert.deepEqual(calls.rememberChartScroll, ["trend"])
    assert.equal(calls.measureTrendWindow.length, 1)
    scroll.dispatchEvent(new MouseEvent("mouseleave"))
    assert.equal(calls.hoverTrendRow.at(-1), undefined)

    const firstBar = container.querySelector(".oc-trend-bar")!
    firstBar.dispatchEvent(new MouseEvent("mouseenter"))
    assert.equal(calls.hoverTrendRow.at(-1), "r2")
    click(firstBar)
    assert.equal(calls.selectStep.at(-1), "r2")

    const segment = firstBar.querySelector<HTMLElement>(".oc-trend-chart-up > div")!
    click(segment)
    assert.equal(calls.selectStep.at(-1), "r2")
    assert.deepEqual(calls.setBrowserFlat, [false])
    assert.deepEqual(calls.setBrowserOpen, ["system"])
    assert.deepEqual(calls.setBrowserRowQuery, [""])
    assert.equal(calls.scrollToBrowser, 1)

    const turns = [...container.querySelectorAll<HTMLButtonElement>(".oc-trend-turn")]
    assert.equal(turns.length, 2)
    assert.equal(turns[0].title, "Turn 1 · 2 steps")
    signals.setTurnStepCounts(new Map([[1, 7]]))
    assert.equal(turns[0].title, "Turn 1 · 7 steps")
    turns[0].dispatchEvent(new MouseEvent("mouseenter"))
    assert.equal(calls.hoverTrendRow.at(-1), "r1")
    click(turns[0])
    assert.equal(calls.selectStep.at(-1), "r1")
    assert.ok(turns[0].classList.contains("oc-trend-turn-active"))
    turns[0].parentElement!.dispatchEvent(new MouseEvent("mouseleave"))
    assert.equal(calls.hoverTrendRow.at(-1), undefined)
    dispose()
  })

  test("hides the duration overlay until lines are available", () => {
    const { container, ui, dispose } = setup({ legend: [], durationLines: [] })
    ui.setTrendDuration(true)

    assert.equal(container.querySelector("svg.oc-trend-overlay"), null)
    assert.match(container.querySelector(".oc-legend")?.textContent ?? "", /Duration/)
    assert.equal(container.querySelectorAll(".oc-legend-item").length, 1)
    dispose()
  })

  test("renders the overview ribbon, marker, compaction lines and pointer events", () => {
    const rows = [
      trendRow({ id: "o1", turn: 1, step: 1 }),
      trendRow({ id: "o2", turn: 2, step: 1, total: 240, afterCompaction: true }),
    ]
    const { container, ui, calls, dispose } = setup({
      rows,
      legend: [],
      marker: 500,
      ribbon: {
        polygons: [
          { category: "system", points: "0,0 1,1 2,2" },
          { category: "user", points: "2,2 3,3 4,4" },
        ],
        max: 240,
      },
    })
    ui.setTrendOverview(true)

    const svg = container.querySelector<SVGSVGElement>("svg.oc-trend-chart-box")!
    assert.ok(svg)
    assert.match(container.textContent ?? "", /whole session · 2 bars · max ≈240/)

    const polygons = [...svg.querySelectorAll("polygon")]
    assert.equal(polygons.length, 2)
    assert.equal(polygons[0].getAttribute("fill"), "#5b8def")
    assert.equal(polygons[0].getAttribute("opacity"), "0.85")
    assert.equal(polygons[1].getAttribute("opacity"), "0.85")
    polygons[0].dispatchEvent(new MouseEvent("mouseenter"))
    assert.equal(polygons[0].getAttribute("opacity"), "0.85")
    assert.equal(polygons[1].getAttribute("opacity"), "0.25")
    polygons[1].dispatchEvent(new MouseEvent("mouseleave"))
    assert.equal(polygons[1].getAttribute("opacity"), "0.85")

    const marker = svg.querySelector('line[opacity="0.4"]')!
    assert.equal(marker.getAttribute("x1"), "500")
    const compaction = svg.querySelector('line[stroke="#c9a227"]')!
    assert.equal(compaction.getAttribute("x1"), "1000")
    assert.equal(svg.querySelectorAll('line[stroke="currentColor"][opacity="0.15"]').length, 4)

    svg.dispatchEvent(new MouseEvent("mousemove", { clientX: 1, bubbles: true }))
    assert.equal(calls.hoverTrendRow.at(-1), "o2")
    svg.dispatchEvent(new MouseEvent("mousemove", { clientX: -5, bubbles: true }))
    assert.equal(calls.hoverTrendRow.at(-1), undefined)
    svg.dispatchEvent(new MouseEvent("click", { clientX: 1, bubbles: true }))
    assert.equal(calls.selectStep.at(-1), "o2")
    const before = calls.selectStep.length
    svg.dispatchEvent(new MouseEvent("click", { clientX: -5, bubbles: true }))
    assert.equal(calls.selectStep.length, before)
    svg.dispatchEvent(new MouseEvent("mouseleave"))
    assert.equal(calls.hoverTrendRow.at(-1), undefined)
    dispose()
  })

  test("centers the compaction line and marker on a single-bar overview", () => {
    const rows = [trendRow({ id: "only", afterCompaction: true })]
    const { container, ui, dispose } = setup({ rows })
    ui.setTrendOverview(true)

    const svg = container.querySelector("svg.oc-trend-chart-box")!
    assert.equal(svg.querySelector('line[stroke="#c9a227"]')?.getAttribute("x1"), "500")
    assert.equal(svg.querySelector('line[opacity="0.4"]')?.getAttribute("x1"), "0")
    assert.equal(svg.querySelectorAll('line[stroke="#c9a227"]').length, 1)
    dispose()
  })

  test("falls back to the first slot when a bar is missing from the index", () => {
    const rows = [trendRow({ id: "m0" }), trendRow({ id: "m1", turn: 2 })]
    const deltas = [{ ...zeroDelta(), system: 4 }, { ...zeroDelta(), system: 60 }]
    const { container, ui, dispose } = setup({ rows, deltas, indexOf: () => new Map() })

    ui.setTrendMode("delta")
    const heights = [...container.querySelectorAll(".oc-trend-chart-upper > div")].map((node) => (node as HTMLElement).style.height)
    assert.equal(heights.length, 2)
    assert.equal(heights[0], heights[1])
    dispose()
  })

  test("renders the brief chips, their overflow counts and click targets", () => {
    const inputs = Array.from({ length: 8 }, (_, index) => briefEntry({ id: `i${index}`, name: `in${index}` }))
    const response = Array.from({ length: 7 }, (_, index) => briefEntry({ id: `r${index}`, name: `out${index}` }))
    const { container, calls, dispose } = setup({ rows: [trendRow({ id: "a1" })], brief: brief({ inputs, response }) })

    const rows = [...container.querySelectorAll(".oc-brief-row")]
    assert.equal(rows.length, 3)
    assert.match(rows[0].textContent ?? "", /Userinspect the repo/)
    assert.equal(rows[0].querySelectorAll(".oc-brief-chip").length, 1)
    assert.equal(rows[1].querySelectorAll(".oc-brief-chip").length, 6)
    assert.match(rows[1].querySelector(".oc-faint")?.textContent ?? "", /^\+2$/)
    assert.equal(rows[2].querySelectorAll(".oc-brief-chip").length, 6)
    assert.match(rows[2].querySelector(".oc-faint")?.textContent ?? "", /^\+1$/)

    click(rows[0].querySelector(".oc-brief-chip")!)
    click(rows[1].querySelector(".oc-brief-chip")!)
    click(rows[2].querySelectorAll(".oc-brief-chip")[5])
    assert.deepEqual(calls.focusBrief, [
      ["e1", "a1", false],
      ["i0", "a1", false],
      ["r5", "a1", true],
    ])
    dispose()
  })

  test("falls back to empty brief rows and hides the brief when absent", () => {
    const empty = setup({ rows: [trendRow()], brief: brief({ opener: undefined, inputs: [], response: [] }) })
    const rows = [...empty.container.querySelectorAll(".oc-brief-row")]
    assert.equal(rows.length, 3)
    assert.equal(rows[0].querySelectorAll(".oc-brief-chip").length, 0)
    assert.match(rows[1].textContent ?? "", /Nothing new at this step\./)
    assert.match(rows[2].textContent ?? "", /No response captured\./)
    empty.dispose()

    const absent = setup({ rows: [trendRow()] })
    assert.equal(absent.container.querySelector(".oc-trend-brief"), null)
    absent.dispose()
  })
})
