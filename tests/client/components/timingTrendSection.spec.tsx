import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { TimingTrendSectionProps } from "../../../src/client/components/timingTrendSection.tsx"
import { TimingTrendSection } from "../../../src/client/components/timingTrendSection.tsx"
import type { StepRow } from "../../../src/shared/report.ts"
import { TREND_BAR, TREND_GAP, TREND_HEIGHT, TREND_PITCH } from "../../../src/client/styleMetrics.ts"
import {
  makeTimingFixture,
  makeTrendUi,
  stepRow,
  stepTimingRow,
  turnTimingRow,
  type TimingFixtureOptions,
} from "../helpers/trendUi.ts"
import { mount } from "../helpers/mount.tsx"

function setup(options: TimingFixtureOptions & { steps?: StepRow[]; turns?: number } = {}) {
  const { ui, calls, signals } = makeTrendUi()
  const steps = options.steps ?? [stepRow()]
  const rows = options.rows ?? [stepTimingRow()]
  const timing = makeTimingFixture({ ...options, rows, hover: options.hover ?? ui.timingHover })
  const props = {
    session: { steps: () => steps, turnCount: () => options.turns ?? 2 },
    timing,
    trend: {},
    browser: {},
    ui,
    attachTrendScroll: () => {},
    attachTimingScroll: options.attachTimingScroll ?? (() => {}),
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
  } as unknown as TimingTrendSectionProps
  const mounted = mount(() => <TimingTrendSection {...props} />)
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

describe("TimingTrendSection", () => {
  test("renders the empty state and the wall-time hint", () => {
    const { container, dispose } = setup({ rows: [], steps: [], turns: 0 })

    assert.equal(container.querySelector(".oc-section-title")?.textContent, "Timing trend")
    assert.match(container.textContent ?? "", /0 turns · 0 steps/)
    assert.match(container.textContent ?? "", /total 1m00s/)
    assert.match(container.textContent ?? "", /No timing yet\./)
    assert.equal(container.querySelector(".oc-trend-scroll"), null)
    assert.equal(container.querySelector(".oc-trend-detail"), null)
    dispose()
  })

  test("renders the step detail, chips and hover clock", () => {
    const rows = [
      stepTimingRow({ id: "a1", turn: 1, step: 1, question: 250, delegation: 200, wall: 1500, output: 90, decoded: 90, rate: 60 }),
      stepTimingRow({ id: "a2", turn: 2, step: 1 }),
    ]
    const { container, ui, calls, dispose } = setup({ rows })

    ui.hoverTimingRow("a1")
    assert.equal(calls.hoverTimingRow.at(-1), "a1")

    const detail = container.querySelector(".oc-trend-detail")!
    assert.equal(detail.querySelector(".oc-trend-meta b")?.textContent, "T1 S1")
    assert.match(detail.querySelector(".oc-trend-meta .oc-faint")?.textContent ?? "", /^\d{2}-\d{2} \d{2}:\d{2}$/)
    assert.match(detail.textContent ?? "", /Duration1\.1s/)
    assert.match(detail.textContent ?? "", /excludes 250ms user wait/)
    assert.match(detail.textContent ?? "", /excludes 200ms subagent wait/)
    assert.match(detail.textContent ?? "", /Output speed60 tok\/s/)
    assert.match(detail.textContent ?? "", /90 output/)

    const chips = [...detail.querySelectorAll(".oc-chip")]
    assert.equal(chips.length, 2)
    assert.match(chips[0].textContent ?? "", /TTFT100ms7%/)
    assert.match(chips[1].textContent ?? "", /User wait50ms3%/)
    dispose()
  })

  test("renders a turn row without a clock and with the turn label", () => {
    const { container, dispose } = setup({ rows: [turnTimingRow({ turn: 3, steps: 4 })] })

    const detail = container.querySelector(".oc-trend-detail")!
    assert.equal(detail.querySelector(".oc-trend-meta b")?.textContent, "T3 · 4 steps")
    assert.equal(detail.querySelector(".oc-trend-meta .oc-faint"), null)
    assert.doesNotMatch(detail.textContent ?? "", /user wait/)
    dispose()
  })

  test("toggles adaptive, overview and granularity", () => {
    const { container, ui, calls, signals, dispose } = setup({ rows: [stepTimingRow(), stepTimingRow({ id: "a2", turn: 2, step: 1 })] })

    const adaptive = button(container, "Adaptive")
    click(adaptive)
    assert.equal(ui.timingAdaptive(), true)
    assert.equal(ui.timingOverview(), false)
    assert.equal(calls.refreshTimingWindow, 1)
    assert.ok(adaptive.classList.contains("oc-segment-btn-on"))
    click(adaptive)
    assert.equal(ui.timingAdaptive(), false)
    assert.equal(calls.refreshTimingWindow, 1)

    click(button(container, "Adaptive"))
    click(button(container, "Overview"))
    assert.equal(ui.timingOverview(), true)
    assert.equal(ui.timingAdaptive(), false)
    assert.equal(container.querySelector(".oc-trend-scroll"), null)
    assert.ok(container.querySelector("svg.oc-trend-chart-box"))
    click(button(container, "Overview"))
    assert.equal(ui.timingOverview(), false)
    assert.equal(ui.timingAdaptive(), false)

    signals.setTimingWall(90_000)
    assert.match(container.querySelector(".oc-hint")?.textContent ?? "", /total 1m30s/)

    button(container, "Turns").click()
    assert.equal(ui.timingGranularity(), "turn")
    assert.ok(button(container, "Turns").classList.contains("oc-segment-btn-on"))
    click(button(container, "Steps"))
    assert.equal(ui.timingGranularity(), "step")
    dispose()
  })

  test("passes the timing scroll container to the attach callback", () => {
    const seen: HTMLElement[] = []
    const { container, dispose } = setup({ attachTimingScroll: (el) => seen.push(el) })

    const scroll = container.querySelector<HTMLElement>(".oc-trend-scroll")!
    assert.deepEqual(seen, [scroll])
    dispose()
  })

  test("renders windowed bars, segments and their interactions", () => {
    const rows = [
      stepTimingRow({ id: "r0", turn: 1, step: 1 }),
      stepTimingRow({ id: "r1", turn: 1, step: 2, question: 100 }),
      stepTimingRow({ id: "r2", turn: 2, step: 1 }),
      stepTimingRow({ id: "r3", turn: 2, step: 2 }),
      stepTimingRow({ id: "r4", turn: 2, step: 3 }),
    ]
    const { container, ui, calls, signals, dispose } = setup({
      rows,
      render: { from: 1, to: 2 },
      groupSteps: (group) => (group.turn === 1 ? 9 : group.count),
    })
    ui.setSelectedStep({ id: "r2", turn: 2 })

    const canvas = container.querySelector<HTMLElement>(".oc-trend-canvas")!
    assert.equal(canvas.style.width, `${5 * (TREND_BAR + TREND_GAP)}px`)
    assert.equal(container.querySelectorAll(".oc-trend-axis span").length, 3)

    const plot = container.querySelector(".oc-trend-plot")!
    assert.equal((plot.children[0] as HTMLElement).style.width, `${1 * TREND_PITCH - TREND_GAP}px`)
    assert.equal((plot.children[plot.children.length - 1] as HTMLElement).style.width, `${2 * TREND_PITCH - TREND_GAP}px`)

    const bars = [...container.querySelectorAll<HTMLButtonElement>(".oc-trend-bar")]
    assert.equal(bars.length, 2)
    assert.match(bars[0].title, /T1 S2 · 1\.1s \(excludes 100ms user wait\) · 100 tok\/s/)
    assert.doesNotMatch(bars[1].title, /user wait/)
    assert.ok(bars[1].classList.contains("oc-trend-bar-active"))

    const segment = bars[0].querySelector<HTMLElement>(".oc-trend-bar-stack > div")!
    assert.equal(segment.style.backgroundColor, "rgb(17, 17, 17)")
    assert.ok(parseFloat(segment.style.height) > 0)

    bars[0].dispatchEvent(new MouseEvent("mouseenter"))
    assert.equal(calls.hoverTimingRow.at(-1), "r1")
    assert.ok(bars[0].classList.contains("oc-trend-bar-active"))
    click(bars[0])
    assert.equal(calls.hoverTimingRow.at(-1), "r1")
    assert.equal(calls.selectStep.at(-1), "r1")

    const scroll = container.querySelector<HTMLElement>(".oc-trend-scroll")!
    scroll.dispatchEvent(new Event("scroll"))
    assert.deepEqual(calls.rememberChartScroll, ["timing"])
    assert.equal(calls.measureTimingWindow.length, 1)
    scroll.dispatchEvent(new MouseEvent("mouseleave"))
    assert.equal(calls.hoverTimingRow.at(-1), undefined)

    const groups = [...container.querySelectorAll<HTMLButtonElement>(".oc-trend-turn")]
    assert.equal(groups.length, 2)
    assert.equal(groups[0].title, "Turn 1 · 2 steps")
    ui.setTimingGranularity("turn")
    assert.equal(groups[0].title, "Turn 1 · 9 steps")
    groups[0].dispatchEvent(new MouseEvent("mouseenter"))
    assert.equal(calls.hoverTimingRow.at(-1), "r1")
    click(groups[0])
    assert.equal(calls.selectStep.at(-1), "r1")
    groups[0].parentElement!.dispatchEvent(new MouseEvent("mouseleave"))
    assert.equal(calls.hoverTimingRow.at(-1), undefined)

    signals.setTimingHover(undefined)
    ui.setSelectedStep({ id: "missing", turn: 2 })
    assert.ok(groups[1].classList.contains("oc-trend-turn-active"))
    dispose()
  })

  test("selects turn bars and tolerates unmapped keys", () => {
    const rows = [turnTimingRow({ turn: 1 }), turnTimingRow({ turn: 1 })]
    const { container, ui, calls, dispose } = setup({
      rows,
      groups: [
        { turn: 1, count: 2, key: "turn:1" },
        { turn: 9, count: 1, key: "missing" },
      ],
    })
    ui.setSelectedStep({ id: "not-a-turn-row", turn: 1 })

    const bars = [...container.querySelectorAll(".oc-trend-bar")]
    assert.equal(bars.length, 2)
    assert.ok(bars[0].classList.contains("oc-trend-bar-active"))
    click(bars[0])
    assert.equal(calls.selectStep.length, 0)

    const groups = [...container.querySelectorAll(".oc-trend-turn")]
    assert.equal(groups.length, 2)
    click(groups[1])
    assert.equal(calls.selectStep.length, 0)
    dispose()
  })

  test("renders the overview ribbon and handles pointer events", () => {
    const rows = [stepTimingRow({ id: "r0" }), stepTimingRow({ id: "r1", turn: 2 }), stepTimingRow({ id: "r2", turn: 3 })]
    const { container, ui, calls, dispose } = setup({
      rows,
      marker: 500,
      ribbon: {
        polygons: [
          { key: "ttft", points: "0,0 1,1 2,2", color: "#333333" },
          { key: "tools", points: "2,2 3,3 4,4", color: "#444444" },
        ],
        max: 1200,
      },
      ribbonAxis: ["1.2s", "0.9s", "0.6s", "0.3s", "0"],
    })
    ui.setTimingOverview(true)

    const svg = container.querySelector<SVGSVGElement>("svg.oc-trend-chart-box")!
    assert.equal(container.querySelector(".oc-trend-scroll"), null)
    assert.equal(container.querySelectorAll(".oc-trend-axis-flush span").length, 5)
    const polygons = [...svg.querySelectorAll("polygon")]
    assert.equal(polygons.length, 2)
    assert.equal(polygons[0].getAttribute("fill"), "#333333")
    assert.equal(polygons[1].getAttribute("fill"), "#444444")
    assert.equal(svg.querySelector('line[opacity="0.4"]')?.getAttribute("x1"), "500")
    assert.equal(svg.querySelectorAll('line[stroke="currentColor"][opacity="0.15"]').length, 4)

    svg.dispatchEvent(new MouseEvent("mousemove", { clientX: 1, bubbles: true }))
    assert.equal(calls.hoverTimingRow.at(-1), "r2")
    svg.dispatchEvent(new MouseEvent("mousemove", { clientX: -5, bubbles: true }))
    assert.equal(calls.hoverTimingRow.at(-1), "r2")
    svg.dispatchEvent(new MouseEvent("click", { clientX: 1, bubbles: true }))
    assert.equal(calls.selectStep.at(-1), "r2")
    const before = calls.selectStep.length
    svg.dispatchEvent(new MouseEvent("click", { clientX: -5, bubbles: true }))
    assert.equal(calls.selectStep.length, before)
    svg.dispatchEvent(new MouseEvent("mouseleave"))
    assert.equal(calls.hoverTimingRow.at(-1), undefined)
    dispose()
  })

  test("defaults an unknown ribbon marker to zero", () => {
    const { container, ui, dispose } = setup({ rows: [stepTimingRow({ id: "solo" })] })
    ui.setTimingOverview(true)

    const svg = container.querySelector("svg.oc-trend-chart-box")!
    assert.equal(svg.querySelector('line[opacity="0.4"]')?.getAttribute("x1"), "0")
    assert.equal(svg.querySelector('line[opacity="0.4"]')?.getAttribute("y2"), String(TREND_HEIGHT))
    dispose()
  })
})
