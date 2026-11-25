import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { EventRow } from "../../../src/shared/report.ts"
import type { EventsSectionProps } from "../../../src/client/components/eventsSection.tsx"
import { EventsSection } from "../../../src/client/components/eventsSection.tsx"
import { makeBrowserPanelProps, makeSessionModel } from "../helpers/browserUi.ts"
import { mount } from "../helpers/mount.tsx"
import { panelNow } from "../helpers/session.ts"

const event = (patch: Partial<EventRow> = {}): EventRow =>
  ({ id: "e1", at: panelNow, kind: "inject", name: "AGENTS.md", failed: false, ...patch }) as EventRow

function setup(
  options: {
    events?: readonly EventRow[]
    filtered?: readonly EventRow[]
    counts?: Record<string, number>
    limit?: number
    kinds?: readonly string[]
    onFocus?: (event: EventRow) => void
    onToggle?: (kind: string) => void
    onLimit?: (next: number) => void
  } = {},
): EventsSectionProps {
  const rows = options.events ?? []
  return makeBrowserPanelProps({
    session: makeSessionModel({ events: () => rows }),
    ui: {
      eventKinds: () => options.kinds ?? ["inject"],
      eventCounts: () => options.counts ?? {},
      filteredEvents: () => options.filtered ?? rows,
      eventLimit: () => options.limit ?? 50,
      eventLabelOf: (row: EventRow) => row.name ?? "",
      eventAtOf: (row: EventRow) => (row.turn === undefined ? undefined : `T${row.turn}`),
      setEventLimit: options.onLimit ?? (() => {}),
      toggleEventKind: options.onToggle ?? (() => {}),
      focusEvent: options.onFocus ?? (() => {}),
    },
  }) as unknown as EventsSectionProps
}

const click = (el: Element | null | undefined): void => {
  assert.ok(el, "expected an element to click")
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}

describe("EventsSection", () => {
  test("renders the empty state and the kind filters", () => {
    const toggled: string[] = []
    const { container, dispose } = mount(() => <EventsSection {...setup({ onToggle: (kind) => toggled.push(kind) })} />)

    assert.equal(container.querySelector(".oc-section-title")?.textContent, "Context events")
    assert.match(container.textContent ?? "", /No context events yet/)
    assert.equal(container.querySelector(".oc-events"), null)

    const filters = [...container.querySelectorAll<HTMLButtonElement>(".oc-event-filters .oc-toggle")]
    assert.deepEqual(filters.map((node) => node.textContent), [
      "inject0",
      "skill0",
      "compaction0",
      "model0",
      "agent0",
      "error0",
    ])
    click(filters[2])
    assert.deepEqual(toggled, ["compaction"])
    dispose()
  })

  test("shows kind counts and marks the active filters", () => {
    const { container, dispose } = mount(() => (
      <EventsSection {...setup({ events: [event()], counts: { inject: 3 }, kinds: ["inject", "skill"] })} />
    ))

    const filters = [...container.querySelectorAll<HTMLButtonElement>(".oc-event-filters .oc-toggle")]
    assert.equal(filters[0].textContent, "inject3")
    assert.ok(filters[0].classList.contains("oc-toggle-active"))
    assert.ok(filters[1].classList.contains("oc-toggle-active"))
    assert.ok(!filters[2].classList.contains("oc-toggle-active"))
    dispose()
  })

  test("reports when the selected kinds match no event", () => {
    const { container, dispose } = mount(() => (
      <EventsSection {...setup({ events: [event()], filtered: [] })} />
    ))

    assert.match(container.textContent ?? "", /No events of the selected kinds\./)
    assert.equal(container.querySelector(".oc-events"), null)
    dispose()
  })

  test("renders the filtered page and jumps only from focusable events", () => {
    const focused: EventRow[] = []
    const rows = [
      event({ id: "e1", kind: "inject", name: "AGENTS.md", stepID: "a1", turn: 1 }),
      event({ id: "e2", kind: "skill", name: "docs", stepID: "a1" }),
      event({ id: "e3", kind: "compaction", name: "auto", stepID: "a1" }),
      event({ id: "e4", kind: "model", name: "m2", stepID: "a1" }),
      event({ id: "e5", kind: "inject", name: "no step" }),
    ]
    const { container, dispose } = mount(() =>
      <EventsSection {...setup({ events: rows, filtered: rows, onFocus: (row) => focused.push(row) })} />,
    )

    const rendered = [...container.querySelectorAll(".oc-events .oc-event-row")]
    assert.equal(rendered.length, 5)
    assert.deepEqual(rendered.map((node) => node.tagName), ["BUTTON", "BUTTON", "BUTTON", "DIV", "DIV"])
    assert.equal(container.querySelector(".oc-event-at")?.textContent, "T1")

    for (const row of rendered) row.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    assert.deepEqual(focused.map((row) => row.id), ["e1", "e2", "e3"])
    dispose()
  })

  test("grows the event page on scroll until the filtered list ends", () => {
    const limits: number[] = []
    const rows = Array.from({ length: 60 }, (_, index) => event({ id: `e${index}`, name: `e${index}` }))
    const { container, dispose } = mount(() =>
      <EventsSection {...setup({ events: rows, filtered: rows, limit: 20, onLimit: (next) => limits.push(next) })} />,
    )

    assert.equal(container.querySelectorAll(".oc-events .oc-event-row").length, 20)
    const scroll = container.querySelector<HTMLElement>(".oc-section-scroll")!
    assert.equal(scroll.getAttribute("data-scroll-key"), "events")
    Object.defineProperty(scroll, "scrollHeight", { value: 500, configurable: true })
    Object.defineProperty(scroll, "clientHeight", { value: 400, configurable: true })
    scroll.scrollTop = 100
    scroll.dispatchEvent(new Event("scroll"))
    assert.deepEqual(limits, [60])

    scroll.scrollTop = 0
    scroll.dispatchEvent(new Event("scroll"))
    assert.deepEqual(limits, [60])
    dispose()
  })
})
