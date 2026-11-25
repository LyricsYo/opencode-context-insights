import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { SessionMessageInfo } from "@opencode/client"
import {
  buildFleet,
  buildFleetTimeline,
  fleetPositionOf,
  fleetSpansOf,
  fleetTimeAt,
  type FleetSpanCacheEntry,
} from "../../src/shared/fleet.ts"
import { at, session, timedMessage } from "./fleetFixtures.ts"

describe("fleetSpansOf", () => {
  test("merges steps in one turn and splits on a user message", () => {
    const spans = fleetSpansOf(
      [
        timedMessage("user", 0),
        timedMessage("assistant", 1, 2),
        timedMessage("assistant", 3, 4),
        timedMessage("user", 10),
        timedMessage("assistant", 11, 12),
      ],
      { createdAt: 0, updatedAt: 12, idle: at(12), running: false },
      at(20),
    )

    assert.deepEqual(
      spans.map((span) => [span.start, span.end]),
      [
        [at(1), at(4)],
        [at(11), at(12)],
      ],
    )
  })

  test("removes question waits from an agent's active spans", () => {
    const message = {
      id: "a1",
      type: "assistant",
      agent: "build",
      model: { id: "m", providerID: "p" },
      time: { created: at(1), completed: at(10) },
      content: [
        {
          type: "tool",
          id: "q1",
          name: "question",
          time: { created: at(2), ran: at(2), completed: at(8) },
          state: { status: "completed", input: {}, content: [] },
        },
      ],
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0,
    } as unknown as SessionMessageInfo

    const spans = fleetSpansOf([message], { createdAt: 0, updatedAt: at(10), idle: at(10), running: false }, at(20))
    assert.deepEqual(spans.map((span) => [span.start, span.end]), [
      [at(1), at(2)],
      [at(8), at(10)],
    ])
  })

  test("stops a running span at an open question wait", () => {
    const message = {
      id: "a1",
      type: "assistant",
      agent: "build",
      model: { id: "m", providerID: "p" },
      time: { created: at(1) },
      content: [
        {
          type: "tool",
          id: "q1",
          name: "question",
          time: { created: at(2), ran: at(2) },
          state: { status: "running", input: {}, metadata: {} },
        },
      ],
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0,
    } as unknown as SessionMessageInfo

    const spans = fleetSpansOf([message], { createdAt: 0, updatedAt: at(3), running: true }, at(20))
    assert.deepEqual(spans.map((span) => [span.start, span.end]), [[at(1), at(2)]])
  })

  test("removes subagent waits from the parent's active spans", () => {
    const base = {
      type: "assistant",
      agent: "build",
      model: { id: "m", providerID: "p" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0,
    }
    const messages = [
      {
        ...base,
        id: "a1",
        time: { created: at(1), completed: at(2) },
        content: [
          {
            type: "tool",
            id: "t1",
            name: "subagent",
            time: { created: at(1), ran: at(2), completed: at(8) },
            state: { status: "completed", input: {}, content: [] },
          },
        ],
      },
      { ...base, id: "a2", time: { created: at(9), completed: at(10) }, content: [] },
    ] as unknown as SessionMessageInfo[]

    const spans = fleetSpansOf(messages, { createdAt: 0, updatedAt: at(10), idle: at(10), running: false }, at(20))
    assert.deepEqual(spans.map((span) => [span.start, span.end]), [
      [at(1), at(2)],
      [at(8), at(10)],
    ])
  })

  test("stops a running span at an open subagent wait", () => {
    const message = {
      id: "a1",
      type: "assistant",
      agent: "build",
      model: { id: "m", providerID: "p" },
      time: { created: at(1) },
      content: [
        {
          type: "tool",
          id: "t1",
          name: "subagent",
          time: { created: at(1), ran: at(2) },
          state: { status: "running", input: {}, metadata: {} },
        },
      ],
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0,
    } as unknown as SessionMessageInfo

    const spans = fleetSpansOf([message], { createdAt: 0, updatedAt: at(3), running: true }, at(20))
    assert.deepEqual(spans.map((span) => [span.start, span.end]), [[at(1), at(2)]])
  })

  test("does not stretch a stale running tail to the wall clock", () => {
    const message = {
      id: "a1",
      type: "assistant",
      agent: "build",
      model: { id: "m", providerID: "p" },
      time: { created: at(1), streamed: at(1) + 17_000 },
      content: [{ type: "text", text: "partial" }],
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0,
    } as unknown as SessionMessageInfo
    const spans = fleetSpansOf(
      [message],
      { createdAt: 0, updatedAt: at(1) + 18_000, running: true },
      at(1) + 200_000,
    )
    assert.deepEqual(spans.map((span) => [span.start, span.end]), [[at(1), at(1) + 15_000]])
  })

  test("keeps a background subagent wait out of the parent's spans when idle", () => {
    const base = {
      type: "assistant",
      agent: "build",
      model: { id: "m", providerID: "p" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0,
    }
    const messages = [
      {
        ...base,
        id: "a1",
        time: { created: at(1), completed: at(2) },
        content: [
          {
            type: "tool",
            id: "t1",
            name: "subagent",
            time: { created: at(1), ran: at(2), completed: at(2) + 20 },
            state: { status: "completed", input: { background: true }, content: [] },
          },
        ],
      },
      { id: "i1", type: "idle", outcome: "succeeded", time: { created: at(3) } },
      { ...base, id: "a2", time: { created: at(10), completed: at(11) }, content: [] },
      { id: "i2", type: "idle", outcome: "succeeded", time: { created: at(11) } },
    ] as unknown as SessionMessageInfo[]

    const spans = fleetSpansOf(messages, { createdAt: 0, updatedAt: at(11), idle: at(11), running: false }, at(20))
    assert.deepEqual(spans.map((span) => [span.start, span.end]), [
      [at(1), at(2)],
      [at(10), at(11)],
    ])
  })
})

describe("buildFleetTimeline", () => {
  test("finds overlapping agents and links a delegation", () => {
    const forest = buildFleet(
      [
        session("root", undefined, { time: { created: at(0), updated: at(10) } }),
        session("child", "root", { time: { created: at(2), updated: at(8) } }),
      ],
      "root",
      () => false,
    )
    const messages = new Map([
      ["root", [timedMessage("user", 0), timedMessage("assistant", 0, 10)]],
      ["child", [timedMessage("user", 2), timedMessage("assistant", 2, 8)]],
    ])
    const timeline = buildFleetTimeline(forest, (id) => messages.get(id) ?? [], new Map([["child", at(2)]]), at(20))

    assert.equal(timeline.rows.length, 2)
    assert.equal(timeline.links.length, 1)
    assert.equal(timeline.links[0].parentID, "root")
    assert.equal(timeline.links[0].childID, "child")
    assert.equal(timeline.links[0].from, 0)
    assert.equal(timeline.links[0].to, 1)
    assert.equal(timeline.peak, 2)
    assert.equal(timeline.active, 10 * 60_000)
    assert.equal(timeline.activeSum, 16 * 60_000)
    assert.ok(timeline.buckets.some((count) => count >= 2))
    assert.ok(timeline.start <= at(0))
    assert.ok(timeline.end >= at(10))
    assert.equal(timeline.ticks.length, 5)
  })

  test("reuses inactive spans until the structure version moves", () => {
    const forest = buildFleet(
      [
        session("root", undefined, { time: { created: at(0), updated: at(10) } }),
        session("child", "root", { time: { created: at(2), updated: at(8) } }),
      ],
      "root",
      () => false,
    )
    const messages = new Map([
      ["root", [timedMessage("user", 0), timedMessage("assistant", 0, 10)]],
      ["child", [timedMessage("user", 2), timedMessage("assistant", 2, 8)]],
    ])
    const cache = new Map<string, FleetSpanCacheEntry>()
    const first = buildFleetTimeline(forest, (id) => messages.get(id) ?? [], new Map(), at(20), cache, "s1")
    const second = buildFleetTimeline(forest, (id) => messages.get(id) ?? [], new Map(), at(20), cache, "s1")
    assert.equal(second.rows[0].spans, first.rows[0].spans)

    const third = buildFleetTimeline(forest, (id) => messages.get(id) ?? [], new Map(), at(20), cache, "s2")
    assert.notEqual(third.rows[0].spans, first.rows[0].spans)
  })

  test("falls back to the child's creation time for a link", () => {
    const forest = buildFleet(
      [
        session("root", undefined, { time: { created: at(0), updated: at(10) } }),
        session("child", "root", { time: { created: at(4), updated: at(8) } }),
      ],
      "root",
      () => false,
    )
    const timeline = buildFleetTimeline(forest, () => [], new Map(), at(20))

    assert.equal(timeline.links.length, 1)
    assert.equal(timeline.links[0].at, at(4))
    assert.equal(timeline.links[0].childStart, at(4))
  })

  test("stops a running timeline's last span at the session's last update", () => {
    const forest = buildFleet(
      [session("root", undefined, { time: { created: at(0), updated: at(3) } })],
      "root",
      (id) => id === "root",
    )
    const timeline = buildFleetTimeline(
      forest,
      () => [timedMessage("user", 0), timedMessage("assistant", 1, 2)],
      new Map(),
      at(20),
    )

    assert.equal(timeline.rows[0].spans.length, 1)
    assert.equal(timeline.rows[0].spans[0].end, at(3))
    assert.ok(timeline.end >= at(3))
  })

  test("collapses idle gaps between agents to one point", () => {
    const forest = buildFleet(
      [
        session("root", undefined, { time: { created: at(0), updated: at(2) } }),
        session("child", "root", { time: { created: at(8), updated: at(10) } }),
      ],
      "root",
      () => false,
    )
    const messages = new Map([
      ["root", [timedMessage("user", 0), timedMessage("assistant", 0, 2)]],
      ["child", [timedMessage("user", 8), timedMessage("assistant", 8, 10)]],
    ])
    const timeline = buildFleetTimeline(forest, (id) => messages.get(id) ?? [], new Map(), at(20))

    assert.equal(timeline.segments.length, 2)
    assert.equal(timeline.segments[1].gap, 6 * 60_000)
    assert.equal(timeline.peak, 1)
    assert.equal(fleetPositionOf(timeline, at(5)), timeline.segments[0].to)
    assert.equal(fleetPositionOf(timeline, at(5)), timeline.segments[1].from)
    const middle = (timeline.segments[1].from + timeline.segments[1].to) / 2
    assert.ok(Math.abs(fleetTimeAt(timeline, middle) - at(9)) < 1)
  })
})
