import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { buildFleet, fleetDurationOf, fleetTotals, layoutFleet } from "../../src/shared/fleet.ts"
import { at, session } from "./fleetFixtures.ts"

describe("buildFleet", () => {
  test("covers the current session's root, siblings and descendants", () => {
    const sessions = [
      session("root", undefined),
      session("a", "root", { time: { created: at(0), updated: at(5) } }),
      session("a1", "a", { time: { created: at(0), updated: at(4) } }),
      session("b", "root", { time: { created: at(0), updated: at(2) } }),
      session("other", undefined, { time: { created: at(0), updated: at(9) } }),
    ]
    const forest = buildFleet(sessions, "a", () => false)

    assert.equal(forest.rootID, "root")
    assert.deepEqual(forest.nodes.map((node) => node.id), ["root", "a", "a1", "b"])
    assert.deepEqual(forest.nodes.map((node) => node.depth), [0, 1, 2, 1])
    assert.deepEqual(forest.nodes.map((node) => node.family), [-1, 0, 0, 1])
    assert.deepEqual(forest.edges.map((edge) => [edge.from, edge.to]), [
      ["root", "a"],
      ["a", "a1"],
      ["root", "b"],
    ])
    assert.equal(forest.nodes.find((node) => node.id === "a")?.isCurrent, true)
    assert.deepEqual(fleetTotals(forest.nodes), { agents: 4, running: 0, prompt: 400, output: 44, cost: 0.4 })
  })

  test("sorts children by creation time and marks outcomes", () => {
    const sessions = [
      session("root", undefined),
      session("slow", "root", { time: { created: at(1), updated: at(9) }, outcome: "failed" }),
      session("done", "root", { time: { created: at(2), updated: at(4) }, outcome: "succeeded" }),
      session("live", "root", { time: { created: at(3), updated: at(5) } }),
    ]
    const forest = buildFleet(sessions, "root", (id) => id === "live")

    assert.deepEqual(forest.nodes.map((node) => node.id), ["root", "slow", "done", "live"])
    const byID = new Map(forest.nodes.map((node) => [node.id, node]))
    assert.equal(byID.get("live")?.running, true)
    assert.equal(byID.get("live")?.completed, false)
    assert.equal(byID.get("done")?.completed, true)
    assert.equal(byID.get("slow")?.completed, false)
    assert.equal(byID.get("slow")?.outcome, "failed")
    assert.equal(fleetTotals(forest.nodes).running, 1)
  })
})

describe("fleetDurationOf", () => {
  test("prefers the latest run and keeps a live run open", () => {
    assert.equal(fleetDurationOf({ created: at(0), updated: at(15), busy: at(10), idle: at(13) }, false, at(20)), 3 * 60_000)
    assert.equal(fleetDurationOf({ created: at(0), updated: at(15), busy: at(10), idle: at(13) }, true, at(20)), 10 * 60_000)
    assert.equal(fleetDurationOf({ created: at(0), updated: at(4) }, false, at(20)), 4 * 60_000)
    assert.equal(fleetDurationOf({ created: at(5), updated: at(5) }, false, at(20)), undefined)
  })
})

describe("layoutFleet", () => {
  test("centres the parent above its leaves", () => {
    const forest = buildFleet(
      [session("root", undefined), session("a", "root"), session("b", "root")],
      "root",
      () => false,
    )
    const layout = layoutFleet(forest)

    assert.equal(layout.banded, false)
    assert.equal(layout.width, 520)
    assert.equal(layout.cardWidth, 248)
    assert.deepEqual(layout.points.map((point) => [point.id, point.x]), [
      ["root", 260],
      ["a", 130],
      ["b", 390],
    ])
    assert.deepEqual(layout.links.map((link) => [link.from, link.to]), [
      ["root", "a"],
      ["root", "b"],
    ])
    assert.equal(layout.links[0].y1, layout.links[0].y2 - 56)
  })

  test("wraps a wide family into bands that fit the stage", () => {
    const forest = buildFleet(
      [
        session("root", undefined),
        session("a", "root"),
        session("b", "root"),
        session("c", "root"),
      ],
      "root",
      () => false,
    )
    const layout = layoutFleet(forest, 420)

    assert.equal(layout.banded, true)
    assert.equal(layout.width, 420)
    assert.equal(layout.points.length, 4)
    for (const point of layout.points) {
      assert.ok(point.x >= layout.cardWidth / 2 - 6)
      assert.ok(point.x <= layout.width - layout.cardWidth / 2 + 6)
    }
    assert.equal(layout.links.length, 3)
  })
})
