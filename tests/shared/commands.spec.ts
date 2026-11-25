import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { SessionMessageInfo } from "@opencode/client"
import { buildCommands, summarizeCommands } from "../../src/shared/commands.ts"
import { assistant, at, tool } from "./fixtures.ts"

describe("buildCommands", () => {
  test("includes nested code mode calls and a program tally", () => {
    const rows = buildCommands([
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
            "c2",
            "execute",
            {
              status: "completed",
              input: { code: "await tools.bash({})" },
              metadata: { toolCalls: [{ tool: "shell", status: "completed", input: { command: "git status" } }] },
              content: [],
            },
            2000,
            2400,
          ),
        ],
      }),
    ] as SessionMessageInfo[])

    assert.deepEqual(
      rows.map((row) => [row.program, row.status]),
      [
        ["npm", "completed"],
        ["git", "completed"],
      ],
    )
    const summary = summarizeCommands(rows)
    assert.equal(summary.runs, 2)
    assert.equal(summary.failed, 0)
    assert.equal(summary.totalMs, 1200)
    assert.deepEqual(summary.programs, [
      { name: "git", count: 1 },
      { name: "npm", count: 1 },
    ])
  })

  test("parses previews, programs, outcomes and the summary lens", () => {
    const rows = buildCommands(
      [
        assistant(1, 0, {
          content: [
            tool(
              "c1",
              "shell",
              { status: "completed", input: { command: "npm test" }, metadata: { status: "completed", exit: 1, truncated: false }, content: [] },
              0,
              5000,
            ),
            tool(
              "c2",
              "shell",
              {
                status: "completed",
                input: { command: "npm test", background: true },
                metadata: { status: "completed", exit: 0 },
                content: [],
              },
              5000,
              12000,
            ),
            tool(
              "c3",
              "shell",
              { status: "completed", input: { command: "git status 2>&1 | cat" }, metadata: { status: "completed", exit: 0 }, content: [] },
              12000,
              13200,
            ),
            {
              type: "tool",
              id: "c4",
              name: "shell",
              time: { created: at(3), ran: at(3) },
              state: { status: "running", input: { command: "sleep 1" }, metadata: {} },
            },
            tool(
              "c5",
              "shell",
              {
                status: "completed",
                input: { command: "cd D:\\repo && env FOO=1 timeout 10s npm test -- --watch" },
                metadata: { status: "completed", exit: 1 },
                content: [{ type: "text", text: "a\nb" }],
              },
              13200,
              13200,
            ),
          ],
        }),
      ] as SessionMessageInfo[],
      "D:\\repo",
    )

    assert.equal(rows.length, 5)
    const preview = rows[4]
    assert.equal(preview.preview, "env FOO=1 timeout 10s npm test -- --watch")
    assert.deepEqual(preview.programs, ["npm"])
    assert.equal(preview.status, "failed")
    assert.equal(preview.outLines, 2)
    assert.equal(preview.outChars, 3)
    assert.deepEqual(rows[2].programs, ["git", "cat"])
    assert.equal(rows[3].status, "running")
    assert.equal(rows[3].duration, undefined)

    const summary = summarizeCommands(rows)
    assert.equal(summary.runs, 4)
    assert.equal(summary.failed, 2)
    assert.equal(summary.background, 1)
    assert.equal(summary.totalMs, 13200)
    assert.equal(summary.programs[0].name, "npm")
    assert.equal(summary.programs[0].count, 3)
    assert.equal(summary.slowest?.ms, 7000)
    assert.deepEqual(summary.failing, { program: "npm", count: 2 })
    assert.equal(summary.repeats?.count, 2)
  })
})
