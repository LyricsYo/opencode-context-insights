import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { createSignal } from "solid-js"
import { FleetInspector } from "../../../src/client/components/agentInspector.tsx"
import type { Category } from "../../../src/shared/estimate.ts"
import type { FleetDelegation, FleetDetail, FleetNode } from "../../../src/shared/fleet.ts"
import {
  FLEET_T0,
  fleetDelegation,
  fleetDetail,
  fleetNode,
  fleetRow,
} from "../helpers/fleetUi.ts"
import { mount } from "../helpers/mount.tsx"

const compositionOf = (total: number, entries: Partial<Record<Category, number>>) => ({
  total,
  byCategory: {
    system: 0,
    tools: 0,
    user: 0,
    injected: 0,
    skills: 0,
    assistant: 0,
    reasoning: 0,
    toolCalls: 0,
    toolResults: 0,
    ...entries,
  },
  items: [],
  prompt: 0,
  headerPending: false,
  headerMissing: false,
})

const propsOf = (overrides: {
  node: FleetNode
  detail?: FleetDetail
  activeMs?: number
  limit?: number
  pinned?: boolean
  incoming?: { parent: FleetNode; delegation: FleetDelegation }
  delegations?: readonly FleetDelegation[]
  onPick?: (id: string) => void
  onOpen?: () => void
  onUnpin?: () => void
}) => ({
  node: overrides.node,
  detail: overrides.detail,
  activeMs: overrides.activeMs,
  limit: overrides.limit,
  pinned: overrides.pinned ?? false,
  incoming: overrides.incoming,
  delegations: overrides.delegations ?? [],
  onPick: overrides.onPick ?? (() => {}),
  onOpen: overrides.onOpen ?? (() => {}),
  onUnpin: overrides.onUnpin ?? (() => {}),
})

function makeScrollable(el: HTMLElement, scrollTop = 0): void {
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: 1000 })
  Object.defineProperty(el, "clientHeight", { configurable: true, value: 400 })
  el.scrollTop = scrollTop
}

describe("FleetInspector", () => {
  test("renders a running current agent with composition, cache and a short prompt", () => {
    const node = fleetNode({
      id: "ses_a",
      title: "Lead",
      agent: "build",
      provider: "prov",
      model: "gpt",
      prompt: 1200,
      output: 300,
      reasoning: 50,
      cacheRead: 10,
      cacheWrite: 5,
      duration: 90_000,
      cost: 0.05,
      isCurrent: true,
      running: true,
    })
    const detail = fleetDetail([], {
      steps: 3,
      cost: 0.1234,
      composition: compositionOf(1000, { system: 300, tools: 500 }),
      prompt: { at: FLEET_T0, text: "do the work" },
    })
    let unpinned = 0
    const { container, dispose } = mount(() => (
      <FleetInspector {...propsOf({ node, detail, activeMs: 90_000, limit: 2000, pinned: true, onUnpin: () => (unpinned += 1) })} />
    ))
    const badges = [...container.querySelectorAll(".oc-fleet-badge")].map((badge) => badge.textContent)
    assert.deepEqual(badges, ["self", "running"])
    const headText = container.querySelector(".oc-current-head")?.textContent ?? ""
    assert.ok(headText.includes("Unpin"))
    assert.equal(headText.includes("Open"), false)
    const chips = [...container.querySelectorAll(".oc-chip")].map((chip) => chip.textContent)
    assert.ok(chips.some((chip) => chip?.includes("reasoning 50")))
    assert.ok(chips.some((chip) => chip?.includes("cache 10 / 5")))
    assert.ok(chips.some((chip) => chip === "50%"))
    assert.equal(container.querySelectorAll(".oc-legend-item").length, 2)
    assert.match(container.querySelector(".oc-legend-value")?.textContent ?? "", /300.*30%/)
    assert.equal(container.querySelector(".oc-pre")?.textContent, "do the work")
    assert.equal(container.querySelector(".oc-pre")?.getAttribute("style"), "max-height: 96px;")
    assert.equal(container.querySelector(".oc-field-label-row .oc-toggle"), null)
    assert.match(container.querySelector(".oc-muted")?.textContent ?? "", /^build · prov\/gpt$/)
    ;[...container.querySelectorAll<HTMLButtonElement>(".oc-toggle")].find((button) => button.textContent === "Unpin")!.click()
    assert.equal(unpinned, 1)
    dispose()
  })

  test("renders a finished child, links back to the parent and expands a long prompt", () => {
    const node = fleetNode({
      id: "ses_b",
      title: "Worker",
      agent: "explore",
      model: "m",
      prompt: 10,
      output: 2,
      cost: 0.2,
      outcome: "failed",
      running: false,
      isCurrent: false,
    })
    const parent = fleetNode({ id: "ses_parent", title: "Parent" })
    const delegation = fleetDelegation({
      parentID: "ses_parent",
      at: FLEET_T0,
      description: "look around",
    })
    const detail = fleetDetail([], {
      steps: 0,
      prompt: { at: FLEET_T0 + 1000, text: "x".repeat(350) },
    })
    let opened = 0
    const picked: string[] = []
    const { container, dispose } = mount(() => (
      <FleetInspector
        {...propsOf({
          node,
          detail,
          incoming: { parent, delegation },
          onPick: (id) => picked.push(id),
          onOpen: () => (opened += 1),
        })}
      />
    ))
    const badges = [...container.querySelectorAll(".oc-fleet-badge")].map((badge) => badge.textContent)
    assert.deepEqual(badges, ["failed"])
    assert.match(container.querySelector(".oc-fleet-note")?.textContent ?? "", /look around/)
    assert.match(container.querySelector(".oc-field-label-row .oc-faint")?.textContent ?? "", /^11-16 \d{2}:\d{2}$/)
    assert.equal(container.querySelectorAll(".oc-chip").length, 2)
    assert.ok(
      [...container.querySelectorAll(".oc-muted")].some((node) => /^explore · m$/.test(node.textContent ?? "")),
    )
    const parentButton = [...container.querySelectorAll<HTMLButtonElement>(".oc-toggle")].find(
      (button) => button.textContent === "Parent",
    )!
    parentButton.click()
    assert.deepEqual(picked, ["ses_parent"])
    const openButton = [...container.querySelectorAll<HTMLButtonElement>(".oc-toggle")].find(
      (button) => button.textContent === "Open",
    )!
    openButton.click()
    assert.equal(opened, 1)
    const expandButton = [...container.querySelectorAll<HTMLButtonElement>(".oc-toggle")].find(
      (button) => button.textContent === "Expand",
    )!
    expandButton.click()
    assert.equal(container.querySelector(".oc-pre")?.getAttribute("style"), "max-height: 320px;")
    assert.equal(
      [...container.querySelectorAll<HTMLButtonElement>(".oc-toggle")].find((button) => button.textContent === "Collapse"),
      expandButton,
    )
    expandButton.click()
    assert.equal(container.querySelector(".oc-pre")?.getAttribute("style"), "max-height: 96px;")
    dispose()
  })

  test("pages the transcript, toggles rows and starts over when the agent changes", async () => {
    const rows = Array.from({ length: 45 }, (_, index) =>
      fleetRow(index, {
        kind: index === 44 ? "user" : index === 43 ? "skill" : index === 42 ? "system" : "reply",
        text: index === 44 ? "latest message " + "y".repeat(160) : `message ${index}`,
      }),
    )
    const detail = fleetDetail(rows, { steps: 2 })
    const [node, setNode] = createSignal(fleetNode({ id: "ses_a", title: "First" }))
    const { container, dispose } = mount(() => (
      <FleetInspector {...propsOf({ node: node(), detail })} />
    ))
    const heads = () => [...container.querySelectorAll<HTMLButtonElement>(".oc-fleet-msg-head")]
    const scroll = container.querySelector<HTMLElement>(".oc-fleet-msg-scroll")!
    makeScrollable(scroll, 0)
    assert.equal(heads().length, 20)
    assert.match(container.querySelector(".oc-field-label-row .oc-faint")?.textContent ?? "", /^20 \/ 45 messages$/)
    assert.equal(heads()[0].title, "latest message " + "y".repeat(160))
    scroll.dispatchEvent(new Event("scroll", { bubbles: true }))
    assert.equal(heads().length, 20)
    makeScrollable(scroll, 600)
    scroll.dispatchEvent(new Event("scroll", { bubbles: true }))
    assert.equal(heads().length, 40)
    scroll.dispatchEvent(new Event("scroll", { bubbles: true }))
    assert.equal(heads().length, 45)
    scroll.dispatchEvent(new Event("scroll", { bubbles: true }))
    assert.equal(heads().length, 45)

    const first = heads()[0]
    first.click()
    assert.ok(container.querySelector(".oc-md"))
    assert.equal(first.title, "")
    assert.equal(heads()[0].click(), undefined)
    assert.equal(container.querySelector(".oc-md"), null)
    assert.deepEqual(
      [...container.querySelectorAll(".oc-fleet-badge")].slice(0, 4).map((badge) => badge.textContent),
      ["prompt", "skill", "context", "reply"],
    )

    scroll.scrollTop = 500
    first.click()
    setNode(fleetNode({ id: "ses_b", title: "Second" }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(heads().length, 20)
    assert.equal(scroll.scrollTop, 0)
    assert.equal(container.querySelector(".oc-md"), null)
    assert.equal(container.querySelector(".oc-current-head b")?.textContent, "Second")
    dispose()
  })

  test("pages delegations and links only the rows that name a child", () => {
    const delegations: FleetDelegation[] = Array.from({ length: 45 }, (_, index) =>
      fleetDelegation({
        parentID: "ses_a",
        at: FLEET_T0 + index * 1000,
        description: `call ${index}`,
        ...(index === 0
          ? { childID: "ses_child", childTitle: "Child", agent: "task", result: "done", exact: true, status: "completed" }
          : index === 1
            ? { prompt: "ask", exact: false }
            : index === 2
              ? { childID: "ses_third", description: "third", exact: false, status: "running" }
              : {}),
      }),
    )
    const picked: string[] = []
    const { container, dispose } = mount(() => (
      <FleetInspector {...propsOf({ node: fleetNode({ id: "ses_a" }), delegations, onPick: (id) => picked.push(id) })} />
    ))
    const scroll = container.querySelector<HTMLElement>(".oc-fleet-msg-scroll")!
    makeScrollable(scroll, 0)
    const rows = () => [...container.querySelectorAll<HTMLButtonElement>(".oc-fleet-delegation-row")]
    assert.equal(rows().length, 20)
    assert.match(container.querySelector(".oc-field-label-row .oc-faint")?.textContent ?? "", /^20 \/ 45 calls$/)
    assert.deepEqual(
      rows().slice(0, 3).map((row) => row.querySelector(".oc-fleet-delegation-glyph")?.textContent),
      ["✓", "⇢", "●"],
    )
    assert.equal(rows()[0].title, "done")
    assert.equal(rows()[0].getAttribute("aria-disabled"), "false")
    assert.equal(rows()[0].querySelector(".oc-fleet-badge")?.textContent, "task")
    assert.equal(rows()[0].querySelector(".oc-fleet-delegation-text")?.textContent, "Child")
    assert.equal(rows()[0].querySelector(".oc-fleet-delegation-glyph")?.textContent, "✓")
    assert.ok(rows()[0].classList.contains("oc-fleet-delegation-link"))
    assert.equal(rows()[1].getAttribute("aria-disabled"), "true")
    assert.ok(rows()[1].classList.contains("oc-fleet-delegation-row-flat"))
    assert.ok(rows()[1].querySelector(".oc-faint[title]"))
    assert.equal(rows()[1].querySelector(".oc-fleet-delegation-text")?.textContent, "call 1")
    scroll.dispatchEvent(new Event("scroll", { bubbles: true }))
    assert.equal(rows().length, 20)
    makeScrollable(scroll, 600)
    scroll.dispatchEvent(new Event("scroll", { bubbles: true }))
    assert.equal(rows().length, 45)
    scroll.dispatchEvent(new Event("scroll", { bubbles: true }))
    assert.equal(rows().length, 45)
    rows()[0].click()
    rows()[1].click()
    assert.deepEqual(picked, ["ses_child"])
    dispose()
  })

  test("uses cache, provider and empty-state fallbacks", () => {
    const node = fleetNode({
      id: "ses_c",
      title: "Cache reader",
      cacheRead: 7,
      cacheWrite: 0,
      model: "only-model",
      cost: 0,
      isCurrent: true,
    })
    const detail = fleetDetail([], {
      composition: compositionOf(0, {}),
    })
    const { container, dispose } = mount(() => (
      <FleetInspector {...propsOf({ node, detail, limit: 500 })} />
    ))
    assert.match(container.querySelector(".oc-chip")?.parentElement?.textContent ?? "", /cache 7 \/ 0/)
    assert.match(container.querySelector(".oc-muted")?.textContent ?? "", /· only-model$/)
    assert.equal(container.querySelector(".oc-legend"), null)
    assert.equal(container.querySelectorAll(".oc-fleet-msg-scroll").length, 0)
    assert.equal(container.querySelectorAll(".oc-chip").length, 3)
    dispose()
  })

  test("uses cache write and provider-only fallbacks", () => {
    const node = fleetNode({
      id: "ses_d",
      title: "Cache writer",
      cacheRead: 0,
      cacheWrite: 9,
      provider: "prov",
      model: undefined,
      running: true,
    })
    const { container, dispose } = mount(() => (
      <FleetInspector {...propsOf({ node })} />
    ))
    assert.match(container.querySelector(".oc-chip")?.parentElement?.textContent ?? "", /cache 0 \/ 9/)
    assert.match(container.querySelector(".oc-muted")?.textContent ?? "", /^agent$/)
    assert.equal(container.querySelector(".oc-fleet-badge")?.textContent, "running")
    dispose()
  })

  test("skips usage when no detail is loaded but a limit exists", () => {
    const node = fleetNode({ id: "ses_nodetail", title: "Unknown" })
    const { container, dispose } = mount(() => (
      <FleetInspector {...propsOf({ node, limit: 1000 })} />
    ))
    assert.equal(container.querySelector(".oc-legend"), null)
    assert.equal(container.querySelector(".oc-field-label-row"), null)
    assert.equal(container.querySelectorAll(".oc-chip").length, 2)
    dispose()
  })

  test("does not render an incoming note without a description", () => {
    const node = fleetNode({ id: "ses_e" })
    const parent = fleetNode({ id: "ses_parent", title: "Parent" })
    const delegation = fleetDelegation({ parentID: "ses_parent", at: FLEET_T0, description: "" })
    const { container, dispose } = mount(() => (
      <FleetInspector {...propsOf({ node, incoming: { parent, delegation } })} />
    ))
    assert.ok(container.querySelector(".oc-fleet-note"))
    assert.equal(container.querySelector(".oc-fleet-note .oc-muted"), null)
    dispose()
  })
})
