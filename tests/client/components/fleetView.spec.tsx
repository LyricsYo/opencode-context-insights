import assert from "node:assert/strict"
import { afterEach, describe, test } from "vitest"
import { FleetTimelineView } from "../../../src/client/components/fleetView.tsx"
import { FLEET_BODY_MAX_H } from "../../../src/client/fleetModel.ts"
import {
  FLEET_T0,
  fleetNode,
  fleetTimelineOf,
  fleetTimelineRow,
} from "../helpers/fleetUi.ts"
import type { FleetTimeline } from "../../../src/shared/fleet.ts"
import { mount } from "../helpers/mount.tsx"

const MINUTE = 60_000

const nodeA = fleetNode({ id: "ses_a", title: "Lead", family: -1, isCurrent: true, depth: 0 })
const nodeB = fleetNode({
  id: "ses_b",
  title: "Worker",
  family: 0,
  running: true,
  depth: 2,
  createdAt: FLEET_T0 + 2 * MINUTE,
})
const nodeC = fleetNode({ id: "ses_c", title: "Idle", family: 1, depth: 1, createdAt: FLEET_T0 + 3 * MINUTE })

function richTimeline(): FleetTimeline {
  const rows = [
    fleetTimelineRow(nodeA, [{ start: FLEET_T0, end: FLEET_T0 + 5 * MINUTE }]),
    fleetTimelineRow(nodeB, [{ start: FLEET_T0 + 2 * MINUTE, end: FLEET_T0 + 10 * MINUTE }]),
    fleetTimelineRow(nodeC, []),
  ]
  return fleetTimelineOf(rows, {
    start: FLEET_T0,
    end: FLEET_T0 + 10 * MINUTE,
    now: FLEET_T0 + 6 * MINUTE,
    peak: 2,
    buckets: [0, 1, 2, 1, 0],
    links: [
      { parentID: "ses_a", childID: "ses_b", at: FLEET_T0 + 2 * MINUTE, childStart: FLEET_T0 + 2 * MINUTE, from: 0, to: 1 },
      { parentID: "ses_a", childID: "ses_ghost", at: FLEET_T0, childStart: FLEET_T0, from: 0, to: 9 },
    ],
    segments: [
      { start: FLEET_T0, end: FLEET_T0 + 5 * MINUTE, from: 0, to: 0.6, gap: 0 },
      { start: FLEET_T0 + 7 * MINUTE, end: FLEET_T0 + 9 * MINUTE, from: 0.6, to: 0.9, gap: 120_000 },
      { start: FLEET_T0 + 9 * MINUTE, end: FLEET_T0 + 10 * MINUTE, from: 0.9, to: 1, gap: 30_000 },
    ],
    active: 8 * MINUTE,
    activeSum: 13 * MINUTE,
  })
}

function timelineWith(overrides: Partial<FleetTimeline>): FleetTimeline {
  const base = richTimeline()
  return { ...base, ...overrides }
}

afterEach(() => {
  // The setup file restores its stub only once; put the shared stub back after tests that replace it.
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
  class Stub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = Stub as unknown as typeof ResizeObserver
})

describe("FleetTimelineView", () => {
  test("draws an adaptive timeline with axis, rows, links, gaps and the now marker", async () => {
    const hovered: Array<string | null> = []
    const picked: string[] = []
    const focusDone: string[] = []
    const timeline = richTimeline()
    const { container, dispose } = mount(() => (
      <FleetTimelineView
        timeline={timeline}
        fit="adaptive"
        selected="ses_b"
        focus="ses_b"
        onFocusDone={() => focusDone.push("done")}
        onHover={(id) => hovered.push(id)}
        onPick={(id) => picked.push(id)}
      />
    ))
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(container.querySelectorAll(".oc-fleet-timeline-label").length, 3)
    assert.equal(container.querySelectorAll(".oc-fleet-timeline-lane").length, 3)
    assert.equal(container.querySelectorAll(".oc-fleet-timeline-bar").length, 3)
    assert.equal(container.querySelectorAll(".oc-fleet-timeline-grid").length, 3)
    assert.equal(container.querySelectorAll(".oc-fleet-timeline-gap").length, 1)
    const bodyCanvas = container.querySelector<HTMLElement>(
      ".oc-fleet-timeline-body-scroll .oc-fleet-timeline-canvas",
    )!
    assert.match(bodyCanvas.style.width, /^max\(100%, \d+px\)$/)
    assert.ok(container.querySelector(".oc-fleet-timeline-now"))
    assert.match(container.querySelector(".oc-fleet-timeline-parallel-head")?.textContent ?? "", /2/)
    const workerLabel = [...container.querySelectorAll<HTMLButtonElement>(".oc-fleet-timeline-label")].find(
      (item) => item.textContent?.includes("Worker"),
    )!
    assert.match(workerLabel.firstElementChild?.getAttribute("style") ?? "", /padding-left: 16px/)
    assert.deepEqual(focusDone, ["done"])

    const links = [...container.querySelectorAll(".oc-fleet-timeline-links path")]
    assert.equal(links.length, 2)
    assert.equal(links[0].getAttribute("stroke-dasharray"), "4 3")
    assert.equal(links[0].getAttribute("opacity"), "0.55")
    assert.equal(links[1].getAttribute("stroke-dasharray"), null)
    assert.equal(links[1].getAttribute("opacity"), "0.55")

    const bars = [...container.querySelectorAll<HTMLElement>(".oc-fleet-parallel-bars span")]
    assert.equal(bars.length, 5)
    assert.equal(bars[0].style.minHeight, "0px")
    assert.equal(bars[1].style.minHeight, "2px")
    assert.equal(bars[1].style.background, "rgb(91, 141, 239)")
    assert.equal(bars[2].style.background, "rgb(34, 160, 107)")
    assert.equal(bars[0].style.opacity, "0.06")

    const selectedLane = [...container.querySelectorAll<HTMLElement>(".oc-fleet-timeline-lane")].find(
      (lane) => lane.title === "Worker",
    )!
    assert.match(selectedLane.style.background, /color-mix/)

    const label = [...container.querySelectorAll<HTMLButtonElement>(".oc-fleet-timeline-label")].find(
      (item) => item.textContent?.includes("Worker"),
    )!
    label.dispatchEvent(new MouseEvent("mouseenter"))
    label.dispatchEvent(new MouseEvent("mouseleave"))
    label.click()
    const lane = [...container.querySelectorAll<HTMLButtonElement>(".oc-fleet-timeline-lane")].find(
      (item) => item.title === "Idle",
    )!
    lane.dispatchEvent(new MouseEvent("mouseenter"))
    lane.dispatchEvent(new MouseEvent("mouseleave"))
    lane.click()
    assert.deepEqual(hovered, ["ses_b", null, "ses_c", null])
    assert.deepEqual(picked, ["ses_b", "ses_c"])
    dispose()
  })

  test("overview mode fits the width and dims rows outside the lit chain", () => {
    const timeline = timelineWith({ now: FLEET_T0 + 20 * MINUTE, peak: 1, buckets: [1] })
    const { container, dispose } = mount(() => (
      <FleetTimelineView
        timeline={timeline}
        fit="overview"
        selected="ses_c"
        lit={new Set(["ses_a"])}
        focus="ses_b"
        onFocusDone={() => {}}
        onHover={() => {}}
        onPick={() => {}}
      />
    ))
    const root = container.querySelector<HTMLElement>(".oc-fleet-timeline")!
    assert.equal(root.style.maxHeight, "none")
    const canvas = container.querySelector<HTMLElement>(".oc-fleet-timeline-header .oc-fleet-timeline-canvas")!
    assert.equal(canvas.style.width, "100%")
    assert.equal(container.querySelectorAll(".oc-fleet-timeline-lane").length, 3)
    const labels = [...container.querySelectorAll<HTMLElement>(".oc-fleet-timeline-label")]
    assert.equal(labels.find((item) => item.textContent?.includes("Worker"))?.style.opacity, "0.35")
    assert.equal(labels.find((item) => item.textContent?.includes("Lead"))?.style.opacity, "1")
    const bodies = [...container.querySelectorAll<HTMLElement>(".oc-fleet-timeline-body-scroll")]
    assert.equal(bodies[0].style.overflow, "hidden")
    const links = [...container.querySelectorAll(".oc-fleet-timeline-links path")]
    assert.equal(links[0].getAttribute("opacity"), "0.1")
    assert.equal(container.querySelector(".oc-fleet-timeline-now"), null)
    dispose()
  })

  test("reserves a strip for the horizontal scrollbar only when every row fits", async () => {
    // jsdom reports no scrollbar, so fake the difference a real renderer shows.
    const proto = HTMLElement.prototype
    const offset = Object.getOwnPropertyDescriptor(proto, "offsetHeight")
    const client = Object.getOwnPropertyDescriptor(proto, "clientHeight")
    Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 340 })
    Object.defineProperty(proto, "clientHeight", { configurable: true, get: () => 328 })
    try {
      const short = mount(() => (
        <FleetTimelineView timeline={richTimeline()} fit="adaptive" onHover={() => {}} onPick={() => {}} />
      ))
      await new Promise((resolve) => setTimeout(resolve, 0))
      const shortBody = short.container.querySelector<HTMLElement>(".oc-fleet-timeline-body-scroll")!
      assert.equal(shortBody.style.height, `${3 * 24 + 12}px`)
      short.dispose()

      const tallNode = fleetNode({ id: "ses_tall" })
      const tallRows = Array.from({ length: 40 }, (_, index) =>
        fleetTimelineRow(fleetNode({ id: `ses_${index}`, title: `Agent ${index}` }), [
          { start: FLEET_T0, end: FLEET_T0 + MINUTE * (index + 1) },
        ]),
      )
      const tall = mount(() => (
        <FleetTimelineView
          timeline={fleetTimelineOf([fleetTimelineRow(tallNode, []), ...tallRows])}
          fit="adaptive"
          onHover={() => {}}
          onPick={() => {}}
        />
      ))
      await new Promise((resolve) => setTimeout(resolve, 0))
      const tallBody = tall.container.querySelector<HTMLElement>(".oc-fleet-timeline-body-scroll")!
      assert.equal(tallBody.style.height, `${FLEET_BODY_MAX_H}px`)
      tall.dispose()
    } finally {
      if (offset === undefined) delete (proto as unknown as Record<string, unknown>).offsetHeight
      else Object.defineProperty(proto, "offsetHeight", offset)
      if (client === undefined) delete (proto as unknown as Record<string, unknown>).clientHeight
      else Object.defineProperty(proto, "clientHeight", client)
    }
  })

  test("renders an empty timeline with a single fallback row height", () => {
    const timeline = fleetTimelineOf([])
    const { container, dispose } = mount(() => (
      <FleetTimelineView
        timeline={timeline}
        fit="adaptive"
        onHover={() => {}}
        onPick={() => {}}
      />
    ))
    assert.equal(container.querySelectorAll(".oc-fleet-timeline-label").length, 0)
    assert.equal(container.querySelectorAll(".oc-fleet-timeline-lane").length, 0)
    assert.equal(container.querySelectorAll(".oc-fleet-timeline-bar").length, 0)
    assert.equal(container.querySelector(".oc-fleet-timeline-now"), null)
    const lanes = container.querySelector<HTMLElement>(".oc-fleet-timeline-lanes")!
    assert.equal(lanes.style.height, "24px")
    const body = container.querySelector<HTMLElement>(".oc-fleet-timeline-body-scroll")!
    assert.equal(body.style.height, "24px")
    dispose()
  })

  test("scrolls the picked row to the top and syncs the fixed columns", async () => {
    const timeline = richTimeline()
    const errors: unknown[] = []
    const { container, dispose } = mount(() => {
      try {
        return (
          <FleetTimelineView
            timeline={timeline}
            fit="adaptive"
            focus="ses_c"
            onFocusDone={() => {}}
            onHover={() => {}}
            onPick={() => {}}
          />
        )
      } catch (error) {
        errors.push(error)
        throw error
      }
    })
    container.setAttribute("data-panel-scroll", "")
    await new Promise((resolve) => setTimeout(resolve, 0))
    const body = container.querySelector<HTMLElement>(".oc-fleet-timeline-body-scroll")!
    assert.equal(body.scrollTop, 48)
    assert.deepEqual(errors, [])
    dispose()
  })

  test("ignores a focus target that left the fleet", async () => {
    const focusDone: string[] = []
    const timeline = richTimeline()
    const { container, dispose } = mount(() => (
      <FleetTimelineView
        timeline={timeline}
        fit="overview"
        focus="ses_missing"
        onFocusDone={() => focusDone.push("done")}
        onHover={() => {}}
        onPick={() => {}}
      />
    ))
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(focusDone, ["done"])
    assert.equal(container.querySelector<HTMLElement>(".oc-fleet-timeline-body-scroll")?.scrollTop, 0)
    dispose()
  })

  test("tracks the visible width and height through ResizeObserver", () => {
    class FakeObserver {
      static last: FakeObserver | undefined
      readonly callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
        FakeObserver.last = this
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    const previous = globalThis.ResizeObserver
    globalThis.ResizeObserver = FakeObserver as unknown as typeof ResizeObserver
    try {
      const nodes = Array.from({ length: 20 }, (_, index) =>
        fleetTimelineRow(fleetNode({ id: `ses_${index}`, title: `Agent ${index}`, createdAt: FLEET_T0 + index })),
      )
      const timeline = fleetTimelineOf(nodes, {
        start: FLEET_T0,
        end: FLEET_T0 + 10 * MINUTE,
        peak: 1,
        buckets: [1, 0],
      })
      const { container, dispose } = mount(() => (
        <FleetTimelineView
          timeline={timeline}
          fit="adaptive"
          onHover={() => {}}
          onPick={() => {}}
        />
      ))
      assert.ok(FakeObserver.last)
      FakeObserver.last.callback([], {} as ResizeObserver)
      FakeObserver.last.callback(
        [{ contentRect: { width: 640, height: 100 } }] as unknown as ResizeObserverEntry[],
        FakeObserver.last as unknown as ResizeObserver,
      )
      assert.equal(container.querySelectorAll(".oc-fleet-timeline-tick").length, 4)
      const labels = container.querySelector<HTMLElement>(".oc-fleet-timeline-labels")!
      assert.equal(labels.style.height, "100px")
      FakeObserver.last.callback(
        [{ contentRect: { width: 0, height: 0 } }] as unknown as ResizeObserverEntry[],
        FakeObserver.last as unknown as ResizeObserver,
      )
      assert.equal(container.querySelectorAll(".oc-fleet-timeline-tick").length, 4)
      assert.equal(labels.style.height, "100px")
      dispose()
    } finally {
      globalThis.ResizeObserver = previous
    }
  })

  test("mounts without ResizeObserver", () => {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
    const timeline = richTimeline()
    const { container, dispose } = mount(() => (
      <FleetTimelineView
        timeline={timeline}
        fit="adaptive"
        onHover={() => {}}
        onPick={() => {}}
      />
    ))
    assert.equal(container.querySelectorAll(".oc-fleet-timeline-lane").length, 3)
    dispose()
  })
})
