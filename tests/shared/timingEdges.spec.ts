import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { SessionMessageInfo } from "@opencode/client"
import { buildStepTiming, buildTurnTiming, measureStep, stepTimingRowOf, timingOfRows } from "../../src/shared/timing.ts"
import { assistant, at } from "./fixtures.ts"

describe("measureStep edges", () => {
  test("returns nothing for a non-assistant message", () => {
    assert.equal(measureStep({ type: "user" } as SessionMessageInfo), undefined)
  })

  test("answers a keyed cache hit for a new object with the same log", () => {
    const make = () =>
      assistant(10, 5, {
        id: "keyed-1",
        time: { created: at(1), streamed: at(1) + 100, completed: at(1) + 200 },
        content: [{ type: "text", text: "x" }],
      })
    const first = measureStep(make())
    assert.ok(first)
    // A different object with the same id and timing hits the keyed cache.
    assert.equal(measureStep(make()), first)
  })

  test("caches a settled step by identity", () => {
    const message = assistant(10, 5, {
      id: "t1",
      time: { created: at(1), streamed: at(1) + 100, completed: at(1) + 200 },
      content: [{ type: "text", text: "x" }],
    })
    const first = measureStep(message)
    assert.ok(first)
    assert.equal(measureStep(message), first)
    // A moved creation time changes the key, so the step is measured again from the new start.
    const source = message as unknown as { time: { created: number } }
    source.time.created += 1
    const second = measureStep(message)
    assert.ok(second)
    assert.equal(second.wall, first.wall - 1)
  })

  test("keeps an unsettled step out of the identity cache", () => {
    const message = assistant(10, 5, {
      id: "t2",
      time: { created: at(1), streamed: at(1) + 100 },
      content: [{ type: "text", text: "x" }],
    })
    const first = measureStep(message)
    assert.ok(first)
    assert.equal(measureStep(message), first)
  })

  test("evicts the oldest measured step after 4096 entries", () => {
    for (let index = 0; index < 4_097; index++) {
      measureStep(
        assistant(1, 0, {
          id: `evict-${index}`,
          time: { created: at(0), completed: at(1) },
          content: [{ type: "text", text: "x" }],
        }),
      )
    }
    assert.ok(measureStep(assistant(1, 0, { id: "after-evict", time: { created: at(0), completed: at(1) }, content: [] })))
    // A keyed hit after the eviction still answers from the remaining entry.
    const reused = assistant(1, 0, {
      id: "evict-4096",
      time: { created: at(0), completed: at(1) },
      content: [{ type: "text", text: "x" }],
    })
    assert.ok(measureStep(reused))
  })

  test("handles a streamed end without a completion and a block without an end", () => {
    const message = assistant(10, 5, {
      id: "t3",
      time: { created: at(1), streamed: at(1) + 1_000 },
      content: [
        { type: "reasoning", text: "r", time: { created: at(1) + 100 } },
        { type: "text", text: "a" },
      ],
    })
    const measure = measureStep(message)
    assert.ok(measure)
    assert.equal(measure.reasoningBlocks, 1)
    assert.equal(measure.textBlocks, 1)
    assert.equal(measure.reasoning, 0)
    assert.equal(measure.ttft, 100)
  })

  test("keeps a tool block whose run has not started and a part before the step", () => {
    const message = assistant(10, 5, {
      id: "t4",
      time: { created: at(1), streamed: at(1) + 1_000, completed: at(1) + 2_000 },
      content: [
        { type: "text", text: "early", time: { created: at(0) } },
        { type: "text", text: "late", time: { created: at(1) + 50 } },
        { type: "tool", id: "x1", name: "read", time: { created: at(1) + 100 }, state: { status: "streaming", input: {} } },
      ],
    })
    const measure = measureStep(message)
    assert.ok(measure)
    assert.equal(measure.toolArgBlocks, 1)
    assert.equal(measure.toolArgs, 0)
    assert.equal(measure.toolCalls, 0)
    assert.equal(measure.textBlocks, 2)
  })

  test("clamps every slice into the wall time", () => {
    const message = assistant(10, 5, {
      id: "t5",
      time: { created: at(1), streamed: at(1) + 100, completed: at(1) + 1_000 },
      content: [
        { type: "reasoning", text: "r", time: { created: at(1) + 100, completed: at(1) + 5_000 } },
        { type: "tool", id: "x1", name: "question", time: { created: at(1) + 100, ran: at(1) + 100, completed: at(1) + 900 } },
        { type: "tool", id: "x2", name: "read", time: { created: at(1) + 100, ran: at(1) + 100, completed: at(1) + 2_000 } },
      ],
    })
    const measure = measureStep(message)
    assert.ok(measure)
    assert.ok(measure.reasoning <= measure.gen)
    assert.ok(measure.question >= 0)
    assert.ok(measure.tool >= 0)
    assert.ok(measure.overhead >= 0)
  })

  test("ends generation at the last finished reasoning block when streaming time is missing", () => {
    const message = assistant(10, 5, {
      id: "t6",
      time: { created: at(1), completed: at(1) + 10_000 },
      content: [
        { type: "reasoning", text: "first", time: { created: at(1) + 100, completed: at(1) + 900 } },
        { type: "reasoning", text: "second", time: { created: at(1) + 1_000, completed: at(1) + 2_400 } },
      ],
    })
    const measure = measureStep(message)
    assert.ok(measure)
    // The later block wins, so the decode window is 100ms..2.4s rather than the whole request.
    assert.equal(measure.ttft, 100)
    assert.equal(measure.gen, 2_300)
    assert.equal(measure.decoded, 5)
  })

  test("falls back to the request window when the output is larger than the decode window", () => {
    const message = assistant(10, 0, {
      id: "burst",
      time: { created: at(1), firstToken: at(1) + 1_000, streamed: at(1) + 1_005, completed: at(1) + 1_010 },
      content: [{ type: "tool", id: "x1", name: "edit", time: { created: at(1) + 1_001, ran: at(1) + 1_002, completed: at(1) + 1_008 }, state: { status: "completed", input: {}, content: [] } }],
      tokens: { input: 10, output: 173, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    const measure = measureStep(message)
    assert.ok(measure)
    assert.equal(measure.gen, 5)
    // 173 tokens cannot fit in 5ms, so throughput uses the request window minus tool work.
    assert.equal(measure.decode, 1_005)
    const row = stepTimingRowOf(message, measure, 1, 1)
    assert.equal(row.rate, 172)
  })

  test("counts a message whose usage omits reasoning", () => {
    const message = assistant(10, 5, {
      id: "no-reasoning-field",
      time: { created: at(1), firstToken: at(1) + 100, streamed: at(1) + 1_100 },
      content: [{ type: "text", text: "answer" }],
      tokens: { input: 10, output: 5, cache: { read: 0, write: 0 } },
    })
    const measure = measureStep(message)
    assert.ok(measure)
    assert.equal(measure.decoded, 5)

    // A measured step without usage still reports zero decoded tokens.
    const bare = assistant(10, 5, {
      id: "no-usage",
      time: { created: at(1), streamed: at(1) + 1_000 },
      content: [{ type: "text", text: "answer" }],
      tokens: undefined,
    })
    const withoutUsage = measureStep(bare)
    assert.ok(withoutUsage)
    assert.equal(withoutUsage.decoded, 0)
  })
})

describe("stepTimingRowOf edges", () => {
  test("reads output only from an assistant with tokens", () => {
    const measure = measureStep(assistant(1, 7, { time: { created: at(1), completed: at(2) } }))
    assert.ok(measure)
    const row = stepTimingRowOf(assistant(1, 7, { time: { created: at(1), completed: at(2) } }), measure, 1, 2)
    assert.equal(row.output, 7)
    assert.equal(row.rate, 0)
    const noTokens = stepTimingRowOf(
      { id: "x", type: "assistant", time: { created: at(1) }, content: [] } as unknown as SessionMessageInfo,
      measure,
      1,
      1,
    )
    assert.equal(noTokens.output, 0)
  })
})

describe("buildStepTiming edges", () => {
  test("returns nothing for a non-assistant message", () => {
    assert.equal(buildStepTiming([{ id: "u1", type: "user", text: "go", time: { created: at(0) } }]).length, 0)
  })

  test("skips token-less steps but measures one without an end", () => {
    const rows = buildStepTiming([
      { id: "u1", type: "user", text: "go", time: { created: at(0) } },
      { id: "a1", type: "assistant", agent: "build", model: { id: "m", providerID: "p" }, time: { created: at(1) }, content: [], tokens: undefined },
      { id: "a2", type: "assistant", agent: "build", model: { id: "m", providerID: "p" }, time: { created: at(2) }, content: [], tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } },
    ] as unknown as SessionMessageInfo[])
    assert.equal(rows.length, 1)
    assert.equal(rows[0].id, "a2")
    assert.equal(rows[0].wall, 0)
    assert.equal(rows[0].ttft, undefined)
  })
})

describe("timingOfRows and buildTurnTiming", () => {
  test("reports no ttft and no rate for empty rows", () => {
    const stats = timingOfRows([])
    assert.equal(stats.ttft, undefined)
    assert.equal(stats.ttftAvg, undefined)
    assert.equal(stats.rate, 0)
    assert.equal(stats.steps, 0)
    assert.equal(stats.split, false)
    assert.deepEqual(buildTurnTiming([]), [])
  })

  test("sums a turn without ttft and keeps the split flag", () => {
    const rows = buildStepTiming([
      { id: "u1", type: "user", text: "go", time: { created: at(0) } },
      assistant(1, 10, {
        id: "a1",
        time: { created: at(1), completed: at(2) },
        content: [{ type: "reasoning", text: "r", time: { created: at(1) + 1, completed: at(1) + 500 } }],
      }),
      assistant(1, 20, { id: "a2", time: { created: at(3), completed: at(4) }, content: [] }),
    ])
    const turns = buildTurnTiming(rows)
    assert.equal(turns.length, 1)
    assert.equal(turns[0].steps, 2)
    assert.equal(turns[0].split, true)
    // Both steps report ttft here, so the turn sums them.
    assert.equal(turns[0].ttft, (rows[0].ttft ?? 0) + (rows[1].ttft ?? 0))
    assert.ok(turns[0].output === 30)
  })

  test("leaves a turn without any ttft undefined and rates it from its generation", () => {
    const rows = buildStepTiming([
      { id: "u1", type: "user", text: "go", time: { created: at(0) } },
      assistant(1, 20, { id: "a1", time: { created: at(1) }, content: [] }),
    ])
    const turns = buildTurnTiming(rows)
    assert.equal(turns[0].ttft, undefined)
    assert.equal(turns[0].rate, 0)
  })

  test("drops a step before the first user message from turn rows", () => {
    const rows = buildStepTiming([
      assistant(1, 1, { id: "a0", time: { created: at(0), completed: at(1) }, content: [] }),
      { id: "u1", type: "user", text: "go", time: { created: at(2) } },
      assistant(1, 1, { id: "a1", time: { created: at(3), completed: at(4) }, content: [] }),
    ])
    assert.deepEqual(buildTurnTiming(rows).map((turn) => turn.turn), [1])
  })
})
