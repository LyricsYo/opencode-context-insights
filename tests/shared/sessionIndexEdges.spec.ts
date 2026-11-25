import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { SessionMessageInfo } from "@opencode/client"
import { buildSessionIndex } from "../../src/shared/sessionIndex.ts"
import { buildEvents } from "../../src/shared/events.ts"
import { assistant, at } from "./fixtures.ts"

const user = (id: string, text: string, patch: Record<string, unknown> = {}) =>
  ({ id, type: "user", text, time: { created: at(1) }, ...patch }) as unknown as SessionMessageInfo

describe("buildSessionIndex edge cases", () => {
  test("classifies each user surface and counts turn zero", () => {
    const index = buildSessionIndex(
      [
        user("u1", '<skill_content name="demo">body</skill_content>'),
        user("u2", "<context>env</context>"),
        user("u3", "plain"),
        {
          id: "u4",
          type: "user",
          text: "with image",
          time: { created: at(1) },
          files: [{ mime: "image/png", width: 800, height: 600 }],
        } as unknown as SessionMessageInfo,
        { id: "u5", type: "user", text: "", time: { created: at(1) } } as unknown as SessionMessageInfo,
        assistant(10, 1, { id: "a0", time: { created: at(0), completed: at(1) }, content: [] }),
      ],
      [],
    )
    assert.equal(index.turnCount, 5)
    assert.equal(index.scan.steps.length, 1)
    assert.equal(index.scan.steps[0].turn, 5)
    assert.ok(index.scan.steps[0].byCategory.skills > 0)
    assert.ok(index.scan.steps[0].byCategory.injected > 0)
    assert.ok(index.scan.steps[0].byCategory.user > 0)
  })

  test("excludes question and subagent waits from a step's active duration", () => {
    const index = buildSessionIndex(
      [
        assistant(1, 10, {
          id: "a-wait",
          time: { created: 0, streamed: 1000, completed: 5000 },
          content: [
            {
              type: "tool",
              id: "q1",
              name: "mcp.question",
              time: { created: 1000, ran: 1000, completed: 2000 },
              state: { status: "completed", input: {}, content: [] },
            },
            {
              type: "tool",
              id: "t1",
              name: "task",
              time: { created: 2000, ran: 2000, completed: 4000 },
              state: { status: "completed", input: {}, content: [] },
            },
          ],
        }),
      ],
      [],
    )
    const row = index.scan.steps[0]
    assert.equal(row.wait, 1000)
    assert.equal(row.delegation, 2000)
    assert.equal(row.duration, 2000)
  })

  test("counts image and file attachments in the user category", () => {
    // The composition is a snapshot taken at a step, so append one assistant step.
    const withStep = buildSessionIndex(
      [
        {
          id: "u-file",
          type: "user",
          text: "see",
          time: { created: at(1) },
          files: [
            { mime: "image/png", width: 800, height: 600 },
            { name: "a.pdf", mime: "application/pdf", data: "aGk=" },
          ],
        } as unknown as SessionMessageInfo,
        assistant(1, 1, { id: "a-file", time: { created: at(2), completed: at(3) }, content: [] }),
      ],
      [],
    )
    assert.ok(withStep.scan.steps[0].byCategory.user > 3)
  })

  test("counts agent switches and a succeeded idle as no error", () => {
    const index = buildSessionIndex(
      [
        { id: "ag1", type: "agent-switched", agent: "build", previous: "plan", time: { created: at(1) } },
        { id: "i1", type: "idle", outcome: "succeeded", time: { created: at(2) } },
        { id: "i2", type: "idle", outcome: "interrupted", time: { created: at(3) } },
      ] as unknown as SessionMessageInfo[],
      [],
    )
    assert.equal(index.eventCounts.agent, 1)
    assert.equal(index.eventCounts.error, 1)
    assert.equal(index.eventTotal, 2)
  })

  test("clears categories at a completed compaction and keeps the flag for the next step", () => {
    const index = buildSessionIndex(
      [
        user("u1", "x".repeat(400)),
        { id: "c1", type: "compaction", status: "completed", reason: "auto", summary: "sum", time: { created: at(2) } },
        assistant(10, 0, { id: "a1", time: { created: at(3), streamed: at(4) }, content: [] }),
        assistant(20, 0, { id: "a2", time: { created: at(5), completed: at(6) }, content: [] }),
      ] as unknown as SessionMessageInfo[],
      [],
    )
    assert.equal(index.scan.steps[0].afterCompaction, true)
    assert.equal(index.scan.steps[1].afterCompaction, false)
    assert.equal(index.scan.steps[0].duration, 60_000)
    assert.equal(index.scan.steps[0].wait, 0)
    assert.equal(index.steps[0].duration, 60_000)
  })

  test("marks a header missing when the version predates the step and adds a header otherwise", () => {
    const missing = buildSessionIndex(
      [assistant(10, 0, { id: "a1", time: { created: at(2) }, content: [] })] as unknown as SessionMessageInfo[],
      [{ at: at(1), systemHash: "s", toolsHash: "t", system: [{ key: "core", tokens: 7 }], tools: [{ name: "read", tokens: 3 }] }],
    )
    // The version is older than the step, so it still applies through headerAt.
    assert.equal(missing.scan.steps[0].headerMissing, false)
    assert.equal(missing.scan.steps[0].byCategory.system, 7)
    assert.equal(missing.scan.steps[0].byCategory.tools, 3)
  })

  test("counts tool failures, unfinished calls and a skill tool call", () => {
    const index = buildSessionIndex(
      [
        assistant(10, 1, {
          id: "a1",
          time: { created: at(1), completed: at(2) },
          content: [
            {
              type: "tool",
              id: "t1",
              name: "read",
              time: { created: at(1), ran: at(1), completed: at(2) },
              state: { status: "completed", input: { path: "a.ts" }, content: [] },
            },
            {
              type: "tool",
              id: "t2",
              name: "bash",
              time: { created: at(1), ran: at(1) },
              state: { status: "error", input: { command: "x" }, error: { message: "boom" } },
            },
            {
              type: "tool",
              id: "t3",
              name: "bash",
              time: { created: at(1), ran: at(1) },
              state: { status: "running", input: { command: "y" }, metadata: {} },
            },
            {
              type: "tool",
              id: "t4",
              name: "question",
              time: { created: at(1), ran: at(1), completed: at(2) },
              state: { status: "completed", input: { q: "?" }, content: [{ type: "text", text: "answer" }] },
            },
            {
              type: "tool",
              id: "t5",
              name: "skill",
              time: { created: at(1), ran: at(1), completed: at(2) },
              state: { status: "completed", input: { id: "demo" }, content: [{ type: "text", text: '<skill_content name="demo">rules</skill_content>' }] },
            },
          ],
        }),
      ] as unknown as SessionMessageInfo[],
      [],
    )
    const tools = new Map(index.scan.tools.map((row) => [row.name, row]))
    assert.equal(tools.get("read")?.calls, 1)
    assert.equal(tools.get("bash")?.failed, 1)
    assert.equal(tools.get("bash")?.unfinished, 1)
    assert.equal(tools.get("question")?.total, 0)
    assert.equal(tools.has("skill"), false)
    assert.equal(index.eventCounts.skill, 1)
    assert.ok(index.scan.generated.calls > 0)
  })

  test("collects command and file rows only with both options set", () => {
    const message = assistant(10, 0, {
      id: "a1",
      time: { created: at(1), completed: at(2) },
      content: [
        {
          type: "tool",
          id: "c1",
          name: "shell",
          time: { created: at(1), ran: at(1), completed: at(2) },
          state: { status: "completed", input: { command: "npm test" }, metadata: { exit: 0 }, content: [] },
        },
      ],
    })
    const none = buildSessionIndex([message], [])
    assert.equal(none.toolScan, undefined)
    assert.equal(none.stepTiming, undefined)
    const both = buildSessionIndex([message], [], { tools: true, timing: true })
    assert.equal(both.toolScan?.commands.length, 1)
    assert.ok((both.stepTiming?.length ?? 0) >= 1)
  })

  test("keeps a running compaction out of the reset and ignores unknown message types", () => {
    const index = buildSessionIndex(
      [
        user("u1", "x".repeat(400)),
        { id: "c1", type: "compaction", status: "running", reason: "auto", summary: "s", time: { created: at(2) } },
        { id: "x1", type: "unknown-kind", time: { created: at(3) } } as unknown as SessionMessageInfo,
        assistant(10, 0, {
          id: "a1",
          time: { created: at(4), completed: at(5) },
          content: [{ type: "reasoning", text: "thinking" }],
          model: undefined,
        }),
      ] as unknown as SessionMessageInfo[],
      [],
    )
    assert.equal(index.eventCounts.compaction, 1)
    assert.equal(index.scan.steps[0].afterCompaction, false)
    assert.ok(index.scan.steps[0].byCategory.user > 0)
    // Reasoning and answers from a step land in the next step's composition.
    assert.ok(index.scan.generated.reasoning > 0)
    assert.equal(index.steps[0].model, undefined)
  })

  test("counts a session-level skill message", () => {
    const index = buildSessionIndex(
      [
        { id: "k1", type: "skill", name: "demo", text: "skill body", time: { created: at(1) } },
        assistant(10, 0, { id: "a1", time: { created: at(2), completed: at(3) }, content: [] }),
      ] as unknown as SessionMessageInfo[],
      [],
    )
    assert.equal(index.eventCounts.skill, 1)
    assert.ok(index.scan.steps[0].byCategory.skills > 0)
  })

  test("keeps an unfinished step's timing out of the rows", () => {
    const index = buildSessionIndex(
      [
        assistant(10, 0, {
          id: "a1",
          time: { created: at(1) },
          content: [
            {
              type: "tool",
              id: "t1",
              name: "read",
              time: { created: at(1), ran: at(1) },
              state: { status: "running", input: {}, metadata: {} },
            },
          ],
        }),
      ] as unknown as SessionMessageInfo[],
      [],
      { timing: true },
    )
    assert.equal(index.scan.steps[0].duration, undefined)
    assert.equal(index.scan.steps[0].wait, 0)
    assert.equal(index.stepTiming?.length, 1)
  })

  test("keeps a non-token assistant message out of the step rows", () => {
    const index = buildSessionIndex(
      [
        {
          id: "a1",
          type: "assistant",
          agent: "build",
          model: { id: "m", providerID: "p" },
          time: { created: at(1) },
          content: [{ type: "text", text: "hello" }],
          tokens: undefined,
        } as unknown as SessionMessageInfo,
      ],
      [],
    )
    assert.deepEqual(index.steps, [])
    assert.deepEqual(index.scan.steps, [])
    assert.ok(index.scan.generated.answers > 0)
  })

  test("reads a tool error message when the tool has no content", () => {
    const index = buildSessionIndex(
      [
        assistant(10, 0, {
          id: "a1",
          time: { created: at(1), completed: at(2) },
          content: [
            {
              type: "tool",
              id: "t1",
              name: "read",
              time: { created: at(1), ran: at(1), completed: at(2) },
              state: { status: "error", input: { path: "a.ts" }, error: { message: "boom" } },
            },
          ],
        }),
        // The next step's composition carries the previous tool result.
        assistant(20, 0, { id: "a2", time: { created: at(3), completed: at(4) }, content: [] }),
      ] as unknown as SessionMessageInfo[],
      [],
    )
    assert.equal(index.scan.steps[0].byCategory.toolResults, 0)
    assert.ok(index.scan.steps[1].byCategory.toolResults > 0)
  })
})

describe("buildEvents edge cases", () => {
  test("reports a compaction without a prior prompt", () => {
    const rows = buildEvents([
      { id: "c1", type: "compaction", status: "completed", reason: "auto", summary: "s", time: { created: at(1) } },
    ] as unknown as SessionMessageInfo[])
    assert.equal(rows[0].tokens, undefined)
    assert.equal(rows[0].grossTokens, undefined)
    assert.equal(rows[0].count, 0)
  })

  test("reports a model switch without a previous model", () => {
    const rows = buildEvents([
      { id: "m1", type: "model-switched", model: { id: "m2", providerID: "p" }, time: { created: at(1) } },
    ] as unknown as SessionMessageInfo[])
    assert.equal(rows[0].from, undefined)
    assert.equal(rows[0].to, "m2")
  })

  test("keeps a running compaction and reports a failed one with its error", () => {
    const rows = buildEvents([
      { id: "c1", type: "compaction", status: "running", reason: "manual", summary: "s", time: { created: at(1) } },
      { id: "c2", type: "compaction", status: "failed", reason: "auto", summary: "s", error: { message: "boom" }, time: { created: at(2) } },
    ] as unknown as SessionMessageInfo[])
    const byID = new Map(rows.map((row) => [row.id, row]))
    assert.equal(byID.get("c1")?.failed, false)
    assert.equal(byID.get("c1")?.error, undefined)
    assert.equal(byID.get("c2")?.failed, true)
    assert.equal(byID.get("c2")?.error, "boom")
  })

  test("counts replaced messages and clears the count after a compaction", () => {
    const rows = buildEvents([
      { id: "u1", type: "user", text: "hello", time: { created: at(1) } },
      { id: "s1", type: "system", text: "rules", time: { created: at(2) } },
      { id: "y1", type: "synthetic", text: "note", time: { created: at(3) } },
      { id: "k1", type: "skill", name: "demo", text: "body", time: { created: at(4) } },
      assistant(10, 0, { id: "a0", time: { created: at(5), completed: at(6) }, content: [] }),
      assistant(10, 0, { id: "a1", time: { created: at(7), completed: at(8) }, content: [{ type: "text", text: "x" }] }),
      { id: "c1", type: "compaction", status: "completed", reason: "auto", summary: "s", time: { created: at(9) } },
      { id: "u2", type: "user", text: "again", time: { created: at(10) } },
      { id: "c2", type: "compaction", status: "completed", reason: "auto", summary: "s", time: { created: at(11) } },
    ] as unknown as SessionMessageInfo[])
    const byID = new Map(rows.map((row) => [row.id, row]))
    assert.equal(byID.get("c1")?.count, 5)
    assert.equal(byID.get("c2")?.count, 2)
    assert.equal(byID.get("c1")?.grossTokens, 10)
  })

  test("names an unnamed injection by its clipped text and keeps detail only with a description", () => {
    const rows = buildEvents([
      { id: "s1", type: "system", text: "rules", time: { created: at(1) } },
      { id: "s2", type: "synthetic", text: "note", description: "Auto note", time: { created: at(2) } },
    ] as unknown as SessionMessageInfo[])
    const byID = new Map(rows.map((row) => [row.id, row]))
    assert.equal(byID.get("s1")?.name, "rules")
    assert.equal(byID.get("s1")?.detail, undefined)
    assert.equal(byID.get("s2")?.name, "Auto note")
    assert.equal(byID.get("s2")?.detail, "note")
  })

  test("reports agent switches and idle success", () => {
    const rows = buildEvents([
      { id: "ag1", type: "agent-switched", agent: "build", previous: "plan", time: { created: at(1) } },
      { id: "i1", type: "idle", outcome: "succeeded", time: { created: at(2) } },
      { id: "i2", type: "idle", outcome: "failed", time: { created: at(3) } },
    ] as unknown as SessionMessageInfo[])
    assert.deepEqual(rows.map((row) => [row.id, row.kind]), [
      ["i2", "error"],
      ["ag1", "agent"],
    ])
    assert.equal(rows.find((row) => row.id === "i2")?.error, undefined)
    assert.equal(rows.find((row) => row.id === "ag1")?.from, "plan")
    assert.equal(rows.find((row) => row.id === "ag1")?.to, "build")
  })

  test("skips non-skill tool parts on assistant messages", () => {
    const rows = buildEvents([
      assistant(10, 0, {
        id: "a1",
        time: { created: at(1), completed: at(2) },
        content: [
          { type: "text", text: "hello" },
          {
            type: "tool",
            id: "t1",
            name: "read",
            time: { created: at(1) },
            state: { status: "completed", input: {}, content: [] },
          },
        ],
      }),
    ] as unknown as SessionMessageInfo[])
    assert.deepEqual(rows, [])
  })
})
