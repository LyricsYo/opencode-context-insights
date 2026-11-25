import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { SessionMessageInfo } from "@opencode/client"
import type { HeaderDetail } from "../../src/shared/header.ts"
import { buildBrowserGroups, buildStepBrief, groupDeltas, groupItems, type BrowserGroup } from "../../src/shared/browser.ts"
import { assistant, at } from "./fixtures.ts"

describe("buildBrowserGroups", () => {
  test("splits tool calls and results and excludes the selected response", () => {
    const header: HeaderDetail = {
      summary: {
        at: at(10),
        systemHash: "s",
        toolsHash: "t",
        system: [{ key: "sys", tokens: 10 }],
        tools: [{ name: "read", tokens: 5 }],
      },
      system: [{ key: "sys", text: "system" }],
      tools: [{ name: "read", description: "Read a file", schema: "{}" }],
    }
    const messages = [
      { id: "u1", type: "user", text: "first", time: { created: at(1) } },
      {
        id: "a1",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(2) },
        content: [
          { type: "text", text: "answer" },
          {
            type: "tool",
            id: "t1",
            name: "read",
            time: { created: at(2) },
            state: {
              status: "completed",
              input: { path: "a.ts" },
              metadata: {},
              content: [{ type: "text", text: "body" }],
            },
          },
        ],
      },
      { id: "u2", type: "user", text: "second", time: { created: at(3) } },
      {
        id: "a2",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(4) },
        content: [{ type: "text", text: "done" }],
      },
    ] as SessionMessageInfo[]

    const groups = buildBrowserGroups(messages, header, "a2")
    const byKey = new Map(groups.map((group) => [group.key, group]))

    assert.equal(byKey.get("system")?.rows[0].tokens, 10)
    assert.equal(byKey.get("tools")?.rows[0].calls, 1)
    assert.equal(byKey.get("assistant")?.rows.length, 1)
    assert.equal(byKey.get("assistant")?.rows[0].text, "answer")
    assert.equal(byKey.get("toolCalls")?.rows.length, 1)
    assert.equal(byKey.get("toolResults")?.rows.length, 1)
    assert.equal(byKey.get("toolResults")?.rows[0].output, "body")

    const live = buildBrowserGroups(messages, header, undefined, true)
    assert.equal(live.find((group) => group.key === "assistant")?.rows.length, 2)
  })
})

describe("buildStepBrief", () => {
  test("lists the opener, the previous response and this step's response", () => {
    const messages = [
      { id: "u1", type: "user", text: "question", time: { created: at(1) } },
      assistant(100, 10, { id: "a1", content: [{ type: "text", text: "first" }] }),
      assistant(110, 20, {
        id: "a2",
        content: [
          {
            type: "tool",
            id: "t2",
            name: "read",
            time: { created: at(110) },
            state: { status: "completed", input: { path: "b.ts" }, metadata: {}, content: [{ type: "text", text: "body" }] },
          },
          { type: "text", text: "second" },
        ],
      }),
    ] as SessionMessageInfo[]

    const second = buildStepBrief(messages, "a2")
    assert.equal(second.opener?.preview, "question")
    assert.equal(second.inputs.length, 1)
    assert.equal(second.inputs[0].preview, "first")
    assert.equal(second.response.length, 2)
    assert.equal(second.response[0].name, "read")
    assert.equal(second.response[1].preview, "second")

    const first = buildStepBrief(messages, "a1")
    assert.equal(first.inputs.length, 0)
    assert.equal(first.response.length, 1)
  })
})

describe("groupItems", () => {
  test("groups items by category and sorts them by weight", () => {
    const groups = groupItems([
      { category: "tools", name: "read", tokens: 10 },
      { category: "system", name: "base", tokens: 50 },
      { category: "tools", name: "bash", tokens: 30 },
    ])

    assert.deepEqual(
      groups.map((group) => [group.category, group.tokens]),
      [
        ["system", 50],
        ["tools", 40],
      ],
    )
    assert.deepEqual(groups[1].items.map((item) => item.name), ["bash", "read"])
  })
})

describe("groupDeltas", () => {
  test("compares tokens and item counts with the previous request", () => {
    const current = [
      { key: "system", tokens: 120, rows: [{}, {}] },
      { key: "tools", tokens: 50, rows: [{}] },
      { key: "user", tokens: 10, rows: [] },
    ] as unknown as BrowserGroup[]
    const base = [
      { key: "system", tokens: 100, rows: [{}] },
      { key: "tools", tokens: 70, rows: [{}] },
    ] as unknown as BrowserGroup[]
    const deltas = groupDeltas(current, base)
    assert.deepEqual(deltas.system, { tokens: 20, items: 1 })
    assert.deepEqual(deltas.tools, { tokens: -20, items: 0 })
    assert.deepEqual(deltas.user, { tokens: 10, items: 0 })
    assert.deepEqual(groupDeltas(current, undefined), {})
  })
})
