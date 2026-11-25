import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { SessionMessageInfo } from "@opencode/client"
import { buildChildren, buildCompactions, buildSteps, buildTurns, compactionTrigger, windowStats } from "../../src/shared/steps.ts"
import { assistant, assistantAt, at } from "./fixtures.ts"

describe("buildSteps", () => {
  test("reads provider tokens and skips a failed compaction", () => {
    const rows = buildSteps([
      assistant(100, 10),
      { id: "c", type: "compaction", status: "completed", reason: "auto", summary: "s", time: { created: at(1) } },
      assistant(40, 5),
    ] as SessionMessageInfo[])

    assert.equal(rows.length, 2)
    assert.equal(rows[0].prompt, 100)
    assert.equal(rows[1].afterCompaction, true)
    assert.equal(rows[1].duration, 1000)
  })

  test("counts turns and steps within each turn", () => {
    const rows = buildSteps([
      { id: "u1", type: "user", text: "first", time: { created: at(1) } },
      assistantAt(10, 0, 2),
      assistantAt(20, 0, 3),
      { id: "u2", type: "user", text: "second", time: { created: at(4) } },
      assistantAt(30, 0, 5),
    ] as SessionMessageInfo[])

    assert.deepEqual(
      rows.map((row) => [row.turn, row.step]),
      [
        [1, 1],
        [1, 2],
        [2, 1],
      ],
    )
    assert.deepEqual(
      buildTurns(rows).map((turn) => [turn.turn, turn.steps, turn.prompt]),
      [
        [1, 2, 20],
        [2, 1, 30],
      ],
    )
  })
})

describe("windowStats", () => {
  test("takes the peak, the average and the growth per step", () => {
    const rows = buildSteps([assistant(100, 0), assistant(200, 0), assistant(400, 0)] as SessionMessageInfo[])
    const stats = windowStats(rows, 1000)

    assert.equal(stats.latest, 400)
    assert.equal(stats.peak, 400)
    assert.equal(stats.average, 233)
    assert.equal(stats.growth, 150)
    assert.equal(stats.stepsToLimit, 4)
    assert.equal(windowStats([]).latest, 0)
  })
})

describe("compactionTrigger", () => {
  test("follows the buffer setting", () => {
    assert.equal(compactionTrigger(128_000, { buffer: "20%" })?.at, 102_400)
    assert.equal(compactionTrigger(1_000_000, { buffer: "20%" })?.at, 800_000)
    assert.equal(compactionTrigger(100_000)?.at, 84_000)
    assert.equal(compactionTrigger(500_000, { buffer: 20_000 })?.at, 480_000)
    assert.equal(compactionTrigger(500_000, { buffer: 600_000 })?.at, 425_000)
    assert.equal(compactionTrigger(500_000, { auto: false })?.auto, false)
    assert.equal(compactionTrigger(undefined), undefined)
  })
})

describe("buildCompactions", () => {
  test("pairs the prompt before with the prompt after", () => {
    const rows = buildCompactions([
      assistantAt(100, 0, 1),
      { id: "c", type: "compaction", status: "completed", reason: "auto", summary: "summary", time: { created: at(5) } },
      assistantAt(30, 0, 9),
    ] as SessionMessageInfo[])

    assert.equal(rows.length, 1)
    assert.equal(rows[0].id, "c")
    assert.equal(rows[0].stepID, "msg_30")
    assert.equal(rows[0].before, 100)
    assert.equal(rows[0].after, 30)
    assert.equal(rows[0].reclaimed, 70)
  })
})

describe("buildChildren", () => {
  test("lists only subagent sessions, oldest first", () => {
    const session = (id: string, parentID: string | undefined, cost: number, created: number) =>
      ({
        id,
        parentID,
        cost,
        title: id,
        tokens: { input: 10, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created, updated: 0 },
      }) as never

    const rows = buildChildren(
      [session("a", "root", 0.1, 20), session("b", "root", 0.5, 10), session("c", undefined, 9, 0)],
      "root",
    )

    assert.deepEqual(rows.map((row) => row.id), ["b", "a"])
  })
})
