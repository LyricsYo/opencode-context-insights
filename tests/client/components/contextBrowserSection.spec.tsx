import assert from "node:assert/strict"
import { createSignal } from "solid-js"
import { describe, test, vi } from "vitest"
import type { BrowserRow } from "../../../src/shared/browser.ts"
import { ContextBrowserSection } from "../../../src/client/components/contextBrowserSection.tsx"
import { makeBrowserModel, makeBrowserPanelProps, makeBrowserUi } from "../helpers/browserUi.ts"
import { mount } from "../helpers/mount.tsx"

// Probes the lazily-passed category prop on expanded rows; the real row view only
// reads it in flat mode, so without this the getter stays unexercised.
const categoryReads = vi.hoisted(() => [] as string[])
vi.mock("../../../src/client/components/common.tsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/client/components/common.tsx")>()
  const Probe = (props: Parameters<typeof actual.BrowserRowView>[0]) => {
    categoryReads.push(props.category)
    return actual.BrowserRowView(props)
  }
  return { ...actual, BrowserRowView: Probe }
})

const makeRow = (id: string, tokens = 10): BrowserRow => ({
  id,
  kind: "user",
  name: id,
  preview: `preview ${id}`,
  tokens,
  at: Date.UTC(2026, 10, 16, 8, 41),
})

const click = (el: Element | null | undefined): void => {
  assert.ok(el, "expected an element to click")
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}

const type = (el: Element | null | undefined, value: string): void => {
  assert.ok(el instanceof HTMLInputElement, "expected an input")
  el.value = value
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

const choose = (el: Element | null | undefined, value: string): void => {
  assert.ok(el instanceof HTMLSelectElement, "expected a select")
  el.value = value
  el.dispatchEvent(new Event("change", { bubbles: true }))
}

const byText = <T extends Element>(container: HTMLElement, selector: string, text: string): T | undefined =>
  [...container.querySelectorAll<T>(selector)].find((node) => node.textContent?.includes(text))

describe("ContextBrowserSection", () => {
  test("supports Solid's plain element-holder refs", () => {
    const props = makeBrowserPanelProps({
      attachBrowserAnchor: undefined as never,
      attachBrowserSelect: undefined as never,
    })
    const { container, dispose } = mount(() => <ContextBrowserSection {...props} />)

    assert.ok(container.querySelector("section.oc-card"))
    assert.ok(container.querySelector("select.oc-select"))
    dispose()
  })

  test("attaches the section anchor and the step select", () => {
    const anchors: HTMLElement[] = []
    const selects: HTMLSelectElement[] = []
    const props = makeBrowserPanelProps({
      attachBrowserAnchor: (el: HTMLElement) => anchors.push(el),
      attachBrowserSelect: (el: HTMLSelectElement) => selects.push(el),
    })
    const { container, dispose } = mount(() => <ContextBrowserSection {...props} />)

    assert.equal(anchors.length, 1)
    assert.equal(anchors[0], container.querySelector("section.oc-card"))
    assert.equal(selects.length, 1)
    assert.equal(selects[0], container.querySelector("select.oc-select"))
    dispose()
  })

  test("shows the live hint and empty states when no snapshot exists", () => {
    const props = makeBrowserPanelProps({ ui: makeBrowserUi({ header: () => null }) })
    const { container, dispose } = mount(() => <ContextBrowserSection {...props} />)

    assert.equal(container.querySelector(".oc-section-title")?.textContent, "Context browser")
    assert.match(container.querySelector(".oc-hint")?.textContent ?? "", /next request · ≈0 tokens/)
    assert.match(container.textContent ?? "", /No snapshot for this step/)
    assert.match(container.textContent ?? "", /Token counts are estimates/)
    assert.equal(container.querySelectorAll(".oc-segment").length, 0)
    assert.equal(container.querySelectorAll(".oc-bar-seg").length, 0)
    assert.equal(container.querySelectorAll(".oc-cat-row").length, 0)
    dispose()
  })

  test("shows the pinned-step hint, provider and total chips, and loading states", () => {
    const props = makeBrowserPanelProps({
      browser: makeBrowserModel({
        browserTotal: () => 120,
        browserProvider: () => 50,
      }),
      ui: makeBrowserUi({
        browserStep: () => ({ turn: 2, step: 3 }),
        headerLoading: () => true,
        headerError: () => true,
        loadingHistory: () => true,
      }),
    })
    const { container, dispose } = mount(() => <ContextBrowserSection {...props} />)

    assert.match(container.querySelector(".oc-hint")?.textContent ?? "", /T2 S3 · ≈120 tokens/)
    assert.match(container.textContent ?? "", /provider 50/)
    assert.match(container.textContent ?? "", /≈120 tokens/)
    assert.match(container.textContent ?? "", /Loading the full history/)
    assert.match(container.textContent ?? "", /Loading system & tools/)
    assert.doesNotMatch(container.textContent ?? "", /snapshot unavailable/)
    assert.doesNotMatch(container.textContent ?? "", /No snapshot for this step/)
    dispose()
  })

  test("uses placeholder step coordinates and reports a header error", () => {
    const props = makeBrowserPanelProps({
      browser: makeBrowserModel({
        browserProvider: () => 0,
      }),
      ui: makeBrowserUi({
        browserStep: () => ({}) as never,
        headerLoading: () => false,
        headerError: () => "boom",
      }),
    })
    const { container, dispose } = mount(() => <ContextBrowserSection {...props} />)

    assert.match(container.querySelector(".oc-hint")?.textContent ?? "", /T\? S\? · ≈0 tokens/)
    assert.match(container.textContent ?? "", /snapshot unavailable/)
    assert.doesNotMatch(container.textContent ?? "", /provider \d/)
    assert.doesNotMatch(container.textContent ?? "", /No snapshot for this step/)
    dispose()
  })

  test("treats an undefined header like a pending one, without the empty hint", () => {
    const props = makeBrowserPanelProps({ ui: makeBrowserUi({ header: () => undefined }) })
    const { container, dispose } = mount(() => <ContextBrowserSection {...props} />)

    assert.doesNotMatch(container.textContent ?? "", /No snapshot for this step/)
    dispose()
  })

  test("renders category bars, deltas, filters, tool sorts and the expanded rows", () => {
    const toolRows = [makeRow("ra", 30), makeRow("rb", 20)]
    const opened: string[] = []
    const toggled: string[] = []
    const rowQueries: string[] = []
    const sorts: string[] = []
    const allCalls: unknown[] = []

    const props = makeBrowserPanelProps({
      browser: makeBrowserModel({
        browserGroups: () => [
          { key: "tools", tokens: 60, rows: toolRows },
          { key: "assistant", tokens: 40, rows: [makeRow("rc")] },
          { key: "injected", tokens: 0, rows: [] },
          { key: "user", tokens: 0, rows: [] },
          { key: "reasoning", tokens: 10, rows: [] },
        ],
        browserTotal: () => 100,
        browserDeltas: () => ({
          tools: { items: 2, tokens: 10 },
          assistant: { items: 0, tokens: -5 },
          injected: { items: 0, tokens: 0 },
          reasoning: { items: -1, tokens: 0 },
        }),
        browserOpenRows: () => toolRows,
        browserOpenTokens: () => 50,
        browserOpenShown: () => [toolRows[0]],
      }),
      ui: makeBrowserUi({
        browserDelta: () => "step",
        browserOpen: () => "tools",
        browserRowQuery: () => "q",
        browserFocus: () => "ra",
        toolSort: () => "size",
        openBrowserGroup: (key: string) => opened.push(key),
        toggleBrowserGroup: (key: string) => toggled.push(key),
        setBrowserRowQuery: (value: string) => rowQueries.push(value),
        setToolSort: (value: string) => sorts.push(value),
        setBrowserAll: (value: unknown) => allCalls.push(value),
      }),
    })
    const { container, dispose } = mount(() => <ContextBrowserSection {...props} />)

    const bars = container.querySelectorAll(".oc-bar-seg")
    assert.equal(bars.length, 3)
    click(bars[0])
    assert.deepEqual(opened, ["tools"])

    const categories = container.querySelectorAll<HTMLButtonElement>(".oc-cat-row")
    assert.equal(categories.length, 5)
    assert.equal(categories[0].querySelector(".oc-cat-chevron")?.textContent, "▾")
    assert.equal(categories[0].querySelector(".oc-cat-chevron")?.textContent, "▾")
    assert.equal(categories[2].disabled, true)
    assert.equal(categories[3].disabled, true)
    click(categories[1])
    assert.deepEqual(toggled, ["assistant"])

    const chips = [...container.querySelectorAll(".oc-delta-chip")].map((chip) => chip.textContent?.replace(/\s+/g, ""))
    assert.equal(chips.length, 3)
    assert.equal(chips[0], "+2+10")
    assert.equal(chips[1], "−5")
    assert.equal(chips[2], "−1")

    const openInput = container.querySelector<HTMLInputElement>(".oc-cat-body .oc-search")
    assert.equal(openInput?.value, "q")
    assert.match(container.textContent ?? "", /2 items · ≈50/)
    type(openInput, "read")
    assert.deepEqual(rowQueries, ["read"])

    const sortButtons = [...container.querySelectorAll<HTMLButtonElement>(".oc-cat-body .oc-toggle")]
    const calls = sortButtons.find((node) => node.textContent === "By calls")
    assert.ok(calls)
    click(calls)
    assert.deepEqual(sorts, ["calls"])

    const entries = container.querySelectorAll<HTMLDetailsElement>(".oc-entry")
    assert.equal(entries.length, 1)
    assert.equal(entries[0].dataset.browserRow, "ra")
    assert.equal(entries[0].open, true)
    assert.ok(entries[0].classList.contains("oc-entry-focus"))
    assert.deepEqual(categoryReads, ["tools"])

    const showAll = byText<HTMLButtonElement>(container, ".oc-cat-body .oc-toggle", "Show all 2 items")
    assert.ok(showAll)
    click(showAll)
    assert.deepEqual(allCalls, [true])
    dispose()
  })

  test("hides Show all when every expanded row is already visible", () => {
    const rows = [makeRow("ra"), makeRow("rb")]
    categoryReads.length = 0
    const props = makeBrowserPanelProps({
      browser: makeBrowserModel({
        browserGroups: () => [{ key: "tools", tokens: 20, rows }],
        browserOpenRows: () => rows,
        browserOpenShown: () => rows,
        browserAll: () => true,
      }),
      ui: makeBrowserUi({ browserOpen: () => "tools" }),
    })
    const { container, dispose } = mount(() => <ContextBrowserSection {...props} />)

    assert.equal(container.querySelectorAll(".oc-entry").length, 2)
    assert.deepEqual(categoryReads, ["tools", "tools"])
    assert.doesNotMatch(container.textContent ?? "", /Show all/)
    dispose()
  })

  test("shows the empty-category fallback for an open category with no rows", () => {
    const props = makeBrowserPanelProps({
      browser: makeBrowserModel({
        browserGroups: () => [{ key: "injected", tokens: 0, rows: [] }],
        browserOpenRows: () => [],
        browserOpenShown: () => [],
      }),
      ui: makeBrowserUi({ browserOpen: () => "injected" }),
    })
    const { container, dispose } = mount(() => <ContextBrowserSection {...props} />)

    assert.match(container.textContent ?? "", /No items in this category/)
    const category = container.querySelector<HTMLButtonElement>(".oc-cat-row")
    assert.equal(category?.disabled, true)
    assert.ok(category?.classList.contains("oc-cat-row-active"))
    assert.doesNotMatch(container.textContent ?? "", /Show all/)
    assert.equal(container.querySelectorAll(".oc-bar-seg").length, 0)
    dispose()
  })

  test("flat mode filters, reports no matches, and hides the empty-header hint", () => {
    const props = makeBrowserPanelProps({
      browser: makeBrowserModel({ browserFlatRows: () => [], browserFlatShown: () => [] }),
      ui: makeBrowserUi({
        browserFlat: () => true,
        browserQuery: () => "zzz",
        header: () => null,
      }),
    })
    const { container, dispose } = mount(() => <ContextBrowserSection {...props} />)

    const search = container.querySelector<HTMLInputElement>(".oc-search")
    assert.equal(search?.value, "zzz")
    assert.match(search?.placeholder ?? "", /Filter context items/)
    assert.match(container.textContent ?? "", /No rows match the filter/)
    assert.doesNotMatch(container.textContent ?? "", /No snapshot for this step/)
    assert.equal(container.querySelectorAll(".oc-table").length, 0)
    dispose()
  })

  test("flat mode renders matched rows, filters the query and grows the page", () => {
    const rows = [
      { row: makeRow("ra", 10), category: "user" as const },
      { row: makeRow("rb", 20), category: "assistant" as const },
    ]
    const queries: string[] = []
    const allCalls: unknown[] = []
    const props = makeBrowserPanelProps({
      browser: makeBrowserModel({
        browserFlatRows: () => rows,
        browserFlatTokens: () => 30,
        browserFlatShown: () => [rows[0]],
      }),
      ui: makeBrowserUi({
        browserFlat: () => true,
        browserQuery: () => "",
        setBrowserQuery: (value: string) => queries.push(value),
        setBrowserAll: (value: unknown) => allCalls.push(value),
      }),
    })
    const { container, dispose } = mount(() => <ContextBrowserSection {...props} />)

    assert.match(container.textContent ?? "", /2 items · ≈30/)
    const entries = container.querySelectorAll(".oc-entry")
    assert.equal(entries.length, 1)
    assert.equal(entries[0].querySelectorAll(".oc-dot").length, 1)
    assert.ok(entries[0].querySelector(".oc-row-name")?.textContent === "ra")

    type(container.querySelector(".oc-search"), "abc")
    assert.deepEqual(queries, ["abc"])

    const showAll = byText<HTMLButtonElement>(container, "button.oc-toggle", "Show all 2 items")
    assert.ok(showAll)
    click(showAll)
    assert.deepEqual(allCalls, [true])
    dispose()
  })

  test("flat mode hides Show all once the page shows every row", () => {
    const rows = [
      { row: makeRow("ra"), category: "user" as const },
      { row: makeRow("rb"), category: "assistant" as const },
    ]
    const props = makeBrowserPanelProps({
      browser: makeBrowserModel({
        browserFlatRows: () => rows,
        browserFlatShown: () => rows,
        browserAll: () => true,
      }),
      ui: makeBrowserUi({ browserFlat: () => true }),
    })
    const { container, dispose } = mount(() => <ContextBrowserSection {...props} />)

    assert.equal(container.querySelectorAll(".oc-entry").length, 2)
    assert.doesNotMatch(container.textContent ?? "", /Show all/)
    dispose()
  })

  test("switches the step select between live and a pinned step", () => {
    const liveCalls: unknown[] = []
    const selectedCalls: unknown[] = []
    let openResets = 0
    const rowQueryResets: string[] = []
    let focusResets = 0

    const props = makeBrowserPanelProps({
      ui: makeBrowserUi({
        stepOptions: () => [
          { id: "m1", label: "T1 S1" },
          { id: "m2", label: "T2 S2" },
        ],
        trendPreviewStep: () => ({ turn: 1, step: 2 }),
        browserLive: () => true,
        setBrowserLive: (value: unknown) => liveCalls.push(value),
        setSelected: (value: unknown) => selectedCalls.push(value),
        setBrowserOpen: () => {
          openResets += 1
        },
        setBrowserRowQuery: (value: string) => rowQueryResets.push(value),
        setBrowserFocus: () => {
          focusResets += 1
        },
      }),
    })
    const { container, dispose } = mount(() => <ContextBrowserSection {...props} />)

    assert.match(container.textContent ?? "", /preview · T1 S2/)
    assert.equal(container.querySelectorAll(".oc-select option").length, 3)
    assert.match(container.textContent ?? "", /T2 S2/)

    const select = container.querySelector<HTMLSelectElement>(".oc-select")
    choose(select, "m2")
    choose(select, "live")

    assert.deepEqual(liveCalls, [false, true])
    assert.deepEqual(selectedCalls, ["m2", undefined])
    assert.equal(openResets, 2)
    assert.deepEqual(rowQueryResets, ["", ""])
    assert.equal(focusResets, 2)
    dispose()
  })

  test("pins the selected step and switches delta modes", () => {
    const deltaCalls: unknown[] = []
    const props = makeBrowserPanelProps({
      ui: makeBrowserUi({
        browserLive: () => false,
        selectedID: () => "m2",
        selectedStep: () => ({ id: "m2" }),
        browserDelta: () => "step",
        setBrowserDelta: (value: unknown) => deltaCalls.push(value),
        header: () => undefined,
      }),
    })
    const { container, dispose } = mount(() => <ContextBrowserSection {...props} />)

    assert.equal(container.querySelectorAll(".oc-select option").length, 1)
    const buttons = [...container.querySelectorAll<HTMLButtonElement>(".oc-segment-btn")]
    assert.deepEqual(buttons.map((node) => node.textContent), ["No diff", "vs step", "vs turn"])
    assert.ok(buttons[1].classList.contains("oc-segment-btn-on"))
    click(buttons[2])
    assert.deepEqual(deltaCalls, ["turn"])
    dispose()
  })

  test("omits the delta segment when no step is pinned", () => {
    const props = makeBrowserPanelProps({
      ui: makeBrowserUi({
        browserLive: () => false,
        selectedID: () => undefined,
        selectedStep: () => undefined,
      }),
    })
    const { container, dispose } = mount(() => <ContextBrowserSection {...props} />)

    assert.equal(container.querySelectorAll(".oc-select option").length, 1)
    assert.equal(container.querySelectorAll(".oc-segment").length, 0)
    dispose()
  })

  test("toggles flat mode from the toolbar", () => {
    const [flat, setFlat] = createSignal(false)
    const props = makeBrowserPanelProps({
      ui: makeBrowserUi({ browserFlat: flat, setBrowserFlat: setFlat }),
    })
    const { container, dispose } = mount(() => <ContextBrowserSection {...props} />)

    const toggle = byText<HTMLButtonElement>(container, "button.oc-toggle", "Flat")
    assert.ok(toggle)
    assert.equal(container.querySelector(".oc-search"), null)
    click(toggle)
    assert.equal(flat(), true)
    assert.ok(toggle.classList.contains("oc-toggle-active"))
    assert.match(container.querySelector(".oc-search")?.getAttribute("placeholder") ?? "", /Filter context items/)
    dispose()
  })
})
