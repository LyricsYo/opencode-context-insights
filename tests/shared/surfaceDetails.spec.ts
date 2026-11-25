import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { SessionMessageInfo } from "@opencode/client"
import { buildSurface, userSurface } from "../../src/shared/surface.ts"

const at = (minute: number) => Date.UTC(2026, 0, 1, 0, minute)

const messages = [
  { id: "s0", type: "system", text: "base rules", time: { created: at(0) } },
  { id: "u1", type: "user", text: "hello", time: { created: at(1) } },
  { id: "y1", type: "synthetic", text: "auto note", time: { created: at(2) } },
  { id: "k1", type: "skill", name: "demo", text: "skill body", time: { created: at(3) } },
  {
    id: "a1",
    type: "assistant",
    agent: "build",
    model: { id: "m", providerID: "p" },
    time: { created: at(4) },
    content: [
      { type: "text", text: "reply" },
      { type: "reasoning", text: "thinking" },
      {
        type: "tool",
        id: "t1",
        name: "read",
        time: { created: at(4) },
        state: {
          status: "completed",
          input: { path: "a.ts" },
          metadata: { truncated: true },
          content: [{ type: "text", text: "body" }],
        },
      },
      {
        type: "tool",
        id: "t2",
        name: "read",
        time: { created: at(4) },
        state: { status: "completed", input: {}, content: [{ type: "file", uri: "file:///x.pdf", mime: "application/pdf" }] },
      },
      {
        type: "tool",
        id: "t3",
        name: "read",
        time: { created: at(4) },
        state: { status: "error", input: "raw", error: { message: "boom" } },
      },
      {
        type: "tool",
        id: "t4",
        name: "skill",
        time: { created: at(4) },
        state: { status: "completed", input: { id: "demo" }, content: [{ type: "text", text: '<skill_content name="demo">rules</skill_content>' }] },
      },
    ],
  },
  { id: "u2", type: "user", text: "again", time: { created: at(5) }, files: [{ type: "file", mime: "text/plain", data: "aGk=", source: "clipboard" }] },
  { id: "c1", type: "compaction", status: "completed", reason: "auto", summary: "sum", time: { created: at(6) } },
  { id: "c2", type: "compaction", status: "running", reason: "manual", summary: "pending", time: { created: at(7) } },
] as unknown as SessionMessageInfo[]

describe("userSurface", () => {
  test("classifies checkpoints, named and unnamed skills, contexts and plain user text", () => {
    assert.deepEqual(userSurface("  <conversation-checkpoint>x</conversation-checkpoint>"), {
      kind: "synthetic",
      name: "Conversation checkpoint",
    })
    assert.deepEqual(userSurface('<skill_content name="review">x</skill_content>'), { kind: "skill", name: "review" })
    assert.deepEqual(userSurface("<skill_content>x</skill_content>"), { kind: "skill", name: "Skill" })
    assert.deepEqual(userSurface("<context>x</context>"), { kind: "synthetic", name: "Injected context" })
    assert.deepEqual(userSurface("mentions <context> mid-sentence"), { kind: "user", name: "User" })
  })
})

describe("buildSurface kinds and filters", () => {
  test("covers every message kind up to the end", () => {
    const entries = buildSurface(messages, undefined, true, true)
    const kinds = new Set(entries.map((entry) => entry.kind))
    for (const kind of ["system", "user", "synthetic", "skill", "reply", "reasoning", "tool", "compaction"]) {
      assert.ok(kinds.has(kind as never), kind)
    }
  })

  test("filters by kind", () => {
    const entries = buildSurface(messages, undefined, true, true, new Set(["reply", "tool"]))
    assert.deepEqual([...new Set(entries.map((entry) => entry.kind))].sort(), ["reply", "tool"])
    assert.equal(buildSurface(messages, undefined, true, true, new Set(["skill"])).length, 2)
  })

  test("stops before a compaction when the step is excluded", () => {
    const before = buildSurface(messages, "c1", false, true)
    assert.equal(before.some((entry) => entry.kind === "compaction"), false)
    assert.ok(before.some((entry) => entry.id === "y1"))
  })

  test("keeps the compaction summary only when it completed", () => {
    const entries = buildSurface(messages, undefined, true, true, new Set(["compaction"]))
    const incomplete = entries.find((entry) => entry.id === "c2")!
    assert.equal(incomplete.text, "")
    assert.equal(incomplete.name, "Compaction · manual")
    assert.equal(entries.find((entry) => entry.id === "c1")?.text, "sum")
  })

  test("ignores unrelated message and part types and fills missing tool state", () => {
    const entries = buildSurface(
      [
        { id: "m1", type: "model-switched", model: { id: "m", providerID: "p" }, time: { created: at(0) } },
        {
          id: "a1",
          type: "assistant",
          agent: "build",
          model: { id: "m", providerID: "p" },
          time: { created: at(1) },
          content: [
            { type: "file", mime: "text/plain", uri: "file:///x.txt" },
            { type: "tool", id: "t9", name: "read", time: { created: at(1) }, state: {} },
          ],
        },
      ] as unknown as SessionMessageInfo[],
      undefined,
      true,
      true,
      new Set(["tool"]),
    )
    assert.equal(entries.length, 1)
    assert.equal(entries[0].status, "unknown")
    assert.equal(entries[0].output, "")
    assert.equal(entries[0].input, "{}")
    assert.equal(entries[0].truncated, false)
  })
})

describe("buildSurface tool rows", () => {
  test("records input, output, tokens, truncation and attachments", () => {
    const entries = buildSurface(messages, "a1", true, true, new Set(["tool"]))
    const tool = entries.find((entry) => entry.id === "t1")!
    assert.equal(tool.input, '{\n "path": "a.ts"\n}')
    assert.equal(tool.output, "body")
    assert.equal(tool.truncated, true)
    assert.equal(tool.status, "completed")
    assert.ok((tool.callTokens ?? 0) > 0)
    assert.ok((tool.resultTokens ?? 0) > 0)

    const file = entries.find((entry) => entry.id === "t2")!
    assert.equal(file.files?.[0].name, "x.pdf")
    assert.equal(file.files?.[0].mime, "application/pdf")

    const failed = entries.find((entry) => entry.id === "t3")!
    assert.equal(failed.input, "raw")
    assert.equal(failed.output, "boom")
    assert.equal(failed.status, "error")
    assert.equal(failed.files, undefined)
  })
})

describe("buildSurface user attachments", () => {
  test("keeps well-formed attachments and skips others", () => {
    const entries = buildSurface(
      [
        {
          id: "u1",
          type: "user",
          text: "look",
          time: { created: at(1) },
          files: [
            null,
            { type: "image" },
            { mime: "image/png", data: "aGk=" },
            { uri: "file:///dir/x.pdf" },
            {},
          ],
        },
        { id: "u2", type: "user", text: "none", time: { created: at(2) }, files: [] },
        { id: "u3", type: "user", text: "bad", time: { created: at(3) }, files: "nope" },
      ] as unknown as SessionMessageInfo[],
    )
    const files = entries.find((entry) => entry.id === "u1")?.files ?? []
    assert.deepEqual(files.map((file) => file.name), ["file", "x.pdf"])
    assert.equal(files[0].mime, "image/png")
    assert.equal(files[1].mime, "application/octet-stream")
    assert.equal(entries.find((entry) => entry.id === "u2")?.files, undefined)
    assert.equal(entries.find((entry) => entry.id === "u3")?.files, undefined)
  })

  test("counts turns and steps across a compaction and keeps labels for hidden rows", () => {
    const compacted = [
      { id: "u1", type: "user", text: "old", time: { created: at(1) } },
      {
        id: "a1",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(2) },
        content: [{ type: "text", text: "old reply" }],
      },
      { id: "c1", type: "compaction", status: "completed", reason: "auto", summary: "sum", time: { created: at(3) } },
      { id: "u2", type: "user", text: "new", time: { created: at(4) } },
      {
        id: "a2",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(5) },
        content: [
          { type: "text", text: "first" },
          { type: "text", text: "second" },
        ],
      },
    ] as unknown as SessionMessageInfo[]
    const entries = buildSurface(compacted, undefined, true, false, new Set(["user", "reply"]))
    assert.deepEqual(entries.map((entry) => [entry.kind, entry.turn, entry.step, entry.text]), [
      ["user", 2, 1, "new"],
      ["reply", 2, 1, "first"],
      ["reply", 2, 1, "second"],
    ])
  })

  test("returns nothing when the stop id is missing", () => {
    const entries = buildSurface(messages, "missing", true, true, new Set(["user"]))
    assert.equal(entries.length, 2)
  })
})
