import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { FleetNode } from "../../src/shared/fleet.ts"
import {
  fleetAxisLabel,
  fleetDelegationMark,
  fleetHue,
  fleetInitials,
  fleetKindColor,
  fleetKindLabel,
  fleetLinkPath,
  fleetStatusColor,
  fleetTickPosition,
  FLEET_ROW_H,
} from "../../src/client/fleetModel.ts"
import { CATEGORY_COLOR } from "../../src/client/colors.ts"

const node = (patch: Partial<FleetNode>): FleetNode =>
  ({
    id: "root",
    parentID: undefined,
    title: "Root",
    depth: 0,
    family: -1,
    running: false,
    completed: true,
    ...patch,
  }) as FleetNode

describe("fleetInitials", () => {
  test("takes one CJK character or the first two Latin initials", () => {
    assert.equal(fleetInitials("  "), "?")
    assert.equal(fleetInitials("审查代码"), "审")
    assert.equal(fleetInitials("scan the repo"), "ST")
    assert.equal(fleetInitials("single"), "S")
  })
})

describe("fleetStatusColor", () => {
  test("maps running, failed, interrupted, completed and pending", () => {
    assert.equal(fleetStatusColor(node({ running: true })), "#22a06b")
    assert.equal(fleetStatusColor(node({ outcome: "failed" })), "#d64545")
    assert.equal(fleetStatusColor(node({ outcome: "interrupted" })), "#c9a227")
    assert.equal(fleetStatusColor(node({ completed: true })), "#7f8c8d")
    assert.equal(fleetStatusColor(node({ completed: false })), "#c9a227")
  })
})

describe("fleetHue", () => {
  test("the lead keeps its hue while a family branch gets its own", () => {
    assert.equal(fleetHue(undefined), "#5b8def")
    assert.equal(fleetHue(node({ isCurrent: true, family: 2 })), "#5b8def")
    assert.equal(fleetHue(node({ family: -1 })), "#5b8def")
    assert.notEqual(fleetHue(node({ family: 2 })), "#5b8def")
    assert.equal(fleetHue(node({ family: 2 })), fleetHue(node({ family: 2 })))
  })
})

describe("fleetLinkPath", () => {
  test("curves between the two row centres with a bounded control offset", () => {
    const path = fleetLinkPath({ x1: 0, y1: 0, x2: 100, y2: 100, from: 0, to: 1, parentID: "root", childID: "child", at: 0, childStart: 0 } as never)
    assert.match(path, /^M 0 0 C 0 45, 100 55, 100 100$/)
  })
})

describe("fleetAxisLabel", () => {
  test("adds seconds under ten minutes, minutes under a week, else the day", () => {
    const at = Date.UTC(2026, 10, 16, 8, 41, 7)
    assert.match(fleetAxisLabel(at, 60_000), /^11-16 \d{2}:41:07$/)
    assert.match(fleetAxisLabel(at, 3600_000), /^11-16 \d{2}:41$/)
    assert.equal(fleetAxisLabel(at, 8 * 24 * 3600_000), "11-16")
  })
})

describe("fleetTickPosition", () => {
  test("pins the first tick left, the last right and centres the rest", () => {
    assert.deepEqual(fleetTickPosition(0, 5, 0), { left: "0%" })
    assert.deepEqual(fleetTickPosition(2, 5, 0.5), { left: "50%", transform: "translateX(-50%)" })
    assert.deepEqual(fleetTickPosition(4, 5, 1), { left: "100%", transform: "translateX(-100%)" })
  })
})

describe("fleetKindLabel", () => {
  test("maps transcript kinds to their labels", () => {
    const t = (key: string) => key
    assert.equal(fleetKindLabel(t, "user"), "fleet.kind.prompt")
    assert.equal(fleetKindLabel(t, "reply"), "fleet.kind.reply")
    assert.equal(fleetKindLabel(t, "skill"), "fleet.kind.skill")
    assert.equal(fleetKindLabel(t, "system"), "fleet.kind.context")
  })
})

describe("fleetKindColor", () => {
  test("reuses the context-composition category colours", () => {
    assert.equal(fleetKindColor("user"), CATEGORY_COLOR.user)
    assert.equal(fleetKindColor("reply"), CATEGORY_COLOR.assistant)
    assert.equal(fleetKindColor("skill"), CATEGORY_COLOR.skills)
    assert.equal(fleetKindColor("system"), CATEGORY_COLOR.injected)
    assert.equal(fleetKindColor("synthetic"), CATEGORY_COLOR.injected)
  })
})

describe("fleetDelegationMark", () => {
  test("maps a delegation status to its glyph and tone", () => {
    assert.deepEqual(fleetDelegationMark("completed"), { glyph: "✓", color: "#22a06b" })
    assert.deepEqual(fleetDelegationMark("error"), { glyph: "✗", color: "#d64545" })
    assert.deepEqual(fleetDelegationMark("failed"), { glyph: "✗", color: "#d64545" })
    assert.deepEqual(fleetDelegationMark("running"), { glyph: "●", color: "#c9a227" })
    assert.deepEqual(fleetDelegationMark(undefined), { glyph: "⇢", color: "#5b8def" })
    assert.deepEqual(fleetDelegationMark("streaming"), { glyph: "⇢", color: "#5b8def" })
  })
})

describe("FLEET_ROW_H", () => {
  test("keeps the one-pixel-per-five-seconds density", () => {
    assert.equal(FLEET_ROW_H, 24)
  })
})
