import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { SessionMessageInfo } from "@opencode/client"
import { buildFileOps, buildToolScan, cachedToolScanOf, groupFileOps } from "../../src/shared/files.ts"

const at = (minute: number) => Date.UTC(2026, 0, 1, 0, minute)

function assistant(id: string, content: unknown[], patch: Record<string, unknown> = {}): SessionMessageInfo {
  return {
    id,
    type: "assistant",
    agent: "build",
    model: { id: "m", providerID: "p" },
    time: { created: at(0), completed: at(1) },
    content,
    tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    cost: 0,
    ...patch,
  } as unknown as SessionMessageInfo
}

function tool(id: string, name: string, state: Record<string, unknown>, patch: Record<string, unknown> = {}) {
  return { type: "tool", id, name, time: { created: at(0), ran: at(0), completed: at(1) }, state, ...patch }
}

describe("tool scan cache", () => {
  test("skips non-assistant messages", () => {
    const user = { id: "u1", type: "user", text: "hi", time: { created: at(0) } } as SessionMessageInfo
    assert.deepEqual(cachedToolScanOf(user, undefined), { commands: [], files: [] })
    assert.deepEqual(buildToolScan([user]), { commands: [], files: [] })
  })

  test("reuses a settled scan and its keyed cache", () => {
    const message = assistant("cache-1", [{ type: "text", text: "answer" }])
    const first = cachedToolScanOf(message, undefined)
    assert.equal(cachedToolScanOf(message, undefined), first)

    // A changed creation time misses the weak cache but keeps the key, so the keyed cache answers.
    const source = message as unknown as { time: { created: number } }
    source.time.created += 1
    assert.equal(cachedToolScanOf(message, undefined), first)
  })

  test("does not settle an unfinished message but reuses its keyed scan", () => {
    const message = assistant("cache-2", [
      tool("t1", "read", { status: "running", input: { path: "a.ts" }, metadata: {} }, { time: { created: at(0), ran: at(0), completed: 0 } }),
    ]) as unknown as { time: { created: number; completed?: number }; content: Array<{ time: { completed?: number } }> }
    message.time.completed = 0
    const first = cachedToolScanOf(message as unknown as SessionMessageInfo, undefined)
    assert.equal(first.files.length, 1)

    // Same key (missing completion reads as 0) but no longer stable.
    message.time.completed = undefined
    message.time.created = 99
    assert.equal(cachedToolScanOf(message as unknown as SessionMessageInfo, undefined), first)
  })

  test("does not cache a scan while any completion is missing", () => {
    const message = assistant("cache-3", [
      tool("t1", "read", { input: { path: "a.ts" } }, { time: { created: at(0), ran: at(0) } }),
    ])
    const first = cachedToolScanOf(message, undefined)
    assert.equal(cachedToolScanOf(message, undefined).files[0].id, first.files[0].id)
  })

  test("evicts the oldest cached message after 2048 entries", () => {
    for (let index = 0; index < 2_049; index++) {
      const message = assistant(`evict-${index}`, [])
      cachedToolScanOf(message, undefined)
    }
    assert.ok(buildToolScan([assistant("evict-last", [])]).commands.length === 0)
  })
})

describe("tool extraction details", () => {
  test("keeps read, write, edit and search rows with their optional fields", () => {
    const rows = buildFileOps([
      assistant("m1", [
        tool("r1", "read", { status: "completed", input: { path: "a.ts", limit: 20 }, content: [] }),
        tool("r2", "read", { status: "completed", input: {}, content: [] }),
        tool("w1", "write", { status: "completed", input: { path: "b.ts", content: "a\nb" }, content: [] }),
        tool("w2", "write", { status: "completed", input: {}, content: [] }),
        tool(
          "g1",
          "grep",
          { status: "completed", input: { pattern: "needle", include: "*.ts" }, metadata: { matches: 2 }, content: [] },
        ),
        tool("g2", "glob", { status: "completed", input: { path: "src" }, content: [] }),
        tool("g3", "glob", { status: "completed", input: {}, content: [] }),
        tool("g4", "grep", { status: "completed", input: { include: "*.md" }, content: [] }),
        tool("r3", "read", { status: "completed", input: { path: "c.ts" }, content: [{ type: "text", text: "Read file c.ts, lines 10-19" }] }),
      ]),
    ])
    const byID = new Map(rows.map((row) => [row.id, row]))
    assert.equal(byID.get("r1")?.lines, 20)
    assert.equal(byID.get("r2"), undefined)
    assert.equal(byID.get("w1")?.additions, 2)
    assert.equal(byID.get("w2"), undefined)
    assert.equal(byID.get("g1")?.path, "needle")
    assert.equal(byID.get("g1")?.detail, "needle")
    assert.equal(byID.get("g1")?.hits, 2)
    assert.equal(byID.get("g2")?.path, "src")
    assert.equal(byID.get("g3")?.path, "glob")
    assert.equal(byID.get("g4")?.path, "grep")
    assert.equal(byID.get("g4")?.detail, "*.md")
    assert.equal(byID.get("r3")?.lines, 10)
  })

  test("prefers edit metadata files and falls back to the input diff", () => {
    const rows = buildFileOps([
      assistant("m2", [
        tool(
          "e1",
          "edit",
          {
            status: "completed",
            input: { path: "fallback.ts", oldString: "a", newString: "b" },
            metadata: {
              files: [
                null,
                {},
                { file: "x.ts", additions: 2, deletions: 1, status: "modified" },
                { file: "y.ts" },
              ],
            },
            content: [],
          },
        ),
        tool("e2", "edit", { status: "completed", input: { path: "input.ts", newString: "n\nm", oldString: "o" }, metadata: { files: [] }, content: [] }),
        tool("e3", "edit", { status: "completed", input: {}, metadata: {}, content: [] }),
      ]),
    ])
    const byID = new Map(rows.map((row) => [row.id, row]))
    assert.equal(byID.get("e1:2")?.path, "x.ts")
    assert.equal(byID.get("e1:2")?.status, "modified")
    assert.equal(byID.get("e1:2")?.additions, 2)
    assert.equal(byID.get("e1:3")?.status, "completed")
    assert.equal(byID.get("e2")?.path, "input.ts")
    assert.equal(byID.get("e2")?.additions, 2)
    assert.equal(byID.get("e2")?.deletions, 1)
    assert.equal(byID.get("e3"), undefined)
  })

  test("records command fields and background shells", () => {
    const scan = buildToolScan([
      assistant("m3", [
        tool(
          "c1",
          "shell",
          {
            status: "completed",
            input: { command: "npm test", description: "run", workdir: "D:/repo", timeout: 5000, background: true },
            metadata: { exit: 0, truncated: true },
            content: [{ type: "text", text: "ok" }],
          },
        ),
        tool(
          "c2",
          "bash",
          { status: "completed", input: { command: "npm run" }, metadata: { shellID: "s1" }, content: [] },
        ),
      ]),
    ])
    const first = scan.commands.find((row) => row.id === "c1")!
    assert.equal(first.description, "run")
    assert.equal(first.workdir, "D:/repo")
    assert.equal(first.timeoutMs, 5000)
    assert.equal(first.background, true)
    assert.equal(first.truncated, true)
    assert.equal(first.output, "ok")
    assert.equal(first.exit, 0)
    assert.equal(scan.commands.find((row) => row.id === "c2")?.background, true)
  })

  test("reads nested execute calls with their own statuses and file rows", () => {
    const scan = buildToolScan([
      assistant("m4", [
        tool("x1", "execute", {
          status: "completed",
          input: {},
          metadata: {
            toolCalls: [
              null,
              { tool: "read", input: { path: "a.ts", limit: 3 }, status: "running" },
              { tool: "read", input: {}, status: "completed" },
              { tool: "write", input: { path: "b.ts", content: "x\ny" }, status: "completed" },
              { tool: "edit", input: { path: "c.ts", newString: "n", oldString: "o" }, status: "completed" },
              { tool: "edit", input: {}, status: "completed" },
              { tool: "write", input: {}, status: "completed" },
              { tool: "read", input: {}, status: "completed" },
              { tool: "grep", input: { pattern: "p" }, status: "completed" },
              { tool: "glob", input: { pattern: "*.ts" }, status: "completed" },
              { tool: "glob", input: {}, status: "completed" },
              { tool: "shell", input: { command: "git status" }, status: "completed" },
              { tool: "shell", input: { command: "bad" }, status: "weird" },
              { tool: "shell", input: { command: "unknown" }, status: "unknown" },
              { tool: "shell", input: { command: "none" } },
              { input: { command: "no-tool" } },
            ],
          },
          content: [],
        }),
        tool("x2", "execute", { status: "completed", input: {}, metadata: {}, content: [] }),
      ]),
    ])
    const statuses = new Map(scan.commands.map((row) => [row.id, row.status]))
    assert.equal(statuses.get("x1:11"), "completed")
    assert.equal(statuses.get("x1:12"), "failed")
    assert.equal(statuses.get("x1:13"), "completed")
    assert.equal(statuses.get("x1:14"), "completed")
    assert.equal(scan.files.filter((row) => row.messageID === "m4").length, 6)
  })

  test("ignores execute calls that are not a list", () => {
    const scan = buildToolScan([
      assistant("m5", [tool("x3", "execute", { status: "completed", input: {}, metadata: { toolCalls: "nope" }, content: [] })]),
    ])
    assert.equal(scan.commands.length, 0)
  })

  test("fills missing status, input, ran and duration fields", () => {
    const scan = buildToolScan([
      assistant("m6", [
        tool("s1", "shell", { input: {} }, { time: { created: at(0), completed: at(1) } }),
        tool("s2", "shell", { status: "completed" }, { time: { created: at(0) } }),
        tool("w1", "write", { status: "completed", input: { path: "x.ts" } }),
        tool("e1", "edit", { status: "completed", input: { path: "y.ts" }, metadata: {} }),
        tool("x1", "execute", {
          status: "completed",
          metadata: {
            toolCalls: [
              { tool: "write", status: "completed", input: { path: "w.ts", content: "a\nb" } },
              { tool: "write", status: "completed", input: { path: "w0.ts" } },
              { tool: "write", status: "completed", input: {} },
              { tool: "edit", status: "completed", input: { path: "e.ts" } },
              { tool: "edit", status: "completed", input: { path: "e.ts", newString: "n", oldString: "o" } },
              { tool: "shell", status: "running" },
              { tool: "shell", status: "completed", input: {} },
            ],
          },
        }),
      ]),
    ])
    const commands = new Map(scan.commands.map((row) => [row.id, row]))
    assert.equal(commands.get("s1")?.command, "")
    assert.equal(commands.get("s1")?.at, at(0))
    assert.equal(commands.get("s2")?.duration, undefined)
    assert.equal(commands.get("x1:5")?.status, "running")
    assert.equal(commands.get("x1:6")?.status, "completed")
    const files = new Map(scan.files.map((row) => [row.id, row]))
    assert.equal(files.get("w1")?.additions, 0)
    assert.equal(files.get("e1")?.additions, 0)
    assert.equal(files.get("e1")?.deletions, 0)
    assert.equal(files.get("x1:0")?.additions, 2)
    assert.equal(files.get("x1:1")?.additions, 0)
    assert.equal(files.get("x1:3")?.additions, 0)
    assert.equal(files.get("x1:3")?.deletions, 0)
  })
})

describe("step snapshot files", () => {
  test("adds changed files no file tool reported", () => {
    const rows = buildFileOps([
      assistant(
        "snap-1",
        [tool("c1", "shell", { status: "completed", input: { command: "node build.js" }, content: [] })],
        { snapshot: { start: "a", end: "b", files: [".archify/report.html", "notes/out.md"] } },
      ),
    ])
    const byID = new Map(rows.map((row) => [row.id, row]))
    const html = byID.get("snap-1:snapshot:.archify/report.html")
    assert.equal(html?.kind, "write")
    assert.equal(html?.tool, "snapshot")
    assert.equal(html?.status, "completed")
    assert.equal(html?.at, at(1))
    assert.equal(rows.length, 2)
  })

  test("does not repeat files a tool already wrote", () => {
    const scan = buildToolScan(
      [
        assistant(
          "snap-2",
          [tool("w1", "write", { status: "completed", input: { path: "src/a.ts", content: "x" }, content: [] })],
          { snapshot: { files: ["D:/repo/src/a.ts", "src/b.ts"] } },
        ),
      ],
      "D:/repo",
    )
    assert.deepEqual(
      scan.files.filter((row) => row.kind === "write").map((row) => row.path),
      ["src/a.ts", "src/b.ts"],
    )
  })

  test("ignores a missing or empty snapshot file list", () => {
    assert.deepEqual(buildFileOps([assistant("snap-3", [], { snapshot: {} })]), [])
    assert.deepEqual(buildFileOps([assistant("snap-4", [], { snapshot: { files: [] } })]), [])
  })

  test("stamps snapshot files with the creation time while the step runs", () => {
    const message = assistant("snap-5", [], { snapshot: { files: ["out.html"] } })
    ;(message as unknown as { time: { completed?: number } }).time.completed = undefined
    assert.equal(cachedToolScanOf(message, undefined).files[0].at, at(0))
  })

  test("rescans when the snapshot lands after the tools settle", () => {
    const message = assistant("snap-6", [])
    assert.equal(cachedToolScanOf(message, undefined).files.length, 0)
    ;(message as unknown as { snapshot: unknown }).snapshot = { files: ["out.html"] }
    const rows = cachedToolScanOf(message, undefined).files
    assert.equal(rows.length, 1)
    assert.equal(rows[0].path, "out.html")
  })
})

describe("groupFileOps details", () => {
  test("keeps paths absolute without a root and strips a matching root", () => {
    const rows = buildFileOps([
      assistant("g1", [
        tool("r1", "read", { status: "completed", input: { path: "D:\\repo\\src\\a.ts" }, content: [] }),
        tool("r2", "read", { status: "completed", input: { path: "D:/repo/src/a.ts" }, content: [] }),
        tool("r3", "read", { status: "completed", input: { path: "other/b.ts" }, content: [] }),
      ]),
    ])
    assert.equal(groupFileOps(rows, "D:/repo/").length, 2)
    assert.equal(groupFileOps(rows, "").length, 2)
    assert.equal(groupFileOps(rows).length, 2)
    assert.ok(groupFileOps(rows).some((row) => row.path === "D:/repo/src/a.ts"))
    assert.ok(groupFileOps(rows).some((row) => row.path === "other/b.ts"))
  })

  test("sorts by writes, changed lines, reads and path", () => {
    const op = (path: string, kind: "read" | "write" | "search", additions = 0, deletions = 0, at = 0) => ({
      id: path + kind + at,
      messageID: "m",
      at,
      kind,
      path,
      tool: "x",
      status: "completed",
      additions,
      deletions,
    })
    const rows = groupFileOps([
      op("b.ts", "read"),
      op("a.ts", "read"),
      op("write.ts", "write", 1, 1),
      op("wide.ts", "write", 5, 5),
      op("small.ts", "write", 1, 0),
      op("search.ts", "search"),
      op("c.ts", "read"),
      op("a.ts", "read", 0, 0, 10),
    ])
    assert.deepEqual(rows.map((row) => row.path), [
      "wide.ts",
      "write.ts",
      "small.ts",
      "a.ts",
      "b.ts",
      "c.ts",
      "search.ts",
    ])
    assert.deepEqual(rows.find((row) => row.path === "a.ts")?.ops.map((entry) => entry.at), [10, 0])
  })
})
