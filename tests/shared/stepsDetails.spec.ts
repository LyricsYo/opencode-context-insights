import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { SessionInfo, SessionMessageInfo } from "@opencode/client"
import { buildChildren, buildCompactions, buildSteps, buildTurns, compactionTrigger, windowStats } from "../../src/shared/steps.ts"
import { assistant, at } from "./fixtures.ts"

describe("buildSteps details", () => {
  test("skips unfinished compactions, token-less assistants and non-step messages", () => {
    const rows = buildSteps([
      { id: "s1", type: "system", text: "rules", time: { created: at(1) } },
      { id: "c1", type: "compaction", status: "running", reason: "auto", summary: "s", time: { created: at(2) } },
      { id: "a1", type: "assistant", agent: "build", time: { created: at(3) }, content: [], tokens: undefined },
      { id: "i1", type: "idle", time: { created: at(4) } },
    ] as unknown as SessionMessageInfo[])
    assert.deepEqual(rows, [])
  })

  test("uses streamed time, keeps a missing cost at zero and clears the compaction flag", () => {
    const rows = buildSteps([
      assistant(10, 0, {
        id: "a1",
        time: { created: at(1), streamed: at(2) },
        cost: undefined,
        model: undefined,
        tokens: { input: 10, output: 0, reasoning: 0, cache: { read: 5, write: 1 } },
      }),
      assistant(20, 0, { id: "a2", time: { created: at(3) } }),
    ] as unknown as SessionMessageInfo[])
    assert.equal(rows[0].duration, 60_000)
    assert.equal(rows[0].cost, 0)
    assert.equal(rows[0].model, undefined)
    assert.equal(rows[0].prompt, 16)
    assert.equal(rows[1].afterCompaction, false)
  })

  test("keeps a step before the first user message on turn zero", () => {
    const rows = buildSteps([assistant(10, 0)] as SessionMessageInfo[])
    assert.equal(rows[0].turn, 0)
    assert.equal(rows[0].step, 1)
    assert.deepEqual(buildTurns(rows), [])
  })
})

describe("buildTurns details", () => {
  test("sums steps and skips missing durations", () => {
    const steps = buildSteps([
      { id: "u1", type: "user", text: "go", time: { created: at(0) } },
      assistant(10, 5, { id: "a1", time: { created: at(1) } }),
      assistant(20, 7, { id: "a2", time: { created: at(2), completed: at(3) } }),
    ] as SessionMessageInfo[])
    const turns = buildTurns(steps)
    assert.equal(turns.length, 1)
    assert.equal(turns[0].prompt, 20)
    assert.equal(turns[0].output, 12)
    assert.equal(turns[0].steps, 2)
    assert.equal(turns[0].at, at(1))
    assert.equal(turns[0].id, "a2")
  })
})

describe("windowStats details", () => {
  test("returns no limit estimate without growth", () => {
    const flat = windowStats(buildSteps([assistant(100, 0), assistant(100, 0)] as SessionMessageInfo[]), 1000)
    assert.equal(flat.growth, 0)
    assert.equal(flat.stepsToLimit, undefined)
    assert.equal(windowStats(buildSteps([assistant(1000, 0)] as SessionMessageInfo[]), 1000).stepsToLimit, undefined)
  })

  test("skips the step after a compaction when averaging growth", () => {
    const steps = buildSteps([
      assistant(100, 0),
      { id: "c", type: "compaction", status: "completed", reason: "auto", summary: "s", time: { created: at(1) } },
      assistant(20, 0),
      assistant(40, 0),
    ] as SessionMessageInfo[])
    const stats = windowStats(steps, 1_000)
    assert.equal(stats.growth, 20)
    assert.equal(stats.stepsToLimit, 48)
  })
})

describe("compactionTrigger details", () => {
  test("rejects a missing or non-positive window", () => {
    assert.equal(compactionTrigger(0), undefined)
    assert.equal(compactionTrigger(Number.NaN), undefined)
    assert.equal(compactionTrigger(-1), undefined)
  })

  test("falls back to the default share for unusable buffers", () => {
    assert.equal(compactionTrigger(1_000_000, { buffer: "abc" })?.buffer, 150_000)
    assert.equal(compactionTrigger(1_000_000, { buffer: "0%" })?.buffer, 150_000)
    assert.equal(compactionTrigger(1_000_000, { buffer: "100%" })?.buffer, 150_000)
    assert.equal(compactionTrigger(1_000_000, { buffer: 0 })?.buffer, 150_000)
    assert.equal(compactionTrigger(1_000_000, { buffer: Number.POSITIVE_INFINITY })?.buffer, 150_000)
  })

  test("keeps the buffer at 16k for normal windows and uses the share for tiny ones", () => {
    assert.equal(compactionTrigger(100_000)?.buffer, 16_000)
    assert.equal(compactionTrigger(20_000)?.at, 4_000)
    const tiny = compactionTrigger(10_000)
    assert.equal(tiny?.buffer, 1_500)
    assert.equal(tiny?.at, 8_500)
    assert.equal(compactionTrigger(1_000_000, { buffer: "99%" })?.at, 10_000)
    assert.equal(compactionTrigger(1_000_000, { auto: true })?.auto, true)
  })
})

describe("buildCompactions details", () => {
  test("skips running compactions and reports what it can", () => {
    const rows = buildCompactions([
      { id: "c1", type: "compaction", status: "running", reason: "auto", summary: "s", time: { created: at(1) } },
      { id: "c2", type: "compaction", status: "completed", reason: "auto", summary: "s", time: { created: at(2) } },
      assistant(30, 0, { id: "a1", time: { created: at(3) } }),
    ] as unknown as SessionMessageInfo[])
    assert.equal(rows.length, 1)
    assert.equal(rows[0].before, undefined)
    assert.equal(rows[0].after, 30)
    assert.equal(rows[0].reclaimed, undefined)
    assert.equal(rows[0].stepID, "a1")
  })

  test("includes a post-compaction step stamped at the same millisecond", () => {
    const rows = buildCompactions([
      assistant(100, 0, { id: "a1", time: { created: at(1) } }),
      { id: "c1", type: "compaction", status: "completed", reason: "auto", summary: "s", time: { created: at(2) } },
      assistant(30, 0, { id: "a2", time: { created: at(2) } }),
    ] as unknown as SessionMessageInfo[])
    assert.equal(rows[0].before, 100)
    assert.equal(rows[0].after, 30)
    assert.equal(rows[0].reclaimed, 70)
  })

  test("keeps before without after at the end of the log", () => {
    const rows = buildCompactions([
      assistant(100, 0, { id: "a1", time: { created: at(1) } }),
      { id: "c1", type: "compaction", status: "completed", reason: "auto", summary: "s", time: { created: at(2) } },
      { id: "a2", type: "assistant", time: { created: at(3) }, content: [], tokens: undefined },
    ] as unknown as SessionMessageInfo[])
    assert.equal(rows[0].before, 100)
    assert.equal(rows[0].after, undefined)
    assert.equal(rows[0].reclaimed, undefined)
    assert.equal(rows[0].stepID, undefined)
  })
})

describe("buildChildren details", () => {
  test("fills optional fields from the session", () => {
    const session = (patch: Record<string, unknown>) =>
      ({
        id: "child",
        title: undefined,
        agent: undefined,
        model: undefined,
        cost: 1,
        tokens: { input: 1, output: 2, reasoning: 1, cache: { read: 3, write: 4 } },
        time: { created: 0, updated: 0 },
        ...patch,
      }) as unknown as SessionInfo
    const rows = buildChildren([session({ parentID: "root" })], "root")
    assert.equal(rows[0].title, "child")
    assert.equal(rows[0].agent, undefined)
    assert.equal(rows[0].model, undefined)
    assert.equal(rows[0].prompt, 8)
    assert.equal(rows[0].output, 3)
    const named = buildChildren(
      [session({ parentID: "root", title: "Scan", agent: "explore", model: { id: "m", providerID: "p" } })],
      "root",
    )
    assert.equal(named[0].title, "Scan")
    assert.equal(named[0].agent, "explore")
    assert.equal(named[0].model, "m")
    const archived = buildChildren(
      [session({ parentID: "root", time: { created: 0, updated: 0, archived: 1 } })],
      "root",
    )
    assert.equal(archived.length, 0)
  })
})
