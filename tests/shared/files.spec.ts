import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { SessionMessageInfo } from "@opencode/client"
import { buildFileOps, groupFileOps } from "../../src/shared/files.ts"
import { assistant, tool } from "./fixtures.ts"

describe("buildFileOps", () => {
  test("tracks reads, writes, edits and searches", () => {
    const rows = buildFileOps([
      assistant(1, 0, {
        content: [
          tool("f1", "read", { status: "completed", input: { path: "a.ts" }, content: [{ type: "text", text: "Read file a.ts, lines 10-19" }] }, 0, 100),
          tool("f2", "write", { status: "completed", input: { path: "b.ts", content: "a\nb\nc" }, content: [] }, 0, 100),
          tool(
            "f3",
            "edit",
            {
              status: "completed",
              input: { path: "c.ts", oldString: "x", newString: "y" },
              metadata: { files: [{ file: "c.ts", additions: 2, deletions: 1, status: "modified" }] },
              content: [],
            },
            0,
            100,
          ),
          tool("f4", "grep", { status: "completed", input: { path: "src", pattern: "foo" }, metadata: { matches: 3 }, content: [] }, 0, 100),
        ],
      }),
    ] as SessionMessageInfo[])

    const byPath = new Map(groupFileOps(rows).map((row) => [row.path, row]))
    assert.equal(byPath.get("a.ts")?.reads, 1)
    assert.equal(byPath.get("a.ts")?.ops[0].lines, 10)
    assert.equal(byPath.get("b.ts")?.additions, 3)
    assert.equal(byPath.get("c.ts")?.additions, 2)
    assert.equal(byPath.get("c.ts")?.deletions, 1)
    assert.equal(byPath.get("src")?.searches, 1)
    assert.equal(byPath.get("src")?.ops[0].hits, 3)
  })
})

describe("groupFileOps", () => {
  test("merges relative and absolute paths under the workspace root", () => {
    const rows = buildFileOps([
      assistant(1, 0, {
        content: [
          tool("r1", "read", { status: "completed", input: { path: "D:\\repo\\src\\a.ts" }, content: [] }, 0, 100),
          tool("w1", "write", { status: "completed", input: { path: "src/a.ts", content: "line" }, content: [] }, 0, 100),
        ],
      }),
    ] as SessionMessageInfo[])

    const groups = groupFileOps(rows, "D:\\repo")
    assert.equal(groups.length, 1)
    assert.equal(groups[0].path, "src/a.ts")
    assert.equal(groups[0].reads, 1)
    assert.equal(groups[0].writes, 1)
  })
})
