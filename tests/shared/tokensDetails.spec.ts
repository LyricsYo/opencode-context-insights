import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { SessionMessageInfo } from "@opencode/client"
import {
  buildTokenTurns,
  categoryDeltas,
  generatedMix,
  generatedOfMessage,
  sessionTokenStats,
  stepComposition,
  toolRowsOf,
} from "../../src/shared/tokens.ts"
import { buildTokenSteps } from "../../src/shared/sessionIndex.ts"
import { assistant, at } from "./fixtures.ts"

const zero = () => ({
  system: 0,
  tools: 0,
  user: 0,
  injected: 0,
  skills: 0,
  assistant: 0,
  reasoning: 0,
  toolCalls: 0,
  toolResults: 0,
})

describe("toolRowsOf", () => {
  test("sorts by calls and keeps the median and total", () => {
    const rows = toolRowsOf(
      new Map([
        ["bash", { calls: 1, failed: 0, unfinished: 1, durations: [] }],
        ["read", { calls: 2, failed: 1, unfinished: 0, durations: [300, 100] }],
        ["aaa", { calls: 1, failed: 0, unfinished: 0, durations: [5] }],
        ["grep", { calls: 1, failed: 0, unfinished: 0, durations: [9, 1, 4] }],
      ]),
    )
    assert.deepEqual(
      rows.map((row) => [row.name, row.calls, row.p50, row.total]),
      [
        ["read", 2, 200, 400],
        ["aaa", 1, 5, 5],
        ["bash", 1, undefined, 0],
        ["grep", 1, 4, 14],
      ],
    )
  })
})

describe("stepComposition details", () => {
  test("caps items and treats the step as current when no id is given", () => {
    const messages = [
      {
        id: "u1",
        type: "user",
        text: "x".repeat(40),
        time: { created: at(1) },
      },
    ] as SessionMessageInfo[]
    const header = {
      summary: {
        at: 0,
        systemHash: "s",
        toolsHash: "t",
        system: Array.from({ length: 401 }, (_, index) => ({ key: `k${index}`, tokens: 1 })),
        tools: [],
      },
      system: [],
      tools: [],
    }
    const composition = stepComposition(messages, undefined, header)
    assert.equal(composition.items.length, 400)
    assert.equal(composition.prompt, undefined)
    assert.equal(composition.headerPending, false)
    assert.equal(composition.headerMissing, false)
  })

  test("falls back to raw tool text when the surface carries no token split", () => {
    const messages = [
      {
        id: "a2",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(2), completed: at(2) },
        content: [
          {
            type: "tool",
            id: "t1",
            name: "read",
            time: { created: at(2) },
            state: { status: "completed", input: { path: "a.ts" }, content: [] },
          },
        ],
      },
    ] as unknown as SessionMessageInfo[]
    const composition = stepComposition(messages, undefined, undefined)
    assert.equal(composition.headerPending, true)
    assert.ok(composition.byCategory.toolCalls > 0)
    assert.equal(composition.prompt, undefined)
  })

  test("ignores a step id that is not a token-carrying assistant", () => {
    const messages = [{ id: "u1", type: "user", text: "hi", time: { created: at(1) } }] as SessionMessageInfo[]
    assert.equal(stepComposition(messages, "u1", null).prompt, undefined)
    assert.equal(stepComposition(messages, "missing", null).prompt, undefined)
  })

  test("classifies surface kinds into their categories", () => {
    const messages = [
      { id: "u1", type: "user", text: "hello", time: { created: at(1) } },
      { id: "u2", type: "user", text: '<skill_content name="demo">body</skill_content>', time: { created: at(2) } },
      { id: "u3", type: "user", text: "<context>env</context>", time: { created: at(3) } },
      assistant(10, 5, {
        id: "a1",
        time: { created: at(4) },
        content: [{ type: "text", text: "reply" }, { type: "reasoning", text: "think" }],
      }),
    ] as SessionMessageInfo[]
    const composition = stepComposition(messages, undefined, undefined)
    assert.ok(composition.byCategory.user > 0)
    assert.ok(composition.byCategory.skills > 0)
    assert.ok(composition.byCategory.injected > 0)
    assert.ok(composition.byCategory.assistant > 0)
    assert.ok(composition.byCategory.reasoning > 0)
  })
})

describe("buildTokenSteps details", () => {
  test("keeps steps without a header and treats a missing duration as zero", () => {
    const rows = buildTokenSteps(
      [
        assistant(10, 5, {
          id: "a1",
          time: { created: at(1) },
          content: [],
        }),
      ] as SessionMessageInfo[],
      [],
    )
    assert.equal(rows[0].headerMissing, true)
    assert.equal(rows[0].duration, undefined)
    assert.equal(rows[0].wait, 0)
  })

  test("groups by turn and carries the first step's compaction flag", () => {
    const rows = buildTokenSteps(
      [
        { id: "u1", type: "user", text: "go", time: { created: at(0) } },
        assistant(10, 5, { id: "a1", time: { created: at(1), completed: at(2) }, content: [] }),
        assistant(20, 5, { id: "a2", time: { created: at(3), completed: at(4) }, content: [] }),
      ] as SessionMessageInfo[],
      [],
    )
    const turns = buildTokenTurns(rows)
    assert.equal(turns.length, 1)
    assert.equal(turns[0].afterCompaction, rows[0].afterCompaction)
    assert.equal(turns[0].headerMissing, rows[1].headerMissing)
    assert.deepEqual(buildTokenTurns([]), [])
  })

  test("drops a step before the first user message from turn rows", () => {
    const rows = buildTokenSteps(
      [
        assistant(1, 1, { id: "a0", time: { created: at(0), completed: at(1) }, content: [] }),
        { id: "u1", type: "user", text: "go", time: { created: at(2) } },
        assistant(1, 1, { id: "a1", time: { created: at(3), completed: at(4) }, content: [] }),
      ] as unknown as SessionMessageInfo[],
      [],
    )
    assert.deepEqual(buildTokenTurns(rows).map((turn) => turn.turn), [1])
  })
})

describe("categoryDeltas details", () => {
  test("returns zero deltas for the first row and skips unknown headers", () => {
    const deltas = categoryDeltas([{ byCategory: { ...zero(), system: 5 }, headerMissing: true }])
    assert.equal(deltas[0].system, 0)
    assert.equal(deltas[0].user, 0)

    const known = categoryDeltas([{ byCategory: { ...zero(), system: 5 } }, { byCategory: { ...zero(), system: 9 } }])
    assert.equal(known[1].system, 4)
  })
})

describe("generated mix details", () => {
  test("returns zero for missing or non-assistant messages", () => {
    assert.deepEqual(generatedOfMessage(undefined), { reasoning: 0, answers: 0, calls: 0 })
    assert.deepEqual(generatedOfMessage({ type: "user" } as SessionMessageInfo), { reasoning: 0, answers: 0, calls: 0 })
  })

  test("skips non-assistant messages when mixing a session", () => {
    const mix = generatedMix([
      { id: "u1", type: "user", text: "x".repeat(40), time: { created: at(1) } },
    ] as SessionMessageInfo[])
    assert.deepEqual(mix, { reasoning: 0, answers: 0, calls: 0 })
    assert.deepEqual(generatedOfMessage({ id: "a1", type: "assistant", time: { created: 0 }, content: [{ type: "text" }] } as unknown as SessionMessageInfo), {
      reasoning: 0,
      answers: 0,
      calls: 0,
    })
  })
})

describe("sessionTokenStats details", () => {
  test("returns nothing for missing or empty usage", () => {
    assert.equal(sessionTokenStats(undefined, { input: 0, output: 0, cache: { read: 0, write: 0 } }, { reasoning: 0, answers: 0, calls: 0 }), undefined)
  })

  test("assigns unrounded output to the assistant when no mix exists", () => {
    const stats = sessionTokenStats(undefined, { input: 0, output: 12, cache: { read: 0, write: 0 } }, { reasoning: 0, answers: 0, calls: 0 })
    assert.equal(stats?.byCategory.assistant, 12)
    assert.equal(stats?.cacheHit, undefined)
    assert.equal(stats?.total, 12)
  })

  test("puts a rounding remainder on the largest category", () => {
    const composition = { byCategory: { ...zero(), system: 2, user: 1 } }
    const stats = sessionTokenStats(
      composition,
      { input: 10, output: 0, cache: { read: 0, write: 0 } },
      { reasoning: 0, answers: 0, calls: 0 },
    )
    assert.equal((stats?.byCategory.system ?? 0) + (stats?.byCategory.user ?? 0), 10)
    assert.ok((stats?.byCategory.system ?? 0) >= (stats?.byCategory.user ?? 0))
  })

  test("ignores a zero-size composition", () => {
    const stats = sessionTokenStats(
      { byCategory: zero() },
      { input: 5, output: 0, cache: { read: 0, write: 0 } },
      { reasoning: 0, answers: 0, calls: 0 },
    )
    assert.equal(stats?.byCategory.injected, 5)
  })
})
