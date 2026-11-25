import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { SessionMessageInfo } from "@opencode/client"
import { buildBrowserGroups, buildStepBrief } from "../../src/shared/browser.ts"
import { buildStepTiming } from "../../src/shared/timing.ts"
import { at } from "./fixtures.ts"

const png = (width: number, height: number): string => {
  const head = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0)
  head.writeUInt32BE(13, 8)
  Buffer.from("IHDR").copy(head, 12)
  head.writeUInt32BE(width, 16)
  head.writeUInt32BE(height, 20)
  return head.toString("base64")
}

describe("buildStepBrief edges", () => {
  test("returns empty lists for an unknown step", () => {
    assert.deepEqual(buildStepBrief([], "missing"), { inputs: [], response: [] })
  })

  test("previews attachments when the opener has no text", () => {
    const messages = [
      {
        id: "u1",
        type: "user",
        text: "",
        files: [{ mime: "image/png", data: png(10, 10), name: "shot.png" }],
        time: { created: at(1) },
      },
      {
        id: "a1",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(2), completed: at(3) },
        content: [],
      },
    ] as unknown as SessionMessageInfo[]
    const brief = buildStepBrief(messages, "a1")
    assert.equal(brief.opener?.preview, "1 attachments")
  })

  test("shows no inputs at a turn start", () => {
    const messages = [
      { id: "u1", type: "user", text: "go", time: { created: at(1) } },
      {
        id: "a1",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(2), completed: at(3) },
        content: [{ type: "text", text: "first" }],
      },
      { id: "u2", type: "user", text: "again", time: { created: at(4) } },
      {
        id: "a2",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(5), completed: at(6) },
        content: [{ type: "text", text: "second" }],
      },
    ] as unknown as SessionMessageInfo[]
    assert.deepEqual(buildStepBrief(messages, "a2").inputs, [])
    assert.equal(buildStepBrief(messages, "a2").opener?.preview, "again")
  })

  test("lists the previous step's inputs across turns and at the first step", () => {
    const messages = [
      { id: "u1", type: "user", text: "go", time: { created: at(1) } },
      {
        id: "a1",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(2), completed: at(3) },
        content: [{ type: "text", text: "first" }],
        tokens: { input: 10, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      {
        id: "a2",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(4), completed: at(5) },
        content: [{ type: "text", text: "second" }],
        tokens: { input: 20, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    ] as unknown as SessionMessageInfo[]
    const second = buildStepBrief(messages, "a2")
    assert.ok(second.inputs.length >= 1)
    // The first step in the turn has no previous request to compare against.
    assert.deepEqual(buildStepBrief(messages, "a1").inputs, [])
  })

  test("leaves inputs out for a step with no measurable counterpart", () => {
    const messages = [
      { id: "u1", type: "user", text: "go", time: { created: at(1) } },
      {
        id: "a1",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(2) },
        content: [{ type: "text", text: "no tokens" }],
        tokens: undefined,
      },
      {
        id: "a2",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(3), completed: at(4) },
        content: [{ type: "text", text: "second" }],
        tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    ] as unknown as SessionMessageInfo[]
    const brief = buildStepBrief(messages, "a2")
    assert.ok(brief.response.length > 0)
  })

  test("previews a tool input, then its output, then an empty string", () => {
    const messages = [
      {
        id: "a1",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(1), completed: at(2) },
        content: [
          { type: "tool", id: "t1", name: "read", time: { created: at(1) }, state: { status: "completed", input: { path: "a.ts" }, content: [] } },
          { type: "tool", id: "t2", name: "read", time: { created: at(1) }, state: { status: "completed", input: {}, content: [{ type: "text", text: "body" }] } },
          { type: "tool", id: "t3", name: "read", time: { created: at(1) }, state: { status: "completed", input: "", content: [] } },
        ],
        tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    ] as unknown as SessionMessageInfo[]
    const brief = buildStepBrief(messages, "a1")
    const byID = new Map(brief.response.map((entry) => [entry.id, entry]))
    assert.equal(byID.get("t1")?.preview, '{ "path": "a.ts" }')
    assert.equal(byID.get("t2")?.preview, "{}")
    assert.equal(byID.get("t3")?.preview, "")
  })
})

describe("buildBrowserGroups edges", () => {
  test("names user rows by their attachments and lists file attachments", () => {
    const messages = [
      {
        id: "u1",
        type: "user",
        text: "look",
        files: [{ mime: "image/png", data: png(10, 10), name: "shot.png" }],
        time: { created: at(1) },
      },
    ] as unknown as SessionMessageInfo[]
    const groups = buildBrowserGroups(messages, undefined, undefined, true)
    const user = groups.find((group) => group.key === "user")!
    assert.equal(user.rows[0].preview, "shot.png")
    assert.equal(user.rows[0].files?.[0].name, "shot.png")
  })

  test("falls back to the system and tool names without details", () => {
    const messages = [
      { id: "u1", type: "user", text: "hello", time: { created: at(1) } },
      {
        id: "a1",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(2), completed: at(2) },
        content: [
          { type: "tool", id: "t1", name: "read", time: { created: at(2) }, state: { status: "completed", input: {}, content: [] } },
        ],
      },
    ] as unknown as SessionMessageInfo[]
    const header = {
      summary: {
        at: at(10),
        systemHash: "s",
        toolsHash: "t",
        system: [{ key: "core", tokens: 5 }, { key: "extra", tokens: 1 }],
        tools: [
          { name: "read", tokens: 3 },
          { name: "bash", tokens: 2 },
        ],
      },
      system: [{ key: "core", text: "rules" }],
      tools: [{ name: "read", description: "", schema: "" }],
    }
    const groups = buildBrowserGroups(messages, header, "u1", true)
    const system = groups.find((group) => group.key === "system")!
    assert.equal(system.rows[1].preview, "")
    const tools = groups.find((group) => group.key === "tools")!
    assert.equal(tools.rows[0].preview, "read")
    assert.equal(tools.rows[1].preview, "bash")
    assert.equal(tools.rows[1].calls, 0)
  })

  test("keeps every surface kind in its own group", () => {
    const messages = [
      { id: "c1", type: "compaction", status: "completed", reason: "auto", summary: "sum", time: { created: at(0) } },
      { id: "s1", type: "system", text: "rules", time: { created: at(1) } },
      { id: "y1", type: "synthetic", text: "note", time: { created: at(2) } },
      { id: "k1", type: "skill", name: "demo", text: "skill body", time: { created: at(3) } },
      { id: "u1", type: "user", text: "hello", time: { created: at(4) } },
      {
        id: "a1",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(5), completed: at(5) },
        content: [
          { type: "text", text: "answer" },
          { type: "reasoning", text: "thinking" },
        ],
      },
    ] as unknown as SessionMessageInfo[]
    const groups = new Map(buildBrowserGroups(messages, undefined, undefined, true).map((group) => [group.key, group]))
    assert.equal(groups.get("injected")?.rows.length, 3)
    assert.equal(groups.get("skills")?.rows[0].name, "demo")
    assert.equal(groups.get("user")?.rows[0].text, "hello")
    assert.equal(groups.get("assistant")?.rows[0].text, "answer")
    assert.equal(groups.get("reasoning")?.rows[0].text, "thinking")
  })

  test("counts tool calls and sorts rows by time then position", () => {
    const messages = [
      { id: "u1", type: "user", text: "first", time: { created: at(5) } },
      { id: "u2", type: "user", text: "second", time: { created: at(5) } },
      {
        id: "a1",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(5), completed: at(5) },
        content: [
          { type: "tool", id: "t1", name: "read", time: { created: at(5) }, state: { status: "completed", input: {}, content: [] } },
          { type: "tool", id: "t2", name: "read", time: { created: at(5) }, state: { status: "completed", input: {}, content: [] } },
        ],
      },
    ] as unknown as SessionMessageInfo[]
    const header = {
      summary: {
        at: at(5),
        systemHash: "s",
        toolsHash: "t",
        system: [],
        tools: [{ name: "read", tokens: 1 }],
      },
      system: [],
      tools: [{ name: "read", description: "", schema: "{}" }],
    }
    const groups = buildBrowserGroups(messages, header, undefined, true)
    assert.equal(groups.find((group) => group.key === "tools")?.rows[0].calls, 2)
    const users = groups.find((group) => group.key === "user")!
    // Same timestamp: the later position wins.
    assert.deepEqual(users.rows.map((row) => row.text), ["second", "first"])
  })
})

describe("buildStepTiming from the session index", () => {
  test("keeps a step whose timing has not been measured before", () => {
    const rows = buildStepTiming([
      {
        id: "a1",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(1), completed: at(2) },
        content: [{ type: "text", text: "answer" }],
        tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    ] as unknown as SessionMessageInfo[])
    assert.equal(rows.length, 1)
    assert.equal(rows[0].text, 60_000)
    assert.equal(rows[0].wall, 60_000)
  })
})
