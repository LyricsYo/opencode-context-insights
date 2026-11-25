import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { SessionMessageInfo } from "@opencode/client"
import {
  buildFleet,
  buildFleetTimeline,
  delegationsOf,
  familyHue,
  fleetDetailOf,
  fleetHeadOf,
  fleetPositionOf,
  fleetRowsOfMessage,
  fleetSpansOf,
  fleetTimeAt,
  layoutFleet,
} from "../../src/shared/fleet.ts"
import { at, session, timedMessage, toolMessage } from "./fleetFixtures.ts"

describe("buildFleet edges", () => {
  test("returns a solo forest for an unknown current session", () => {
    assert.deepEqual(buildFleet([], "missing", () => false), { nodes: [], edges: [], rootID: "missing", solo: true })
  })

  test("stops a parent chain at a cycle or a missing parent", () => {
    const cyclic = [
      session("a", "b"),
      session("b", "a"),
    ]
    const forest = buildFleet(cyclic, "a", () => false)
    assert.equal(forest.rootID, "b")
    const missing = buildFleet([session("child", "absent")], "child", () => false)
    assert.equal(missing.rootID, "child")
    assert.deepEqual(missing.nodes.map((node) => node.id), ["child"])
  })

  test("skips archived children, dedupes visits and fills optional fields", () => {
    const sessions = [
      session("root", undefined, { title: "  " , agent: undefined, model: undefined, location: undefined } as never),
      session("archived", "root", { time: { created: at(0), updated: at(1), archived: at(1) } } as never),
      session("a", "root", { title: "<system-reminder> nope", agent: "explore" } as never),
      session("b", "root", { title: "  " } as never),
      session("dup", "root"),
    ]
    const forest = buildFleet(sessions, "root", () => false)
    const byID = new Map(forest.nodes.map((node) => [node.id, node]))
    assert.equal(byID.has("archived"), false)
    assert.equal(byID.get("root")?.title, "root")
    assert.equal(byID.get("root")?.directory, "")
    assert.equal(byID.get("a")?.title, "explore")
    assert.equal(byID.get("b")?.title, "build")
    assert.equal(byID.get("dup")?.title, "title dup")
    assert.equal(forest.edges.length, 3)
  })

  test("keeps an archived ancestor that leads to the current session", () => {
    const sessions = [
      session("root", undefined),
      session("archived", "root", { time: { created: at(0), updated: at(1), archived: at(1) } } as never),
      session("current", "archived", { time: { created: at(2), updated: at(3) } }),
    ]
    const forest = buildFleet(sessions, "current", () => false)
    assert.deepEqual(forest.nodes.map((node) => node.id), ["root", "archived", "current"])
    assert.equal(forest.rootID, "root")
  })

  test("orders siblings with equal creation times by id", () => {
    const same = at(0)
    const sessions = [
      session("root", undefined, { time: { created: same, updated: same } }),
      session("b", "root", { time: { created: same, updated: same } }),
      session("a", "root", { time: { created: same, updated: same } }),
    ]
    const forest = buildFleet(sessions, "root", () => false)
    assert.deepEqual(forest.nodes.map((node) => node.id), ["root", "a", "b"])
  })

  test("keeps a running agent open and marks idle agents completed", () => {
    const sessions = [
      session("root", undefined, { time: { created: at(0), updated: at(1), busy: at(0), idle: at(1) } as never }),
      session("running", "root", { time: { created: at(0), updated: at(1), busy: at(0) } as never }),
      session("idle", "root", { time: { created: at(0), updated: at(1), idle: at(1) } as never }),
    ]
    const forest = buildFleet(sessions, "root", (id) => id === "running", at(5))
    const byID = new Map(forest.nodes.map((node) => [node.id, node]))
    assert.equal(byID.get("running")?.duration, 5 * 60_000)
    assert.equal(byID.get("running")?.completed, false)
    assert.equal(byID.get("idle")?.completed, true)
    assert.equal(byID.get("idle")?.idle, at(1))
    assert.equal(byID.get("root")?.running, false)
  })

  test("leaves the duration out when the run is empty", () => {
    const forest = buildFleet(
      [session("root", undefined, { time: { created: at(5), updated: at(5) } })],
      "root",
      () => false,
    )
    assert.equal(forest.nodes[0].duration, undefined)
    assert.equal(forest.solo, true)
  })
})

describe("layoutFleet edges", () => {
  test("lays out an empty forest", () => {
    const layout = layoutFleet({ nodes: [], edges: [], rootID: "", solo: true })
    assert.deepEqual(layout.points, [])
    assert.deepEqual(layout.links, [])
    assert.equal(layout.banded, false)
  })

  test("fits children into extra bands when one level cannot hold them", () => {
    const children = Array.from({ length: 7 }, (_, index) => session(`c${index}`, "root"))
    const forest = buildFleet([session("root", undefined), ...children], "root", () => false)
    // 1000px fits six slots per level, so the seventh child starts a second band.
    const layout = layoutFleet(forest, 1_000)
    assert.equal(layout.banded, true)
    assert.equal(layout.points.length, 8)
    assert.equal(new Set(layout.points.map((point) => point.y)).size, 3)
  })

  test("wraps each node's children when one family overflows a level", () => {
    const forest = buildFleet(
      [
        session("root", undefined),
        session("c0", "root"),
        session("c1", "root"),
        session("g0", "c0"),
        session("g1", "c0"),
        session("h0", "c1"),
        session("h1", "c1"),
      ],
      "root",
      () => false,
    )
    // 500px fits three slots per level; four leaves force the wider family into bands.
    const layout = layoutFleet(forest, 500)
    assert.equal(layout.banded, true)
    assert.equal(layout.points.length, 7)
    assert.ok(new Set(layout.points.map((point) => point.y)).size >= 3)
  })

  test("places every node when the stage is narrow", () => {
    const forest = buildFleet(
      [session("root", undefined), session("a", "root"), session("b", "root")],
      "root",
      () => false,
    )
    const layout = layoutFleet(forest, 200)
    assert.equal(layout.banded, true)
    assert.equal(layout.points.length, 3)
    assert.equal(layout.cardWidth, 188)
  })

  test("narrows slots when a wide stage can still fit every leaf", () => {
    const forest = buildFleet(
      [session("root", undefined), session("a", "root"), session("b", "root"), session("c", "root")],
      "root",
      () => false,
    )
    const layout = layoutFleet(forest, 2_000)
    assert.equal(layout.banded, false)
    assert.ok(layout.width < 2_000)
    assert.equal(layout.points.length, 4)
  })

  test("places an orphan at the origin slot and drops its link", () => {
    const forest = buildFleet([session("root", undefined), session("child", "root")], "root", () => false)
    const orphaned = {
      ...forest,
      nodes: [...forest.nodes, { ...forest.nodes[1], id: "orphan", parentID: "gone" }],
      edges: [...forest.edges, { from: "gone", to: "orphan" }],
    }
    const layout = layoutFleet(orphaned)
    assert.equal(layout.links.length, 1)
    assert.equal(layout.points.length, 3)
  })
})

describe("familyHue", () => {
  test("spreads families around the wheel", () => {
    assert.equal(familyHue(0), "hsl(0 58% 52%)")
    assert.equal(familyHue(3), "hsl(53 58% 52%)")
    assert.notEqual(familyHue(1), familyHue(2))
  })
})

describe("fleetRowsOfMessage stamps", () => {
  test("caches settled rows and keeps the streaming tail uncached", () => {
    const settled = {
      id: "a1",
      type: "assistant",
      agent: "build",
      model: { id: "m", providerID: "p" },
      time: { created: at(1), completed: at(2) },
      content: [{ type: "text", text: "one" }],
    } as unknown as SessionMessageInfo
    const first = fleetRowsOfMessage(settled)
    assert.equal(fleetRowsOfMessage(settled), first)

    const streaming = {
      id: "a2",
      type: "assistant",
      agent: "build",
      model: { id: "m", providerID: "p" },
      time: { created: at(1), streamed: at(2) },
      content: [{ type: "text", text: "partial" }],
    } as unknown as SessionMessageInfo
    assert.equal(fleetRowsOfMessage(streaming)[0].text, "partial")
    ;(streaming as unknown as { content: Array<{ text: string }> }).content[0].text = "partial more"
    assert.equal(fleetRowsOfMessage(streaming)[0].text, "partial more")
  })

  test("stamps compactions and plain messages", () => {
    const compaction = {
      id: "c1",
      type: "compaction",
      status: "completed",
      reason: "auto",
      summary: "sum",
      time: { created: at(1) },
    } as unknown as SessionMessageInfo
    // The fleet transcript lists conversation rows only; a compaction header is not one.
    assert.deepEqual(fleetRowsOfMessage(compaction), [])
    const system = {
      id: "s1",
      type: "system",
      text: "rules",
      description: "AGENTS.md",
      time: { created: at(1) },
    } as unknown as SessionMessageInfo
    assert.equal(fleetRowsOfMessage(system)[0].name, "AGENTS.md")
    const empty = {
      id: "s2",
      type: "system",
      text: "   ",
      time: { created: at(1) },
    } as unknown as SessionMessageInfo
    assert.deepEqual(fleetRowsOfMessage(empty), [])
  })
})

describe("fleetHeadOf and fleetDetailOf edges", () => {
  test("returns no prompt, composition or cost for an empty log", () => {
    const head = fleetHeadOf([], [])
    assert.deepEqual(head, { steps: 0 })
  })

  test("skips empty and injected user text and marks a pending header", () => {
    const messages = [
      { id: "u0", type: "user", text: "<context>env</context>", time: { created: at(0) } },
      { id: "u1", type: "user", text: "   ", time: { created: at(1) } },
      { id: "u2", type: "user", text: "real", time: { created: at(2) } },
      {
        id: "a1",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(3), completed: at(4) },
        content: [{ type: "text", text: "answer" }],
        tokens: { input: 10, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    ] as unknown as SessionMessageInfo[]
    const head = fleetHeadOf(messages, undefined)
    assert.equal(head.prompt?.text, "real")
    assert.equal(head.composition?.headerPending, true)
    assert.ok((head.cost ?? 0) >= 0)

    const detail = fleetDetailOf(messages, [])
    assert.equal(detail.reply?.text, "answer")
    assert.equal(detail.composition?.headerPending, false)
  })

  test("ignores replies with no text and keeps the last non-empty one", () => {
    const messages = [
      {
        id: "a1",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(1), completed: at(2) },
        content: [{ type: "text", text: "first" }],
      },
      {
        id: "a2",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(3), completed: at(4) },
        content: [{ type: "reasoning", text: "only thinking" }],
      },
      { id: "u1", type: "user", text: "go", time: { created: at(5) } },
    ] as unknown as SessionMessageInfo[]
    assert.equal(fleetDetailOf(messages, []).reply?.text, "first")
  })
})

describe("delegationsOf edges", () => {
  test("ignores streaming calls and matches children by prompt prefix and time", () => {
    const rows = delegationsOf(
      "ses_parent",
      [
        toolMessage(
          "t1",
          "subagent",
          { status: "streaming", input: { prompt: "partial" }, metadata: {} },
          1,
        ),
        toolMessage(
          "t2",
          "subagent",
          { status: "completed", input: { prompt: "find all files in the repo" }, content: [] },
          2,
        ),
        toolMessage(
          "t3",
          "subagent",
          { status: "completed", input: { description: "closest by time" }, content: [] },
          11,
        ),
        toolMessage("t4", "subagent", { status: "completed", input: {}, content: [] }, 30),
      ],
      [
        { id: "ses_child", title: "scan repo", createdAt: at(1), prompt: "find all files" },
        { id: "ses_other", title: "other" , createdAt: at(10) },
      ],
    )
    assert.equal(rows.length, 3)
    // Prefix match on the prompt.
    assert.equal(rows[0].childID, "ses_child")
    // Time proximity picks the near child.
    assert.equal(rows[1].childID, "ses_other")
    // Nothing is within five minutes, so the call stays unlinked.
    assert.equal(rows[2].childID, undefined)
    assert.equal(rows[2].description, "Subagent")
  })

  test("matches by title and skips reused children", () => {
    const rows = delegationsOf(
      "ses_parent",
      [
        toolMessage("t1", "subagent", { status: "completed", input: { description: "Scan Repo" }, content: [] }, 1),
        toolMessage("t2", "subagent", { status: "completed", input: { description: "scan repo" }, content: [] }, 2),
      ],
      [{ id: "ses_child", title: "scan repo", createdAt: at(1) }],
    )
    assert.equal(rows[0].childID, "ses_child")
    assert.equal(rows[1].childID, undefined)
  })

  test("matches an exact prompt before the prefix fallback", () => {
    const rows = delegationsOf(
      "ses_parent",
      [
        toolMessage("t1", "subagent", { status: "completed", input: { prompt: "find all files now" }, content: [] }, 1),
      ],
      [{ id: "ses_exact", title: "other", createdAt: at(1), prompt: "find all files" }],
    )
    assert.equal(rows[0].childID, "ses_exact")
  })

  test("falls back to the closest creation time when prompts do not match", () => {
    const rows = delegationsOf(
      "ses_parent",
      [
        toolMessage("t1", "subagent", { status: "completed", input: { prompt: "completely different" }, content: [] }, 2),
      ],
      [
        { id: "ses_far", title: "far", createdAt: at(1), prompt: "unrelated text" },
        { id: "ses_near", title: "near", createdAt: at(2), prompt: "another thing" },
      ],
    )
    assert.equal(rows[0].childID, "ses_near")
  })

  test("matches a prompt exactly and tolerates children without one", () => {
    const exact = delegationsOf(
      "ses_parent",
      [toolMessage("t1", "subagent", { status: "completed", input: { prompt: "find all files" }, content: [] }, 1)],
      [{ id: "ses_exact", title: "other", createdAt: at(1), prompt: "find all files" }],
    )
    assert.equal(exact[0].childID, "ses_exact")

    const withoutPrompt = delegationsOf(
      "ses_parent",
      [toolMessage("t1", "subagent", { status: "completed", input: { prompt: "find all files" }, content: [] }, 1)],
      [
        { id: "ses_noprompt", title: "no prompt", createdAt: at(1) },
        { id: "ses_prefix", title: "prefix", createdAt: at(1), prompt: "find all" },
      ],
    )
    assert.equal(withoutPrompt[0].childID, "ses_prefix")
  })

  test("reads a session id from the tool result text", () => {
    const rows = delegationsOf(
      "ses_parent",
      [
        toolMessage(
          "t1",
          "task",
          {
            status: "completed",
            input: {},
            content: [{ type: "text", text: "working in ses_fromText now" }],
          },
          1,
        ),
      ],
      [],
    )
    assert.equal(rows[0].result, "working in ses_fromText now")
    assert.equal(rows[0].exact, false)
    // The child is unknown to this fleet, so the row keeps the text but has no title.
    assert.equal(rows[0].childID, undefined)
  })

  test("skips content that is not a text list and calls without state fields", () => {
    const rows = delegationsOf(
      "ses_parent",
      [
        toolMessage("t1", "task", { status: "completed", input: {}, content: "not a list" }, 1),
        toolMessage("t1b", "task", { status: "completed", input: {}, content: [null, { type: "file" }, { type: "text" }] }, 1),
        toolMessage("t2", "task", { status: "running", input: undefined }, 2),
        { id: "u1", type: "user", text: "hello", time: { created: at(1) } } as unknown as SessionMessageInfo,
      ],
      [],
    )
    assert.equal(rows.length, 3)
    assert.equal(rows[0].result, undefined)
    assert.equal(rows[1].result, undefined)
    assert.equal(rows[2].agent, undefined)
    assert.equal(rows[2].prompt, undefined)
  })
})

describe("fleetSpansOf edges", () => {
  test("turns an idle gap longer than the turn window into a new span", () => {
    const spans = fleetSpansOf(
      [
        timedMessage("assistant", 0, 1),
        timedMessage("assistant", 60, 61),
      ],
      { createdAt: 0, updatedAt: at(61), idle: at(61), running: false },
      at(90),
    )
    assert.deepEqual(spans.map((span) => [span.start, span.end]), [
      [at(0), at(1)],
      [at(60), at(61)],
    ])
  })

  test("estimates a missing end from the next message and caps it", () => {
    const spans = fleetSpansOf(
      [
        { id: "a1", type: "assistant", time: { created: at(0), streamed: at(1) }, content: [], agent: "build", model: { id: "m", providerID: "p" } },
        { id: "a2", type: "assistant", time: { created: at(9) }, content: [], agent: "build", model: { id: "m", providerID: "p" } },
      ] as unknown as SessionMessageInfo[],
      { createdAt: 0, updatedAt: at(9), idle: at(9), running: false },
      at(20),
    )
    // Steps 9 minutes apart stay in one turn; the last step's missing end becomes a five-minute estimate.
    assert.deepEqual(spans.map((span) => [span.start, span.end]), [[at(0), at(14)]])
  })

  test("skips zero-length steps and unstarted cuts, and clamps an idle message", () => {
    const spans = fleetSpansOf(
      [
        {
          id: "a1",
          type: "assistant",
          time: { created: at(0), completed: at(0) },
          agent: "build",
          model: { id: "m", providerID: "p" },
          content: [
            { type: "tool", id: "q1", name: "question", time: { created: at(0) }, state: { status: "streaming" } },
          ],
        },
        { id: "i1", type: "idle", time: { created: at(5) } },
        { id: "s1", type: "system", text: "rules", time: { created: at(6) } },
      ] as unknown as SessionMessageInfo[],
      { createdAt: 0, updatedAt: at(5), idle: at(5), running: false },
      at(20),
    )
    assert.deepEqual(spans, [])
  })

  test("ignores non-tool parts when collecting cuts", () => {
    const spans = fleetSpansOf(
      [
        {
          id: "a1",
          type: "assistant",
          time: { created: at(0), completed: at(2) },
          agent: "build",
          model: { id: "m", providerID: "p" },
          content: [
            { type: "text", text: "answer" },
            { type: "tool", id: "t1", name: "read", time: { created: at(1), ran: at(1), completed: at(1) }, state: { status: "completed" } },
          ],
        },
      ] as unknown as SessionMessageInfo[],
      { createdAt: 0, updatedAt: at(2), idle: at(2), running: false },
      at(20),
    )
    assert.deepEqual(spans.map((span) => [span.start, span.end]), [[at(0), at(2)]])
  })

  test("gives a running agent without steps a bar from its creation", () => {
    const spans = fleetSpansOf([], { createdAt: at(1), updatedAt: at(1), running: true }, at(2))
    assert.deepEqual(spans, [{ start: at(1), end: at(2) }])
    assert.deepEqual(fleetSpansOf([], { createdAt: at(1), updatedAt: at(1), running: false }, at(2)), [])
  })

  test("splits a span at both edges of a cut", () => {
    const spans = fleetSpansOf(
      [
        {
          id: "a1",
          type: "assistant",
          time: { created: at(0), completed: at(10) },
          agent: "build",
          model: { id: "m", providerID: "p" },
          content: [
            { type: "tool", id: "q1", name: "question", time: { created: at(3), ran: at(3), completed: at(7) }, state: { status: "completed" } },
          ],
        },
      ] as unknown as SessionMessageInfo[],
      { createdAt: 0, updatedAt: at(10), idle: at(10), running: false },
      at(20),
    )
    assert.deepEqual(spans.map((span) => [span.start, span.end]), [
      [at(0), at(3)],
      [at(7), at(10)],
    ])
  })

  test("merges overlapping cuts", () => {
    const spans = fleetSpansOf(
      [
        {
          id: "a1",
          type: "assistant",
          time: { created: at(0), completed: at(10) },
          agent: "build",
          model: { id: "m", providerID: "p" },
          content: [
            { type: "tool", id: "q1", name: "question", time: { created: at(2), ran: at(2), completed: at(6) }, state: { status: "completed" } },
            { type: "tool", id: "q2", name: "subagent", time: { created: at(4), ran: at(4), completed: at(6) }, state: { status: "completed" } },
          ],
        },
      ] as unknown as SessionMessageInfo[],
      { createdAt: 0, updatedAt: at(10), idle: at(10), running: false },
      at(20),
    )
    assert.deepEqual(spans.map((span) => [span.start, span.end]), [
      [at(0), at(2)],
      [at(6), at(10)],
    ])
  })
})

describe("timeline edges", () => {
  test("maps an empty segment list to zero", () => {
    assert.equal(fleetPositionOf({ segments: [] }, at(1)), 0)
    assert.equal(fleetTimeAt({ segments: [] }, 0.5), 0)
  })

  test("clamps positions to the segment edges", () => {
    const segments = [{ start: at(0), end: at(10), from: 0.1, to: 0.9, gap: 0 }]
    assert.equal(fleetPositionOf({ segments }, at(-5)), 0.1)
    assert.equal(fleetPositionOf({ segments }, at(20)), 0.9)
    assert.equal(fleetTimeAt({ segments }, 0), at(0))
    assert.equal(fleetTimeAt({ segments }, 1), at(10))
    assert.equal(fleetTimeAt({ segments }, 0.5), at(5))
    assert.equal(fleetPositionOf({ segments }, at(5)), 0.1 + 0.5 * 0.8)
  })

  test("treats a zero-width segment as its start", () => {
    const segments = [
      { start: at(0), end: at(1), from: 0.5, to: 0.5, gap: 0 },
      { start: at(2), end: at(3), from: 0.6, to: 1, gap: 0 },
    ]
    assert.equal(fleetTimeAt({ segments }, 0.5), at(0))
  })

  test("falls back to a one-minute window when no spans exist", () => {
    const forest = buildFleet([session("root", undefined, { time: { created: 0, updated: 0 } })], "root", () => false)
    const timeline = buildFleetTimeline(forest, () => [], new Map(), 60_000)
    assert.equal(timeline.start, 0)
    assert.equal(timeline.end, 60_000)
    assert.equal(timeline.segments.length, 1)
    assert.equal(timeline.active, 0)
    assert.equal(timeline.rows[0].spans.length, 0)
  })

  test("uses three ticks for a very short or day-long span", () => {
    const short = buildFleetTimeline(
      buildFleet([session("root", undefined, { time: { created: at(0), updated: at(2) } })], "root", () => false),
      () => [timedMessage("assistant", 0, 2)],
      new Map(),
      at(2),
    )
    assert.equal(short.ticks.length, 3)
    const day = buildFleetTimeline(
      buildFleet([session("root", undefined, { time: { created: 0, updated: 2 * 24 * 3600_000 } })], "root", () => false),
      () => [
        timedMessage("assistant", 0, 1),
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
    assert.equal(day.ticks.length, 3)
  })

  test("evicts the oldest cached span set and skips unknown links", () => {
    const forest = buildFleet(
      [session("root", undefined), session("child", "root")],
      "root",
      () => false,
    )
    const spanCache = new Map<string, { key: string; spans: never[]; start: number; end: number }>()
    const trimmed = { ...forest, nodes: forest.nodes.map((node) => ({ ...node })), edges: forest.edges.map((edge) => ({ ...edge })) }
    for (let index = 0; index < 258; index++) {
      spanCache.set(`old-${index}`, { key: "x", spans: [], start: 0, end: 1 })
    }
    const timeline = buildFleetTimeline(trimmed, () => [], new Map(), at(5), spanCache as never, "s1")
    assert.ok(spanCache.size <= 258)
    assert.equal(timeline.links.length, 1)

    const orphan = {
      ...trimmed,
      nodes: [{ ...trimmed.nodes[0] }],
      edges: forest.edges,
    }
    assert.equal(buildFleetTimeline(orphan, () => [], new Map(), at(5)).links.length, 0)
  })

  test("treats non-finite row times as an hour and a zero span as a minute", () => {
    const forest = buildFleet([session("root", undefined, { time: { created: Number.NaN, updated: Number.NaN } })], "root", () => false)
    const timeline = buildFleetTimeline(forest, () => [], new Map(), at(30))
    assert.ok(Number.isFinite(timeline.start))
    assert.equal(timeline.end - timeline.start, 60_000)
  })

  test("keeps a zero-length merged interval from dividing by zero", () => {
    const forest = buildFleet([session("root", undefined, { time: { created: 0, updated: 1 } })], "root", () => false)
    const timeline = buildFleetTimeline(
      forest,
      () => [{ id: "a1", type: "assistant", time: { created: 0, completed: 0 }, content: [], agent: "build", model: { id: "m", providerID: "p" } } as unknown as SessionMessageInfo],
      new Map(),
      1,
    )
    assert.ok(Number.isFinite(timeline.segments[0].to))
  })
})
