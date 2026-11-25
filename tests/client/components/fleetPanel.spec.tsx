import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { FleetPanel } from "../../../src/client/components/fleetPanel.tsx"
import type { Category } from "../../../src/shared/estimate.ts"
import { layoutFleet } from "../../../src/shared/fleet.ts"
import {
  FLEET_T0,
  fleetDelegation,
  fleetDetail,
  fleetForest,
  fleetHead,
  fleetNode,
  fleetRow,
  fleetTimelineOf,
  fleetTimelineRow,
  makeFleetModel,
} from "../helpers/fleetUi.ts"
import { makePluginContext, mount } from "../helpers/mount.tsx"
import { makeSessionProps, settle } from "../helpers/session.ts"

const MINUTE = 60_000

const composition = (total: number, byCategory: Partial<Record<Category, number>>) => ({
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
    ...byCategory,
  },
  items: [],
  prompt: 0,
  headerPending: false,
  headerMissing: false,
})

const root = fleetNode({
  id: "ses_root",
  title: "Lead",
  agent: "build",
  model: "m",
  isCurrent: true,
  family: -1,
  prompt: 600,
  output: 100,
  cost: 0.02,
  duration: 120_000,
})
const worker = fleetNode({
  id: "ses_b",
  parentID: "ses_root",
  title: "Worker",
  agent: "explore",
  model: "gpt",
  family: 0,
  depth: 1,
  running: true,
  prompt: 200,
  output: 50,
  cost: 0.03,
})
const idle = fleetNode({
  id: "ses_c",
  parentID: "ses_root",
  title: "Idle",
  family: 1,
  depth: 1,
  completed: false,
  outcome: "failed",
  prompt: 0,
  output: 0,
  cost: 0,
})
const edges = [
  { from: "ses_root", to: "ses_b" },
  { from: "ses_root", to: "ses_c" },
]

function treeModel() {
  const base = layoutFleet(fleetForest([root, worker, idle], edges), 420)
  const layout = {
    ...base,
    points: [...base.points, { id: "ses_ghost", x: 20, y: 300, depth: 2 }],
  }
  const head = fleetHead({
    steps: 4,
    cost: 0.5,
    composition: composition(900, { system: 400, tools: 500 }),
  })
  const detail = fleetDetail([fleetRow(0, { text: "the task" })], {
    ...head,
    prompt: { at: FLEET_T0, text: "go inspect" },
    reply: { at: FLEET_T0 + 1000, text: "done" },
  })
  return makeFleetModel({
    nodes: [root, worker, idle],
    edges,
    layout,
    heads: new Map([["ses_b", head]]),
    details: new Map([["ses_b", detail]]),
    delegations: new Map([
      [
        "ses_b",
        [
          fleetDelegation({
            parentID: "ses_b",
            at: FLEET_T0,
            description: "hand off",
            childID: "ses_c",
            childTitle: "Idle",
            agent: "task",
            exact: true,
          }),
        ],
      ],
    ]),
    incoming: new Map([
      [
        "ses_b",
        { parent: root, delegation: fleetDelegation({ parentID: "ses_root", at: FLEET_T0, description: "spawned" }) },
      ],
    ]),
    categories: ["system", "tools"],
    limitOf: (node) => (node.id === "ses_b" ? 1800 : undefined),
    mode: "tree",
    timeline: fleetTimelineOf(
      [root, worker, idle].map((node) => fleetTimelineRow(node, [{ start: FLEET_T0, end: FLEET_T0 + MINUTE }])),
      { peak: 2, buckets: [1, 2, 1], active: MINUTE, activeSum: 3 * MINUTE },
    ),
  })
}

function timelineModel() {
  const timeline = fleetTimelineOf(
    [
      fleetTimelineRow(root, [{ start: FLEET_T0, end: FLEET_T0 + 2 * MINUTE }]),
      fleetTimelineRow(worker, [{ start: FLEET_T0 + MINUTE, end: FLEET_T0 + 4 * MINUTE }]),
      fleetTimelineRow(idle, []),
    ],
    {
      start: FLEET_T0,
      end: FLEET_T0 + 4 * MINUTE,
      now: FLEET_T0 + 2 * MINUTE,
      peak: 2,
      buckets: [0, 1, 2, 1],
      links: [
        { parentID: "ses_root", childID: "ses_b", at: FLEET_T0 + MINUTE, childStart: FLEET_T0 + MINUTE, from: 0, to: 1 },
      ],
      segments: [{ start: FLEET_T0, end: FLEET_T0 + 4 * MINUTE, from: 0, to: 1, gap: 0 }],
      active: 4 * MINUTE,
      activeSum: 5 * MINUTE,
    },
  )
  return makeFleetModel({
    nodes: [root, worker, idle],
    edges,
    timeline,
    focus: "ses_b",
  })
}

function segmentButton(container: HTMLElement, label: string): HTMLButtonElement {
  return [...container.querySelectorAll<HTMLButtonElement>(".oc-segment-btn")].find(
    (button) => button.textContent === label,
  )!
}

describe("FleetPanel", () => {
  test("renders the tree with category chips, cards and links, then pins an agent", async () => {
    const model = treeModel()
    const stage: HTMLElement[] = []
    const session = makeSessionProps().session
    const { container, dispose } = mount(() => (
      <FleetPanel fleet={model as never} session={session} attachFleetStage={(el) => stage.push(el)} />
    ))
    await settle()

    assert.equal(container.querySelector(".oc-section-title")?.textContent, "Fleet")
    assert.match(container.querySelector(".oc-hint")?.textContent ?? "", /subagent tree/)
    assert.equal(stage.length, 1)
    assert.ok(stage[0].classList.contains("oc-fleet-stage"))
    assert.equal(container.querySelectorAll(".oc-fleet-card").length, 3)
    const categoryChips = [...container.querySelectorAll(".oc-chip-row")][1]?.textContent ?? ""
    assert.match(categoryChips, /System/)
    assert.match(categoryChips, /Tool Schemas/)
    const links = [...container.querySelectorAll(".oc-fleet-links path")]
    assert.equal(links.length, 2)
    assert.equal(links[0].getAttribute("stroke-width"), "2")
    assert.equal(links[0].getAttribute("stroke-dasharray"), "5 4")
    assert.equal(links[0].getAttribute("opacity"), "0.85")
    assert.equal(links[1].getAttribute("stroke-width"), "1.4")
    assert.equal(links[1].getAttribute("stroke-dasharray"), null)

    const card = (id: string) =>
      container.querySelector<HTMLButtonElement>(`.oc-fleet-card[data-fleet-id="${id}"]`)!
    assert.equal(card("ses_b").querySelectorAll(".oc-fleet-bar i").length, 2)
    assert.ok(card("ses_b").querySelector(".oc-fleet-card-meta")?.textContent?.includes("50%"))
    assert.equal(card("ses_root").querySelector(".oc-fleet-badge")?.textContent, "self")
    assert.equal(card("ses_c").querySelector(".oc-fleet-card-duty")?.textContent, "agent")

    card("ses_b").dispatchEvent(new MouseEvent("mouseenter"))
    assert.equal(card("ses_c").style.opacity, "0.34")
    card("ses_b").dispatchEvent(new MouseEvent("focus"))
    card("ses_b").dispatchEvent(new MouseEvent("mouseleave"))
    card("ses_b").dispatchEvent(new MouseEvent("blur"))
    assert.equal(card("ses_c").style.opacity, "1")

    card("ses_b").click()
    await settle()
    assert.equal(card("ses_b").getAttribute("aria-pressed"), "true")
    assert.ok(card("ses_b").classList.contains("oc-fleet-card-active"))
    assert.equal(container.querySelectorAll(".oc-fleet-inspector").length, 1)
    assert.equal(container.querySelector(".oc-fleet-inspector .oc-current-head b")?.textContent, "Worker")
    assert.match(container.querySelector(".oc-fleet-inspector")?.textContent ?? "", /spawned/)
    assert.equal(
      container.querySelector(".oc-fleet-delegation-row")?.getAttribute("title"),
      "hand off",
    )
    dispose()
  })

  test("opens and unpins from the inspector and toggles the same card off", async () => {
    const model = treeModel()
    const opened: Array<{ target: unknown; options: unknown }> = []
    const ctx = makePluginContext({
      tabs: { open: (target: unknown, options: unknown) => opened.push({ target, options }) },
    })
    const session = makeSessionProps().session
    const { container, dispose } = mount(
      () => <FleetPanel fleet={model as never} session={session} attachFleetStage={() => {}} />,
      ctx,
    )
    await settle()
    const card = (id: string) =>
      container.querySelector<HTMLButtonElement>(`.oc-fleet-card[data-fleet-id="${id}"]`)!

    card("ses_b").click()
    await settle()
    const delegation = container.querySelector<HTMLButtonElement>(".oc-fleet-delegation-row")!
    delegation.click()
    await settle()
    assert.equal(container.querySelector(".oc-fleet-inspector .oc-current-head b")?.textContent, "Idle")
    assert.deepEqual(container.querySelectorAll(".oc-fleet-delegation-row").length, 0)
    const open = [...container.querySelectorAll<HTMLButtonElement>(".oc-toggle")].find(
      (button) => button.textContent === "Open",
    )!
    open.click()
    assert.deepEqual(opened, [
      { target: { server: "srv_test", id: "ses_c" }, options: { focus: true } },
    ])
    const unpin = [...container.querySelectorAll<HTMLButtonElement>(".oc-toggle")].find(
      (button) => button.textContent === "Unpin",
    )!
    unpin.click()
    await settle()
    assert.equal(container.querySelector(".oc-fleet-inspector"), null)
    assert.equal(card("ses_c").getAttribute("aria-pressed"), "false")

    card("ses_b").click()
    card("ses_b").click()
    await settle()
    assert.equal(container.querySelector(".oc-fleet-inspector"), null)
    assert.equal(card("ses_b").getAttribute("aria-pressed"), "false")
    dispose()
  })

  test("switches timeline fit, modes and picks an agent from a lane", async () => {
    const model = timelineModel()
    const { container, dispose } = mount(() => (
      <FleetPanel fleet={model as never} session={makeSessionProps().session} attachFleetStage={() => {}} />
    ))
    await settle()
    assert.match(container.querySelector(".oc-hint")?.textContent ?? "", /shared clock/)
    assert.ok([...container.querySelectorAll(".oc-chip")].some((chip) => chip.textContent?.includes("Parallel")))
    assert.equal(container.querySelectorAll(".oc-fleet-timeline-lane").length, 3)
    assert.equal(model.fleetFocus(), undefined)
    assert.equal(segmentButton(container, "Adaptive").classList.contains("oc-segment-btn-on"), true)
    assert.equal(segmentButton(container, "Overview").classList.contains("oc-segment-btn-on"), false)
    segmentButton(container, "Overview").click()
    assert.equal(model.fleetTimelineFit(), "overview")
    assert.equal(segmentButton(container, "Overview").classList.contains("oc-segment-btn-on"), true)
    segmentButton(container, "Adaptive").click()
    assert.equal(model.fleetTimelineFit(), "adaptive")

    const lane = (id: string) => {
      const title = id === "ses_b" ? "Worker" : id === "ses_c" ? "Idle" : "Lead"
      return [...container.querySelectorAll<HTMLButtonElement>(".oc-fleet-timeline-lane")].find(
        (item) => item.title === title,
      )!
    }
    lane("ses_b").dispatchEvent(new MouseEvent("mouseenter"))
    await settle()
    assert.equal(container.querySelector(".oc-fleet-inspector .oc-current-head b")?.textContent, "Worker")
    lane("ses_b").dispatchEvent(new MouseEvent("mouseleave"))
    await settle()
    assert.equal(container.querySelector(".oc-fleet-inspector"), null)
    lane("ses_c").click()
    await settle()
    assert.equal(model.fleetPinned(), "ses_c")
    assert.equal(container.querySelector(".oc-fleet-inspector .oc-current-head b")?.textContent, "Idle")
    lane("ses_c").click()
    await settle()
    assert.equal(model.fleetPinned(), undefined)
    assert.equal(container.querySelector(".oc-fleet-inspector"), null)

    segmentButton(container, "Tree").click()
    assert.equal(model.fleetMode(), "tree")
    assert.equal(segmentButton(container, "Tree").classList.contains("oc-segment-btn-on"), true)
    assert.equal(segmentButton(container, "Timeline").classList.contains("oc-segment-btn-on"), false)
    assert.equal(segmentButton(container, "Adaptive").disabled, true)
    assert.equal(segmentButton(container, "Adaptive").style.opacity, "0.4")
    assert.equal(segmentButton(container, "Overview").disabled, true)
    assert.equal(
      [...container.querySelectorAll(".oc-chip")].some((chip) => chip.textContent?.includes("Parallel")),
      false,
    )
    assert.equal(container.querySelectorAll(".oc-fleet-card").length, 3)
    segmentButton(container, "Timeline").click()
    assert.equal(model.fleetMode(), "timeline")
    assert.equal(segmentButton(container, "Adaptive").disabled, false)
    dispose()
  })

  test("shows the empty and solo fallbacks", () => {
    const empty = makeFleetModel({ nodes: [] })
    const first = mount(() => (
      <FleetPanel fleet={empty as never} session={makeSessionProps().session} attachFleetStage={() => {}} />
    ))
    assert.match(first.container.querySelector(".oc-muted")?.textContent ?? "", /still loading/)
    assert.equal(first.container.querySelectorAll(".oc-fleet-timeline-lane").length, 0)
    first.dispose()

    const solo = fleetNode({ id: "ses_solo", title: "Only", isCurrent: true })
    const single = makeFleetModel({ nodes: [solo] })
    const second = mount(() => (
      <FleetPanel fleet={single as never} session={makeSessionProps().session} attachFleetStage={() => {}} />
    ))
    assert.match(second.container.textContent ?? "", /only member/)
    assert.equal(second.container.querySelectorAll(".oc-fleet-timeline-label").length, 1)
    second.dispose()
  })

  test("renders a tree without categories and accepts an object stage ref", () => {
    const model = makeFleetModel({ nodes: [root], mode: "tree", categories: [] })
    const stage = { current: null as HTMLDivElement | null }
    const { container, dispose } = mount(() => (
      <FleetPanel
        fleet={model as never}
        session={makeSessionProps().session}
        attachFleetStage={stage as never}
      />
    ))
    assert.equal(container.querySelectorAll(".oc-chip-row").length, 1)
    assert.equal(container.querySelectorAll(".oc-fleet-card").length, 1)
    assert.equal(stage.current, null)
    dispose()
  })
})
