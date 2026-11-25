import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { SessionMessageInfo } from "@opencode/client"
import { buildStepTiming, buildTiming, buildTurnTiming } from "../../src/shared/timing.ts"
import { buildToolScan } from "../../src/shared/files.ts"
import { assistant, at } from "./fixtures.ts"

describe("buildStepTiming", () => {
  test("splits TTFT, reasoning, tool args, tools and overhead", () => {
    const messages = [
      { id: "u1", type: "user", text: "first", time: { created: at(0) } },
      assistant(1, 10, {
        id: "a1",
        time: { created: at(1), streamed: at(1) + 1000, completed: at(1) + 2000 },
        content: [
          {
            type: "reasoning",
            text: "thinking",
            time: { created: at(1) + 200, completed: at(1) + 700 },
          },
          {
            type: "tool",
            id: "t1",
            name: "read",
            time: { created: at(1) + 1000, ran: at(1) + 1000, completed: at(1) + 1400 },
            state: { status: "completed", input: {}, content: [] },
          },
          {
            type: "tool",
            id: "t2",
            name: "question",
            time: { created: at(1) + 1400, ran: at(1) + 1400, completed: at(1) + 2000 },
            state: { status: "completed", input: {}, content: [] },
          },
        ],
      }),
      { id: "u2", type: "user", text: "second", time: { created: at(2) } },
      assistant(2, 20, {
        id: "a2",
        time: { created: at(3), streamed: at(3) + 500, completed: at(3) + 500 },
        content: [],
      }),
    ] as SessionMessageInfo[]

    const rows = buildStepTiming(messages)
    assert.deepEqual(
      rows.map((row) => [
        row.turn,
        row.step,
        row.ttft,
        row.gen,
        row.reasoning,
        row.text,
        row.toolArgs,
        row.split,
        row.genLeftover,
        row.tool,
        row.question,
        row.overhead,
        row.wall,
        row.output,
      ]),
      [
        [1, 1, 200, 800, 500, 0, 0, true, 300, 400, 600, 0, 2000, 10],
        [2, 1, undefined, 500, 0, 0, 0, false, 500, 0, 0, 0, 500, 20],
      ],
    )
    assert.equal(rows[0].rate, 13)
    // Generation plus tools plus the question wait plus overhead covers the active time.
    assert.equal((rows[0].ttft ?? 0) + rows[0].gen + rows[0].tool + rows[0].question + rows[0].overhead, rows[0].wall)
    // With the split shown, unmeasured generation moves into overhead.
    assert.equal(
      (rows[0].ttft ?? 0) + rows[0].reasoning + rows[0].text + rows[0].toolArgs + rows[0].tool + rows[0].question + rows[0].overhead + rows[0].genLeftover,
      rows[0].wall,
    )

    const turns = buildTurnTiming(rows)
    assert.deepEqual(
      turns.map((turn) => [turn.turn, turn.steps, turn.ttft, turn.gen, turn.reasoning, turn.tool, turn.overhead, turn.wall, turn.output]),
      [
        [1, 1, 200, 800, 500, 400, 0, 2000, 10],
        [2, 1, undefined, 500, 0, 0, 0, 500, 20],
      ],
    )

    const total = buildTiming(messages)
    assert.equal(total.ttft, 200)
    assert.equal(total.gen, 1300)
    assert.equal(total.reasoning, 500)
    assert.equal(total.text, 0)
    assert.equal(total.toolArgs, 0)
    assert.equal(total.genLeftover, 800)
    assert.equal(total.split, true)
    assert.equal(total.tool, 400)
    assert.equal(total.toolCalls, 1)
    assert.equal(total.question, 600)
    assert.equal(total.wall, 2500)
    assert.equal(total.overhead, 0)
    assert.equal(total.ttftAvg, 200)
    assert.equal(total.ttftSteps, 1)
    assert.equal(total.steps, 2)
    assert.equal((total.ttft ?? 0) + total.gen + total.tool + total.question + total.overhead, total.wall)
    assert.equal(
      (total.ttft ?? 0) +
        total.reasoning +
        total.text +
        total.toolArgs +
        total.tool +
        total.question +
        total.overhead +
        total.genLeftover,
      total.wall,
    )
  })

  test("keeps a question wait out of tool time", () => {
    const stats = buildTiming([
      assistant(1, 10, {
        time: { created: 0, streamed: 1000, completed: 5000 },
        content: [
          {
            type: "reasoning",
            text: "thinking",
            time: { created: 200, completed: 500 },
          },
          {
            type: "tool",
            id: "q1",
            name: "mcp.question",
            time: { created: 1000, ran: 1000, completed: 5000 },
            state: { status: "completed", input: {}, content: [] },
          },
        ],
      }),
    ] as SessionMessageInfo[])

    assert.equal(stats.ttft, 200)
    assert.equal(stats.gen, 800)
    assert.equal(stats.reasoning, 300)
    assert.equal(stats.text, 0)
    assert.equal(stats.split, true)
    assert.equal(stats.tool, 0)
    assert.equal(stats.question, 4000)
    assert.equal(stats.wall, 5000)
    // Question wait is its own slice again; leftover generation joins overhead for display.
    assert.equal(stats.overhead, 0)
    assert.equal(stats.genLeftover, 500)
  })

  test("keeps a subagent wait out of tool time and active time", () => {
    const stats = buildTiming([
      assistant(1, 10, {
        time: { created: 0, streamed: 1000, completed: 5000 },
        content: [
          {
            type: "reasoning",
            text: "thinking",
            time: { created: 200, completed: 500 },
          },
          {
            type: "tool",
            id: "r1",
            name: "read",
            time: { created: 1000, ran: 1000, completed: 1500 },
            state: { status: "completed", input: {}, content: [] },
          },
          {
            type: "tool",
            id: "t1",
            name: "mcp.task",
            time: { created: 1500, ran: 1500, completed: 4500 },
            state: { status: "completed", input: {}, content: [] },
          },
        ],
      }),
    ] as SessionMessageInfo[])

    assert.equal(stats.ttft, 200)
    assert.equal(stats.gen, 800)
    assert.equal(stats.tool, 500)
    assert.equal(stats.question, 0)
    assert.equal(stats.delegation, 3000)
    assert.equal(stats.overhead, 500)
    assert.equal(stats.toolCalls, 2)
    // The chart's active time is the wall time without the subagent wait.
    assert.equal(stats.wall - stats.question - stats.delegation, 2000)
    assert.equal((stats.ttft ?? 0) + stats.gen + stats.tool + stats.overhead, 2000)
  })

  test("falls back when streamed time or part times are missing", () => {
    const stats = buildTiming([
      assistant(2, 20, {
        time: { created: 2000, streamed: 2500, completed: 2500 },
        content: [],
      }),
      assistant(3, 0, {
        time: { created: 4000, completed: 7000 },
        content: [],
      }),
    ] as SessionMessageInfo[])

    assert.equal(stats.ttft, undefined)
    assert.equal(stats.gen, 3500)
    assert.equal(stats.tool, 0)
    assert.equal(stats.question, 0)
    assert.equal(stats.wall, 3500)
    assert.equal(stats.overhead, 0)
    assert.equal(stats.ttftSteps, 0)
    assert.equal(stats.steps, 2)
    assert.equal(stats.output, 20)
    assert.equal(stats.rate, 6)
  })

  test("timing and tool caches refresh when a running step settles", () => {
    const message = assistant(10, 5, {
      id: "live-step",
      time: { created: at(10) },
      content: [
        {
          type: "tool",
          id: "live-command",
          name: "shell",
          time: { created: at(10) + 100, ran: at(10) + 100 },
          state: { status: "running", input: { command: "sleep 1" }, metadata: {}, content: [] },
        },
      ],
    }) as SessionMessageInfo
    const beforeTiming = buildStepTiming([message])[0]
    const beforeCommands = buildToolScan([message]).commands
    assert.equal(beforeTiming.wall, 0)
    assert.equal(beforeCommands[0].status, "running")
    assert.equal(beforeCommands[0].duration, undefined)

    // The host store mutates message and part objects in place.
    const source = message as unknown as {
      time: { created: number; streamed?: number; completed?: number }
      content: Array<{ time: { created: number; ran?: number; completed?: number }; state: Record<string, unknown> }>
    }
    source.time.streamed = at(10) + 600
    source.time.completed = at(10) + 2_000
    source.content[0].time.completed = at(10) + 1_500
    source.content[0].state = { status: "completed", input: { command: "sleep 1" }, metadata: { exit: 0 }, content: [] }

    const afterTiming = buildStepTiming([message])[0]
    const afterCommands = buildToolScan([message]).commands
    assert.equal(afterTiming.wall, 2_000)
    assert.equal(afterTiming.tool, 1_400)
    assert.equal(afterCommands[0].status, "completed")
    assert.equal(afterCommands[0].duration, 1_400)
  })
})
