import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { Category } from "../../../src/shared/estimate.ts"
import type { TokenStepRow } from "../../../src/shared/tokens.ts"
import { TrendChartBar } from "../../../src/client/components/trendChart.tsx"
import { TREND_HEIGHT } from "../../../src/client/styleMetrics.ts"
import { mount } from "../helpers/mount.tsx"

const zero = (): Record<Category, number> => ({
  system: 0,
  tools: 0,
  user: 0,
  injected: 0,
  skills: 0,
  assistant: 0,
  reasoning: 0,
  toolCalls: 0,
  toolResults: 0,
})

const row = (patch: Partial<TokenStepRow> = {}): TokenStepRow =>
  ({
    id: "a1",
    turn: 1,
    step: 1,
    at: Date.UTC(2026, 10, 16, 8, 41),
    prompt: 100,
    total: 100,
    byCategory: { ...zero(), system: 50, user: 50 },
    headerMissing: false,
    headerPending: false,
    afterCompaction: false,
    duration: 1000,
    wait: 0,
    ...patch,
  }) as TokenStepRow

function bar(patch: Partial<TokenStepRow> = {}, mode: "total" | "delta" = "total") {
  let hovered: string | undefined
  let selected: string | undefined
  let picked: Category | undefined
  const mounted = mount(() => (
    <TrendChartBar
      row={row(patch)}
      label="Step 1"
      delta={{ ...zero(), system: 2, user: -1 }}
      mode={mode}
      maxTotal={100}
      maxUp={2}
      maxDown={1}
      selected={false}
      hovered={false}
      onHover={(id) => (hovered = id)}
      onSelect={(id) => (selected = id)}
      onPick={(category) => (picked = category)}
    />
  ))
  return { ...mounted, hovered: () => hovered, selected: () => selected, picked: () => picked }
}

describe("TrendChartBar", () => {
  test("stacks the non-empty categories up to the chart height", () => {
    const view = bar()
    const segments = [...view.container.querySelectorAll(".oc-trend-chart-up > div")]
    assert.equal(segments.length, 2)
    assert.equal((segments[0] as HTMLElement).style.height, `${TREND_HEIGHT / 2}px`)
    assert.equal((segments[0] as HTMLElement).style.backgroundColor, "rgb(91, 141, 239)")
    view.dispose()
  })

  test("marks a compaction with the scissors caption", () => {
    const view = bar({ afterCompaction: true })
    assert.equal(view.container.querySelector(".oc-trend-chart-caption")?.textContent, "✂")
    view.dispose()
  })

  test("reports hover, selection and a picked category", () => {
    const view = bar()
    const root = view.container.querySelector(".oc-trend-bar")!
    root.dispatchEvent(new MouseEvent("mouseenter"))
    assert.equal(view.hovered(), "a1")
    root.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    assert.equal(view.selected(), "a1")
    view.container.querySelector(".oc-trend-chart-up > div")!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    assert.equal(view.picked(), "system")
    view.dispose()
  })

  test("picks a category from either delta half without selecting the bar", () => {
    const view = bar({}, "delta")
    const upper = view.container.querySelector(".oc-trend-chart-upper > div")!
    const lower = view.container.querySelector(".oc-trend-chart-lower > div")!
    upper.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    lower.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    assert.equal(view.picked(), "user")
    assert.equal(view.selected(), undefined)
    view.dispose()
  })

  test("renders without a category picker", () => {
    const { container, dispose } = mount(() => (
      <TrendChartBar
        row={row()}
        label="Step 1"
        delta={{ ...zero(), system: 2, user: -1 }}
        mode="total"
        maxTotal={100}
        maxUp={2}
        maxDown={1}
        selected
        hovered
        onHover={() => {}}
        onSelect={() => {}}
      />
    ))

    assert.ok(container.querySelector(".oc-trend-bar-active"))
    const segment = container.querySelector(".oc-trend-chart-up > div")!
    segment.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    assert.equal(container.querySelectorAll(".oc-trend-chart-up > div").length, 2)
    dispose()
  })

  test("selects on Enter and Space only", () => {
    const view = bar()
    const root = view.container.querySelector(".oc-trend-bar")!
    rootdispatch(root, "a")
    assert.equal(view.selected(), undefined)
    rootdispatch(root, "Enter")
    assert.equal(view.selected(), "a1")
    rootdispatch(root, " ")
    assert.equal(view.selected(), "a1")
    view.dispose()
  })

  test("splits gains and losses in delta mode", () => {
    const view = bar({}, "delta")
    assert.equal(view.container.querySelectorAll(".oc-trend-chart-upper > div").length, 1)
    assert.equal(view.container.querySelectorAll(".oc-trend-chart-lower > div").length, 1)
    assert.equal((view.container.querySelector(".oc-trend-chart-upper > div") as HTMLElement).style.height, `${TREND_HEIGHT / 2}px`)
    assert.equal((view.container.querySelector(".oc-trend-chart-lower > div") as HTMLElement).style.height, `${TREND_HEIGHT / 2}px`)
    view.dispose()
  })
})

function rootdispatch(root: Element, key: string): void {
  root.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
}
