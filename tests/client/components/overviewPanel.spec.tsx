import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { JSX, Setter } from "solid-js"
import { OverviewPanel, type OverviewPanelProps } from "../../../src/client/components/overviewPanel.tsx"
import type { Category } from "../../../src/shared/estimate.ts"
import type { ChildRow } from "../../../src/shared/report.ts"
import type { PanelView } from "../../../src/client/panelSupport.ts"
import { makePluginContext, mount } from "../helpers/mount.tsx"

const EMPTY_COUNTS = {
  system: 0,
  tools: 0,
  user: 0,
  injected: 0,
  skills: 0,
  assistant: 0,
  reasoning: 0,
  toolCalls: 0,
  toolResults: 0,
}

const byCategory = (patch: Partial<Record<Category, number>> = {}) => ({ ...EMPTY_COUNTS, ...patch })

const composition = (patch: Partial<{ headerPending: boolean; headerMissing: boolean }> = {}) => ({
  total: 1000,
  byCategory: byCategory({ system: 400, user: 600 }),
  items: [],
  prompt: 800,
  headerPending: false,
  headerMissing: false,
  ...patch,
})

const tokenStats = (patch: Partial<{ cacheHit: number }> = {}) => ({
  total: 1000,
  input: 900,
  output: 100,
  byCategory: byCategory({ system: 500, user: 500 }),
  ...patch,
})

const tool = (index: number) => ({ name: `tool-${index}`, calls: index + 1, failed: 0, unfinished: 0, total: index })

const child = (index: number, overrides: Partial<ChildRow> = {}): ChildRow => ({
  id: `ses_${index}`,
  title: `Child ${index}`,
  agent: index % 2 === 0 ? "build" : undefined,
  cost: 0.0123,
  prompt: 1200,
  output: 340,
  ...overrides,
})

const CHILDREN_LIMIT = 5

/** The section whose header shows this title. */
const sectionOf = (container: HTMLElement, title: string): HTMLElement =>
  [...container.querySelectorAll<HTMLElement>(".oc-section-title")].find((el) => el.textContent === title)!.closest(
    "section",
  ) as HTMLElement

const statValues = (section: HTMLElement): (string | null)[] =>
  [...section.querySelectorAll<HTMLElement>(".oc-stat-value")].map((el) => el.textContent)

interface Calls {
  readonly pinned: string[]
  readonly focused: string[]
  readonly views: string[]
  readonly childLimits: number[]
}

/** A rich set of props; each test patches the accessors its scenario needs. */
function makeProps(patch: Partial<OverviewPanelProps> = {}): { props: OverviewPanelProps; calls: Calls } {
  const calls: Calls = { pinned: [], focused: [], views: [], childLimits: [] }
  let childrenLimit = CHILDREN_LIMIT
  const props: OverviewPanelProps = {
    loading: () => false,
    tokens: () => ({ input: 500, output: 200, read: 300, write: 100 }),
    costStats: () => ({ total: 0.1234, average: 0.0123, steps: 3, estimated: 2, fallback: 0 }),
    turnCount: () => 4,
    steps: () => [{}, {}] as never,
    modelReplies: () => 6,
    skillLoads: () => 1,
    tools: () => Array.from({ length: 10 }, (_, index) => tool(index)) as never,
    commands: () => [{ command: "pnpm test" }, { command: "ls" }] as never,
    fileCounts: () => ({ read: 7, write: 3, search: 2 }),
    sessionIndex: () => ({ eventTotal: 11 }) as never,
    eventCounts: () => ({ inject: 1, skill: 2, compaction: 3, model: 4, agent: 5 }) as never,
    tokenStats: () => tokenStats({ cacheHit: 12.345 }),
    tokenCategories: () => ["system", "user"] as Category[],
    currentUsed: () => 600,
    limit: () => 1000,
    currentView: () => composition(),
    currentCategories: () => ["system", "user"] as Category[],
    currentTokens: (value) => value,
    currentWidth: (tokens) => (tokens / 1000) * 100,
    currentFree: () => 400,
    trigger: () => ({ auto: true, at: 800 }),
    triggerPct: () => 80,
    modelInfo: () => ({ name: "deepseek-v4" }),
    info: () => undefined,
    outputLimit: () => 64000,
    currentRunning: () => true,
    children: () => Array.from({ length: 12 }, (_, index) => child(index)),
    childrenLimit: () => childrenLimit,
    fleetHues: () => new Map(),
    setChildrenLimit: ((next: number) => {
      childrenLimit = next
      calls.childLimits.push(next)
    }) as unknown as Setter<number>,
    setFleetPinned: ((id: string | undefined) => calls.pinned.push(id!)) as unknown as Setter<string | undefined>,
    setFleetFocus: ((id: string | undefined) => calls.focused.push(id!)) as unknown as Setter<string | undefined>,
    setView: ((view: PanelView) => calls.views.push(view)) as unknown as Setter<PanelView>,
    data: () => ({ session: { status: (id) => (id === "ses_0" ? "running" : "idle") } }),
    timingSection: () => <div class="timing-stub">timing</div> as JSX.Element,
    ...patch,
  }
  return { props, calls }
}

describe("OverviewPanel", () => {
  test("renders the rich stats, token split, current window and children", () => {
    const { props, calls } = makeProps()
    const { container, dispose } = mount(() => <OverviewPanel {...props} />)

    const stats = sectionOf(container, "Context Stats")
    assert.match(stats.textContent ?? "", /900 \/ 200/)
    assert.doesNotMatch(stats.textContent ?? "", /reasoning/i)
    assert.match(stats.textContent ?? "", /33\.33%/)
    assert.match(stats.textContent ?? "", /Cache 300 read \/ 100 write/)
    assert.match(stats.textContent ?? "", /\$0\.1234/)
    assert.match(stats.textContent ?? "", /\$0\.0123 \/ call/)
    assert.match(stats.textContent ?? "", /estimated from models\.dev/)
    assert.equal(stats.querySelectorAll(".oc-chip-row")[0]?.querySelectorAll(".oc-chip").length, 9)
    assert.match(stats.querySelectorAll(".oc-chip-row")[0]?.textContent ?? "", /\+2/)
    assert.match(stats.querySelectorAll(".oc-chip-row")[1]?.textContent ?? "", /inject1/)
    assert.match(stats.querySelectorAll(".oc-chip-row")[1]?.textContent ?? "", /error0/)
    assert.match(stats.querySelectorAll(".oc-chip-row")[1]?.textContent ?? "", /agent5/)

    const tokens = sectionOf(container, "Token Stats")
    assert.equal(tokens.querySelector(".oc-hint")?.textContent, "cache hit 12.35%")
    assert.match(tokens.textContent ?? "", /1\.0k Total/)
    assert.match(tokens.textContent ?? "", /input 900 · output 100/)
    assert.equal(tokens.querySelectorAll(".oc-bar div").length, 2)
    assert.equal(tokens.querySelectorAll(".oc-legend-item").length, 2)
    assert.match(tokens.querySelector(".oc-legend-item")?.textContent ?? "", /\(50%\)/)

    assert.equal(container.querySelector(".timing-stub")?.textContent, "timing")

    const current = sectionOf(container, "Current Context")
    assert.equal(current.querySelector(".oc-hint")?.textContent, "deepseek-v4")
    assert.match(current.textContent ?? "", /600 \/ 1\.0k tokens/)
    assert.match(current.textContent ?? "", /60% of context used/)
    assert.equal(current.querySelectorAll(".oc-trigger").length, 1)
    assert.equal(current.querySelector(".oc-trigger-tag")?.textContent, "80%")
    assert.match(current.textContent ?? "", /Free window400/)
    assert.match(current.textContent ?? "", /Auto-compaction at800/)
    assert.match(current.textContent ?? "", /Request in progress/)
    assert.equal(current.querySelectorAll(".oc-legend-item").length, 4)
    assert.deepEqual(statValues(current), ["600", "400", "64k", "800"])

    const subagents = sectionOf(container, "Subagents")
    assert.equal(subagents.querySelector(".oc-hint")?.textContent, "open in parent timeline")
    assert.equal(subagents.querySelectorAll(".oc-table-button").length, CHILDREN_LIMIT)
    const first = subagents.querySelector<HTMLButtonElement>(".oc-table-button")!
    assert.match(first.textContent ?? "", /build · \$0\.012/)
    assert.match(first.textContent ?? "", /1\.2k in \/ 340 out/)
    assert.equal(first.querySelector(".oc-fleet-avatar")?.textContent, "C0")
    assert.equal(first.querySelector<HTMLElement>(".oc-fleet-avatar")?.style.background, "rgb(91, 141, 239)")
    assert.equal(first.querySelector<HTMLElement>(".oc-dot")?.style.background, "rgb(34, 160, 107)")
    const second = subagents.querySelectorAll<HTMLButtonElement>(".oc-table-button")[1]
    assert.match(second.textContent ?? "", /agent · \$0\.012/)
    assert.equal(second.querySelector<HTMLElement>(".oc-dot")?.style.background, "rgb(127, 140, 141)")

    first.click()
    assert.deepEqual(calls.pinned, ["ses_0"])
    assert.deepEqual(calls.focused, ["ses_0"])
    assert.deepEqual(calls.views, ["fleet"])

    const table = subagents.querySelector<HTMLElement>('[data-scroll-key="children"]')!
    table.dispatchEvent(new Event("scroll"))
    assert.deepEqual(calls.childLimits, [12])

    table.dispatchEvent(new Event("scroll"))
    assert.deepEqual(calls.childLimits, [12])
    dispose()
  })

  test("renders the empty stats, tokens and children fallbacks", () => {
    const { props } = makeProps({
      tokens: () => ({ input: 0, output: 0, read: 0, write: 0 }),
      costStats: () => ({ total: 0, average: 0, steps: 0, estimated: 0, fallback: 2 }),
      tools: () => [],
      commands: () => [],
      eventCounts: () => ({}) as never,
      tokenStats: () => undefined,
      currentUsed: () => 0,
      loading: () => true,
      modelInfo: () => undefined,
      info: () => ({ model: { id: "m-fallback" } }),
      children: () => [],
    })
    const { container, dispose } = mount(() => <OverviewPanel {...props} />)

    const stats = sectionOf(container, "Context Stats")
    assert.match(stats.textContent ?? "", /provider-reported cost/)
    assert.equal(stats.querySelectorAll(".oc-chip-row")[0]?.querySelectorAll(".oc-chip").length, 0)
    assert.match(stats.textContent ?? "", /Tool Calls0/)
    assert.match(stats.textContent ?? "", /Commands0/)
    for (const count of stats.querySelectorAll(".oc-chip-row")[1]?.querySelectorAll(".oc-chip-value") ?? []) {
      assert.equal(count.textContent, "0")
    }

    const tokens = sectionOf(container, "Token Stats")
    assert.match(tokens.textContent ?? "", /No token usage yet\./)
    assert.equal(tokens.querySelector(".oc-hint"), null)

    const current = sectionOf(container, "Current Context")
    assert.equal(current.querySelector(".oc-hint")?.textContent, "m-fallback")
    assert.match(current.textContent ?? "", /Loading/)
    assert.equal(current.querySelectorAll(".oc-trigger").length, 0)

    const subagents = sectionOf(container, "Subagents")
    assert.match(subagents.textContent ?? "", /No subagent sessions\./)
    assert.equal(subagents.querySelector(".oc-hint"), null)
    assert.equal(subagents.querySelectorAll(".oc-table-button").length, 0)
    dispose()
  })

  test("shows the idle empty state and the current window without a limit", () => {
    const { props } = makeProps({
      tokenStats: () => tokenStats(),
      tokenCategories: () => ["system"] as Category[],
      currentUsed: () => 500,
      limit: () => undefined,
      currentView: () => undefined,
      modelInfo: () => undefined,
      info: () => undefined,
      trigger: () => ({ auto: false, at: 400 }),
      triggerPct: () => undefined,
      outputLimit: () => undefined,
      currentRunning: () => false,
    })
    const { container, dispose } = mount(() => <OverviewPanel {...props} />)

    const tokens = sectionOf(container, "Token Stats")
    assert.equal(tokens.querySelector(".oc-hint"), null)
    assert.equal(tokens.querySelectorAll(".oc-legend-item").length, 1)

    const current = sectionOf(container, "Current Context")
    assert.equal(current.querySelector(".oc-hint"), null)
    assert.match(current.textContent ?? "", /500 tokens/)
    assert.match(current.textContent ?? "", /Category split unavailable/)
    assert.equal(current.querySelectorAll(".oc-trigger").length, 0)
    assert.equal(current.querySelectorAll(".oc-legend-item").length, 0)
    assert.deepEqual(statValues(current), ["500", "—", "—", "off"])
    assert.equal(current.querySelectorAll(".oc-stat .oc-faint").length, 4)
    assert.doesNotMatch(current.textContent ?? "", /Request in progress/)
    dispose()

    const empty = mount(() =>
      <OverviewPanel
        {...makeProps({
          currentUsed: () => 0,
          loading: () => false,
          modelInfo: () => undefined,
          info: () => undefined,
          children: () => [],
        }).props}
      />,
    )
    assert.match(sectionOf(empty.container, "Current Context").textContent ?? "", /No provider usage yet/)
    empty.dispose()
  })

  test("tints each child circle with its fleet hue", () => {
    const { props } = makeProps({
      children: () => [child(0), child(1)],
      childrenLimit: () => 2,
      fleetHues: () => new Map([["ses_0", "#8b5cf6"]]),
    })
    const { container, dispose } = mount(() => <OverviewPanel {...props} />)
    const avatars = [...sectionOf(container, "Subagents").querySelectorAll<HTMLElement>(".oc-fleet-avatar")]
    assert.equal(avatars[0].style.background, "rgb(139, 92, 246)")
    // A child the fleet does not know falls back to the lead hue.
    assert.equal(avatars[1].style.background, "rgb(91, 141, 239)")
    dispose()
  })

  test("renders a pending split and a reached trigger", () => {
    const { props } = makeProps({
      currentUsed: () => 500,
      limit: () => 400,
      currentView: () => composition({ headerPending: true }),
      trigger: () => ({ auto: true, at: 400 }),
      triggerPct: () => undefined,
      modelInfo: () => undefined,
      info: () => undefined,
      children: () => [child(1, { agent: undefined }), child(2)],
      childrenLimit: () => 2,
    })
    const { container, dispose } = mount(() => <OverviewPanel {...props} />)

    const current = sectionOf(container, "Current Context")
    assert.match(current.textContent ?? "", /Loading system & tools/)
    assert.equal(current.querySelectorAll(".oc-trigger").length, 0)
    assert.match(current.textContent ?? "", /At or past the auto-compaction trigger/)
    assert.equal(current.querySelectorAll(".oc-legend-item").length, 4)
    assert.match(current.querySelectorAll(".oc-legend-item")[2]?.textContent ?? "", /Free window400/)
    assert.equal(sectionOf(container, "Subagents").querySelectorAll(".oc-table-button").length, 2)
    dispose()
  })

  test("keeps the free window out at a zero limit and reports both header warnings", () => {
    const { props } = makeProps({
      currentUsed: () => 300,
      limit: () => 0,
      currentFree: () => 0,
      currentView: () => composition({ headerMissing: true, headerPending: true }),
      trigger: () => ({ auto: true, at: 350 }),
      triggerPct: () => 0,
      children: () => [child(0)],
      childrenLimit: () => 1,
    })
    const { container, dispose } = mount(() => <OverviewPanel {...props} />)

    const tokens = sectionOf(container, "Token Stats")
    assert.match(tokens.textContent ?? "", /This session has no system\/tools snapshot/)

    const current = sectionOf(container, "Current Context")
    assert.match(current.textContent ?? "", /No system\/tools snapshot for this step/)
    assert.equal(current.querySelectorAll(".oc-legend-item").length, 2)
    assert.equal(current.querySelectorAll(".oc-trigger").length, 1)
    assert.match(current.textContent ?? "", /Free window—/)
    assert.deepEqual(statValues(current), ["300", "—", "64k", "350"])
    assert.doesNotMatch(current.textContent ?? "", /At or past the auto-compaction trigger/)
    dispose()
  })

  test("falls back to the model id hint when only the info names one", () => {
    const { props } = makeProps({ modelInfo: () => undefined, info: () => undefined })
    const { container, dispose } = mount(() => <OverviewPanel {...props} />, makePluginContext())
    assert.equal(sectionOf(container, "Current Context").querySelector(".oc-hint"), null)
    dispose()
  })

  test("draws a split without a limit", () => {
    const { props } = makeProps({
      currentUsed: () => 500,
      limit: () => undefined,
      trigger: () => ({ auto: true, at: 400 }),
      triggerPct: () => undefined,
      children: () => [],
    })
    const { container, dispose } = mount(() => <OverviewPanel {...props} />)

    const current = sectionOf(container, "Current Context")
    assert.match(current.textContent ?? "", /500 tokens/)
    assert.equal(current.querySelectorAll(".oc-trigger").length, 0)
    assert.equal(current.querySelectorAll(".oc-legend-item").length, 2) // two categories, no free window
    assert.deepEqual(statValues(current), ["500", "—", "64k", "400"])
    dispose()
  })

  test("draws a split without a trigger", () => {
    const { props } = makeProps({
      currentUsed: () => 500,
      trigger: () => undefined,
      children: () => [],
    })
    const { container, dispose } = mount(() => <OverviewPanel {...props} />)

    const current = sectionOf(container, "Current Context")
    assert.equal(current.querySelectorAll(".oc-trigger").length, 0)
    assert.deepEqual(statValues(current), ["500", "400", "64k", "—"])
    dispose()
  })
})
