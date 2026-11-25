import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { EventRow } from "../../../src/shared/events.ts"
import { EventRowView } from "../../../src/client/components/events.tsx"
import { mount } from "../helpers/mount.tsx"

const event = (patch: Partial<EventRow>): EventRow =>
  ({
    kind: "inject",
    at: Date.UTC(2026, 10, 16, 8, 41),
    name: "AGENTS.md",
    status: "completed",
    ...patch,
  }) as EventRow

describe("EventRowView", () => {
  test("renders the glyph, kind, label and a time with the date", () => {
    const { container, dispose } = mount(() => <EventRowView event={event({ kind: "inject" })} label="AGENTS.md" />)

    assert.equal(container.querySelector(".oc-event-icon")?.textContent, "+")
    assert.equal(container.querySelector(".oc-event-kind")?.textContent, "inject")
    assert.equal(container.querySelector(".oc-event-label")?.textContent, "AGENTS.md")
    assert.match(container.querySelector(".oc-event-time")?.textContent ?? "", /^\d{2}-\d{2} \d{2}:\d{2}$/)
    assert.equal(container.querySelector(".oc-event-row")?.tagName, "DIV")
    dispose()
  })

  test("shows the token delta and the gross tooltip for a compaction", () => {
    const { container, dispose } = mount(() => (
      <EventRowView event={event({ kind: "compaction", tokens: 40, grossTokens: 100 })} label="auto" />
    ))

    const tokens = container.querySelector(".oc-event-tokens")!
    assert.equal(tokens.textContent, "−40")
    assert.equal(tokens.getAttribute("title"), "compaction before 100 · net 40")
    dispose()
  })

  test("jumps on click when a handler is provided", () => {
    let picked = 0
    const { container, dispose } = mount(() => (
      <EventRowView event={event({})} label="x" onClick={() => (picked += 1)} />
    ))

    const row = container.querySelector(".oc-event-row")!
    assert.equal(row.tagName, "BUTTON")
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    assert.equal(picked, 1)
    dispose()
  })

  test("adds a positive token delta for non-compaction events", () => {
    const { container, dispose } = mount(() => (
      <EventRowView event={event({ kind: "inject", tokens: 1200 })} label="AGENTS.md" at="T1 S2" />
    ))

    const tokens = container.querySelector(".oc-event-tokens")!
    assert.equal(tokens.textContent, "+1.2k")
    assert.equal(tokens.getAttribute("title"), null)
    assert.equal((tokens as HTMLElement).style.color, "rgb(34, 160, 107)")
    assert.equal(container.querySelector(".oc-event-at")?.textContent, "T1 S2")
    dispose()
  })

  test("hides the net count and the gross tooltip for a zero compaction reclaim", () => {
    const { container, dispose } = mount(() => (
      <EventRowView event={event({ kind: "compaction", tokens: 0, grossTokens: 100 })} label="auto" />
    ))

    assert.equal(container.querySelector(".oc-event-tokens"), null)
    dispose()
  })
})
