import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { SessionMessageInfo } from "@opencode/client"
import {
  buildSessionIndex,
  buildTokenScan,
  buildTools,
} from "../../src/shared/sessionIndex.ts"
import { buildEvents } from "../../src/shared/events.ts"
import { buildSteps } from "../../src/shared/steps.ts"
import { buildStepTiming, buildTiming, timingOfRows } from "../../src/shared/timing.ts"
import { buildToolScan } from "../../src/shared/files.ts"
import { assistant, at, tool } from "./fixtures.ts"

describe("buildSessionIndex", () => {
  test("matches the dedicated walks", () => {
    const messages = [
      { id: "u1", type: "user", text: "hello", time: { created: at(1) } },
      { id: "s1", type: "system", text: "system note", time: { created: at(2) } },
      assistant(10, 5, {
        content: [
          { type: "text", text: "answer".repeat(4) },
          {
            type: "tool",
            id: "sk1",
            name: "skill",
            time: { created: at(3), ran: at(3), completed: at(3) + 10 },
            state: { status: "completed", input: { id: "demo" }, content: [{ type: "text", text: "skill body" }] },
          },
          tool("t1", "read", { status: "completed", input: { path: "src/a.ts" }, content: [] }, at(3), at(3) + 20),
        ],
      }),
      { id: "c1", type: "compaction", status: "completed", reason: "auto", summary: "summary", time: { created: at(4) } },
      assistant(20, 5, { id: "a2", time: { created: at(5), completed: at(5) + 500 }, content: [] }),
      { id: "m1", type: "model-switched", model: { id: "m2", providerID: "p" }, time: { created: at(6) } },
      { id: "i1", type: "idle", outcome: "failed", error: { message: "boom" }, time: { created: at(7) } },
    ] as SessionMessageInfo[]
    const index = buildSessionIndex(messages, [])

    assert.deepEqual(index.steps, buildSteps(messages))
    assert.deepEqual(index.scan, buildTokenScan(messages, []))
    assert.equal(index.turnCount, 1)

    const events = buildEvents(messages)
    const counts: Record<string, number> = { inject: 0, skill: 0, compaction: 0, model: 0, agent: 0, error: 0 }
    for (const event of events) counts[event.kind] += 1
    assert.equal(index.eventTotal, events.length)
    assert.deepEqual(index.eventCounts, counts)

    const extras = buildSessionIndex(messages, [], { tools: true, timing: true, workspace: "D:\\repo" })
    assert.deepEqual(extras.toolScan, buildToolScan(messages, "D:\\repo"))
    assert.deepEqual(extras.stepTiming, buildStepTiming(messages))
    assert.deepEqual(timingOfRows(extras.stepTiming ?? []), buildTiming(messages))
  })
})

describe("buildTools", () => {
  test("counts calls, failures and the median duration", () => {
    const tool = (name: string, status: string, ms: number) =>
      ({
        type: "tool",
        id: `${name}-${ms}`,
        name,
        time: { created: 0, ran: 0, completed: ms },
        state: status === "error" ? { status, input: {}, error: { type: "e", message: "boom" } } : { status, input: {}, content: [] },
      }) as const

    const rows = buildTools([
      assistant(1, 0, { content: [tool("read", "completed", 100), tool("read", "completed", 300), tool("bash", "error", 50)] }),
      assistant(2, 0, { content: [tool("bash", "running", 10), tool("question", "completed", 5000)] }),
    ] as SessionMessageInfo[])

    assert.deepEqual(
      rows.map((row) => [row.name, row.calls, row.failed, row.unfinished, row.p50, row.total]),
      [
        ["bash", 2, 1, 1, 30, 60],
        ["read", 2, 0, 0, 200, 400],
        ["question", 1, 0, 0, undefined, 0],
      ],
    )
  })
})

describe("buildToolScan", () => {
  test("one tool walk yields both commands and file activity", () => {
    const scan = buildToolScan([
      assistant(1, 0, {
        content: [
          tool(
            "c1",
            "shell",
            { status: "completed", input: { command: "npm test" }, metadata: { status: "completed", exit: 0 }, content: [] },
            0,
            1200,
          ),
          tool(
            "f1",
            "read",
            { status: "completed", input: { path: "src/a.ts", limit: 20 }, metadata: { status: "completed" }, content: [] },
            0,
            10,
          ),
        ],
      }),
    ] as SessionMessageInfo[])

    assert.equal(scan.commands.length, 1)
    assert.equal(scan.files.length, 1)
    assert.equal(scan.commands[0].id, "c1")
    assert.equal(scan.files[0].id, "f1")
  })
})
