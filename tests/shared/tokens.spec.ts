import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { SessionMessageInfo } from "@opencode/client"
import { buildTokenScan, buildTokenSteps } from "../../src/shared/sessionIndex.ts"
import {
  buildTokenTurns,
  categoryDeltas,
  generatedMix,
  generatedOfMessage,
  sessionTokenStats,
  stepComposition,
} from "../../src/shared/tokens.ts"
import { assistant, at, headerDetail, headerSummary } from "./fixtures.ts"

describe("stepComposition", () => {
  test("combines the stored header with prior messages only", () => {
    const messages = [
      { id: "u1", type: "user", text: "x".repeat(40), time: { created: at(1) } },
      assistant(100, 10, {
        id: "a1",
        time: { created: at(2), completed: at(2) + 1000 },
        content: [
          { type: "text", text: "y".repeat(40) },
          {
            type: "tool",
            id: "t1",
            name: "read",
            time: { created: at(2) },
            state: { status: "completed", input: { path: "a.ts" }, content: [{ type: "text", text: "body" }] },
          },
        ],
      }),
      assistant(200, 20, {
        id: "a2",
        time: { created: at(3), completed: at(3) + 1000 },
        content: [{ type: "text", text: "z".repeat(40) }],
      }),
    ] as SessionMessageInfo[]
    const header = headerDetail(headerSummary(0, 30, 20))

    const first = stepComposition(messages, "a1", header)
    assert.equal(first.prompt, 100)
    assert.equal(first.byCategory.system, 30)
    assert.equal(first.byCategory.tools, 20)
    assert.equal(first.byCategory.user, 10)
    assert.equal(first.byCategory.assistant, 0)
    assert.equal(first.byCategory.toolCalls, 0)
    assert.equal(first.headerMissing, false)
    assert.equal(first.headerPending, false)

    const second = stepComposition(messages, "a2", header)
    assert.equal(second.byCategory.assistant, 10)
    assert.ok(second.byCategory.toolCalls > 0)
    assert.ok(second.byCategory.toolResults > 0)
    const trend = buildTokenSteps(messages, [headerSummary(0, 30, 20)])
    assert.equal(second.total, trend[1].total)
    assert.equal(second.byCategory.toolCalls, trend[1].byCategory.toolCalls)
    assert.equal(second.byCategory.toolResults, trend[1].byCategory.toolResults)

    const pending = stepComposition(messages, "a1", undefined)
    assert.equal(pending.headerPending, true)
    assert.equal(pending.byCategory.system, 0)

    const missing = stepComposition(messages, "a1", null)
    assert.equal(missing.headerMissing, true)
    assert.equal(missing.byCategory.tools, 0)
  })
})

describe("buildTokenSteps", () => {
  test("follows compaction and header versions", () => {
    const messages = [
      { id: "u1", type: "user", text: "x".repeat(40), time: { created: at(1) } },
      assistant(100, 10, {
        id: "a1",
        time: { created: at(2), completed: at(2) + 1000 },
        content: [{ type: "text", text: "y".repeat(40) }],
      }),
      assistant(200, 20, {
        id: "a2",
        time: { created: at(3), completed: at(3) + 1000 },
        content: [{ type: "text", text: "v".repeat(40) }],
      }),
      {
        id: "c1",
        type: "compaction",
        status: "completed",
        reason: "auto",
        summary: "z".repeat(80),
        time: { created: at(4) },
      },
      { id: "u2", type: "user", text: "w".repeat(40), time: { created: at(5) } },
      assistant(300, 30, {
        id: "a3",
        time: { created: at(6), completed: at(6) + 1000 },
        content: [{ type: "text", text: "q".repeat(40) }],
      }),
    ] as SessionMessageInfo[]
    const rows = buildTokenSteps(messages, [headerSummary(0, 10, 5), headerSummary(at(5), 20, 6)])

    assert.equal(rows.length, 3)
    assert.deepEqual(
      rows.map((row) => [row.turn, row.step, row.prompt, row.afterCompaction]),
      [
        [1, 1, 100, false],
        [1, 2, 200, false],
        [2, 1, 300, true],
      ],
    )
    assert.equal(rows[0].byCategory.user, 10)
    assert.equal(rows[0].byCategory.assistant, 0)
    assert.equal(rows[0].byCategory.system, 10)
    assert.equal(rows[0].byCategory.tools, 5)
    assert.equal(rows[1].byCategory.assistant, 10)
    assert.equal(rows[1].byCategory.system, 10)
    assert.equal(rows[1].byCategory.tools, 5)
    assert.equal(rows[2].byCategory.injected, 20)
    assert.equal(rows[2].byCategory.system, 20)
    assert.equal(rows[2].byCategory.tools, 6)
    assert.equal(rows[2].headerMissing, false)

    const turns = buildTokenTurns(rows)
    assert.deepEqual(
      turns.map((turn) => [turn.turn, turn.steps, turn.prompt]),
      [
        [1, 2, 200],
        [2, 1, 300],
      ],
    )

    const deltas = categoryDeltas(rows)
    assert.equal(deltas[0].user, 10)
    assert.equal(deltas[1].assistant, 10)
    assert.equal(deltas[2].assistant, -10)
    assert.equal(deltas[2].injected, 20)
  })

  test("duration excludes question waits", () => {
    const messages = [
      { id: "u1", type: "user", text: "go", time: { created: -1 } },
      assistant(10, 5, {
        id: "a1",
        time: { created: 0, streamed: 1000, completed: 10_000 },
        content: [
          { type: "text", text: "answer" },
          {
            type: "tool",
            id: "q1",
            name: "question",
            time: { created: 1000, ran: 2000, completed: 8000 },
            state: { status: "completed", input: {}, content: [] },
          },
        ],
      }),
    ] as SessionMessageInfo[]

    const rows = buildTokenSteps(messages, [])
    assert.equal(rows[0].duration, 4000)
    assert.equal(rows[0].wait, 6000)

    const turns = buildTokenTurns(rows)
    assert.equal(turns[0].duration, 4000)
    assert.equal(turns[0].wait, 6000)
  })
})

describe("sessionTokenStats", () => {
  test("scales the composition to provider usage", () => {
    const zero = {
      system: 0,
      tools: 0,
      user: 0,
      injected: 0,
      skills: 0,
      assistant: 0,
      reasoning: 0,
      toolCalls: 0,
      toolResults: 0,
    }
    const stats = sessionTokenStats(
      { byCategory: { ...zero, system: 10, tools: 5, user: 5 } },
      { input: 10, output: 10, reasoning: 10, cache: { read: 20, write: 0 } },
      { reasoning: 5, answers: 3, calls: 2 },
    )
    assert.ok(stats)
    assert.equal(stats.total, 50)
    assert.equal(stats.input, 30)
    assert.equal(stats.output, 20)
    assert.equal(stats.cacheHit, 66.67)
    assert.equal(stats.byCategory.system, 14)
    assert.equal(stats.byCategory.tools, 8)
    assert.equal(stats.byCategory.user, 8)
    assert.equal(stats.byCategory.reasoning, 10)
    assert.equal(stats.byCategory.assistant, 6)
    assert.equal(stats.byCategory.toolCalls, 4)
    assert.equal(Object.values(stats.byCategory).reduce((sum, value) => sum + value, 0), stats.total)

    const fallback = sessionTokenStats(undefined, { input: 30, output: 10, cache: { read: 0, write: 0 } }, {
      reasoning: 0,
      answers: 0,
      calls: 0,
    })
    assert.equal(fallback?.byCategory.injected, 30)
    assert.equal(fallback?.byCategory.assistant, 10)
    assert.equal(sessionTokenStats(undefined, undefined, { reasoning: 0, answers: 0, calls: 0 }), undefined)
  })
})

describe("generatedMix", () => {
  test("counts reasoning, answers and tool call inputs", () => {
    const messages = [
      assistant(1, 0, {
        content: [
          { type: "reasoning", text: "r".repeat(40) },
          { type: "text", text: "a".repeat(40) },
          {
            type: "tool",
            id: "t1",
            name: "read",
            time: { created: 0, ran: 0, completed: 1 },
            state: { status: "completed", input: { path: "x".repeat(40) }, content: [] },
          },
        ],
      }),
    ] as SessionMessageInfo[]
    const mix = generatedMix(messages)

    assert.equal(mix.reasoning, 10)
    assert.equal(mix.answers, 10)
    assert.ok(mix.calls > 10)
    // The token scan shares the same text estimates; both paths must agree.
    assert.deepEqual(buildTokenScan(messages, []).generated, mix)
    // The streaming tail patches its own message's mix onto the structural scan.
    assert.deepEqual(generatedOfMessage(messages[0]), mix)
  })
})

describe("categoryDeltas", () => {
  test("ignores system and tools when a header is missing", () => {
    const zero = {
      system: 0,
      tools: 0,
      user: 0,
      injected: 0,
      skills: 0,
      assistant: 0,
      reasoning: 0,
      toolCalls: 0,
      toolResults: 0,
    }
    const deltas = categoryDeltas([
      { byCategory: zero, headerMissing: true },
      { byCategory: { ...zero, system: 10, tools: 5 }, headerMissing: false },
    ])

    assert.equal(deltas[1].system, 0)
    assert.equal(deltas[1].tools, 0)
  })
})
