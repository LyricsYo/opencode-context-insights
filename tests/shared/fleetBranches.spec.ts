import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { SessionMessageInfo } from "@opencode/client"
import {
  buildFleet,
  buildFleetTimeline,
  fleetRowsOfMessage,
  fleetSpansOf,
  fleetTimeAt,
} from "../../src/shared/fleet.ts"
import { at, session, timedMessage } from "./fleetFixtures.ts"

describe("fleet row stamps", () => {
  test("stamps an assistant with only a streamed end", () => {
    const streaming = {
      id: "a1",
      type: "assistant",
      agent: "build",
      model: { id: "m", providerID: "p" },
      time: { created: at(1), streamed: at(2) },
      content: [{ type: "text", text: "partial" }],
    } as unknown as SessionMessageInfo
    assert.equal(fleetRowsOfMessage(streaming)[0].text, "partial")
  })

  test("stamps an assistant with no end and a streamed-only tail", () => {
    const open = {
      id: "a1",
      type: "assistant",
      agent: "build",
      model: { id: "m", providerID: "p" },
      time: { created: at(1) },
      content: [{ type: "text", text: "open" }],
    } as unknown as SessionMessageInfo
    assert.equal(fleetRowsOfMessage(open)[0].text, "open")
  })

  test("stamps a compaction still running and one without a summary field", () => {
    const running = {
      id: "c1",
      type: "compaction",
      status: "running",
      reason: "auto",
      summary: "sum",
      time: { created: at(1) },
    } as unknown as SessionMessageInfo
    assert.deepEqual(fleetRowsOfMessage(running), [])

    const summaryless = {
      id: "c2",
      type: "compaction",
      status: "completed",
      reason: "auto",
      time: { created: at(1) },
    } as unknown as SessionMessageInfo
    assert.deepEqual(fleetRowsOfMessage(summaryless), [])
  })

  test("stamps a message without a text field", () => {
    const idle = { id: "i1", type: "idle", outcome: "succeeded", time: { created: at(1) } } as unknown as SessionMessageInfo
    assert.deepEqual(fleetRowsOfMessage(idle), [])
  })
})

describe("fleet span cuts", () => {
  test("cuts a question wait that reports only a start", () => {
    const spans = fleetSpansOf(
      [
        {
          id: "a1",
          type: "assistant",
          time: { created: at(0), completed: at(10) },
          agent: "build",
          model: { id: "m", providerID: "p" },
          content: [
            { type: "tool", id: "q1", name: "question", time: { created: at(3), ran: at(3) }, state: { status: "streaming" } },
            { type: "tool", id: "q2", name: "question", time: { created: at(5), completed: at(6) }, state: { status: "completed" } },
            { type: "tool", id: "q3", name: "question", time: { created: at(7) }, state: { status: "completed" } },
          ],
        },
      ] as unknown as SessionMessageInfo[],
      { createdAt: 0, updatedAt: at(10), idle: at(10), running: false },
      at(20),
    )
    // A tool that started but has no end is not cut; one without a start is not cut either.
    assert.deepEqual(spans.map((span) => [span.start, span.end]), [
      [at(0), at(5)],
      [at(6), at(10)],
    ])
  })

  test("cuts a wait that starts exactly at the span start", () => {
    const spans = fleetSpansOf(
      [
        {
          id: "a1",
          type: "assistant",
          time: { created: at(0), completed: at(10) },
          agent: "build",
          model: { id: "m", providerID: "p" },
          content: [
            { type: "tool", id: "q1", name: "question", time: { created: at(0), ran: at(0), completed: at(4) }, state: { status: "completed" } },
          ],
        },
      ] as unknown as SessionMessageInfo[],
      { createdAt: 0, updatedAt: at(10), idle: at(10), running: false },
      at(20),
    )
    assert.deepEqual(spans.map((span) => [span.start, span.end]), [[at(4), at(10)]])
  })

  test("estimates the end of a step that has a next message", () => {
    const spans = fleetSpansOf(
      [
        { id: "a1", type: "assistant", time: { created: at(0) }, content: [], agent: "build", model: { id: "m", providerID: "p" } },
        { id: "u1", type: "user", text: "next", time: { created: at(2) } },
      ] as unknown as SessionMessageInfo[],
      { createdAt: 0, updatedAt: at(2), idle: at(2), running: false },
      at(20),
    )
    assert.deepEqual(spans.map((span) => [span.start, span.end]), [[at(0), at(2)]])
  })
})

describe("timeline cache keys", () => {
  test("keys on a streamed tail and caps the span cache", () => {
    const forest = buildFleet([session("root", undefined)], "root", () => false)
    const cache = new Map<string, { key: string; spans: never[]; start: number; end: number }>()
    for (let index = 0; index < 257; index++) {
      cache.set(`old-${index}`, { key: "x", spans: [], start: 0, end: 1 })
    }
    const messages = [
      {
        id: "a1",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(0), streamed: at(1) },
        content: [],
      } as unknown as SessionMessageInfo,
    ]
    const timeline = buildFleetTimeline(forest, () => messages, new Map(), at(5), cache as never, "s")
    // One eviction per insert; steady state stays at the cap once every insert follows one eviction.
    assert.equal(cache.size, 257)
    assert.equal(timeline.rows.length, 1)
  })

  test("uses three ticks for a week and five for a month", () => {
    const short = buildFleetTimeline(
      buildFleet([session("root", undefined, { time: { created: 0, updated: 2 * 24 * 3600_000 } })], "root", () => false),
      () => [
        {
          id: "a1",
          type: "assistant",
          time: { created: 0, completed: 1000 },
          content: [],
          agent: "build",
          model: { id: "m", providerID: "p" },
        } as unknown as SessionMessageInfo,
        {
          id: "a2",
          type: "assistant",
          time: { created: 2 * 24 * 3600_000, completed: 2 * 24 * 3600_000 + 1000 },
          content: [],
          agent: "build",
          model: { id: "m", providerID: "p" },
        } as unknown as SessionMessageInfo,
      ],
      new Map(),
      2 * 24 * 3600_000,
    )
    assert.equal(short.ticks.length, 3)

    const long = buildFleetTimeline(
      buildFleet([session("root", undefined, { time: { created: 0, updated: 30 * 24 * 3600_000 } })], "root", () => false),
      () => [
        {
          id: "a1",
          type: "assistant",
          time: { created: 0, completed: 1000 },
          content: [],
          agent: "build",
          model: { id: "m", providerID: "p" },
        } as unknown as SessionMessageInfo,
        {
          id: "a2",
          type: "assistant",
          time: { created: 30 * 24 * 3600_000, completed: 30 * 24 * 3600_000 + 1000 },
          content: [],
          agent: "build",
          model: { id: "m", providerID: "p" },
        } as unknown as SessionMessageInfo,
      ],
      new Map(),
      30 * 24 * 3600_000,
    )
    assert.equal(long.ticks.length, 5)
  })

  test("sorts simultaneous events and drops links to missing rows", () => {
    const forest = buildFleet(
      [session("root", undefined), session("a", "root"), session("b", "root")],
      "root",
      () => false,
    )
    const messages = new Map([
      ["root", [timedMessage("assistant", 0, 1)]],
      ["a", [timedMessage("assistant", 0, 1)]],
      ["b", [timedMessage("assistant", 0, 1)]],
    ])
    const timeline = buildFleetTimeline(forest, (id) => messages.get(id) ?? [], new Map(), at(5))
    assert.equal(timeline.peak, 3)
    assert.equal(timeline.links.length, 2)

    const orphaned = {
      ...forest,
      nodes: [forest.nodes[0]],
      edges: forest.edges,
    }
    assert.equal(buildFleetTimeline(orphaned, (id) => messages.get(id) ?? [], new Map(), at(5)).links.length, 0)

    const missingParent = {
      ...forest,
      nodes: [forest.nodes[1]],
      edges: forest.edges,
    }
    assert.equal(buildFleetTimeline(missingParent, (id) => messages.get(id) ?? [], new Map(), at(5)).links.length, 0)
  })

  test("keys on an assistant tail with no end time", () => {
    const forest = buildFleet([session("root", undefined)], "root", () => false)
    const open = [
      {
        id: "a1",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(0) },
        content: [],
      } as unknown as SessionMessageInfo,
    ]
    const timeline = buildFleetTimeline(forest, () => open, new Map(), at(5))
    assert.equal(timeline.rows.length, 1)
    assert.equal(timeline.rows[0].spans.length, 1)
  })
})

describe("fleetTimeAt inside a segment", () => {
  test("interpolates between the segment ends", () => {
    const segments = [{ start: at(0), end: at(10), from: 0.2, to: 0.6, gap: 0 }]
    assert.equal(fleetTimeAt({ segments }, 0.4), at(5))
  })
})
