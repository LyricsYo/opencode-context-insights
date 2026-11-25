import assert from "node:assert/strict"
import { test } from "vitest"
import { headerAt, summarizeHeader, systemPartsOf, toolSourceOf, toolsOf } from "../../src/shared/header.ts"

test("system parts split experimental instructions by source", () => {
  const parts = systemPartsOf([
    {
      text: "whole prompt",
      metadata: {
        experimental: {
          instructions: [
            { key: "core", text: "be brief" },
            { key: "skills", text: "skill list" },
            { key: "blank", text: "   " },
          ],
        },
      },
    },
    { text: "plain fallback" },
  ])

  assert.deepEqual(parts, [
    { key: "core", text: "be brief" },
    { key: "skills", text: "skill list" },
    { key: "system", text: "plain fallback" },
  ])
})

test("system parts fall back to the part text when instructions are missing", () => {
  assert.deepEqual(systemPartsOf([{ text: "hello" }, { text: "" }, { metadata: {} }]), [
    { key: "system", text: "hello" },
  ])
})

test("tools keep their schema and sort by name", () => {
  const tools = toolsOf({
    z: { description: "last", input: { type: "object", properties: { path: { type: "string" } } } },
    a: { description: "first" },
  })

  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["a", "z"],
  )
  assert.equal(tools[0].description, "first")
  assert.equal(tools[0].schema, "{}")
  assert.equal(tools[1].schema, JSON.stringify({ type: "object", properties: { path: { type: "string" } } }, null, 1))
})

test("tool sources follow core, mcp and namespace naming", () => {
  assert.equal(toolSourceOf("read"), "core")
  assert.equal(toolSourceOf("mcp__playwright__browser_click"), "mcp:playwright")
  assert.equal(toolSourceOf("mcp__playwright"), "mcp:playwright")
  assert.equal(toolSourceOf("acme_greeting"), "acme")
  assert.equal(toolSourceOf("vendor.tool"), "vendor")
  assert.equal(toolSourceOf("custom"), undefined)
  assert.equal(toolsOf({ image_generate: { description: "draw" } })[0].source, "core")
})

test("header summaries count tokens and lookup picks the version before a step", () => {
  const system = [{ key: "core", text: "x".repeat(400) }]
  const tools = [{ name: "read", description: "read files", schema: "{}" }]
  const first = summarizeHeader(1000, "sys-a", "tools-a", system, tools)
  const second = summarizeHeader(5000, "sys-b", "tools-b", [], [])

  assert.equal(first.system[0].tokens, 100)
  assert.ok(first.tools[0].tokens > 0)
  assert.equal(headerAt([first, second], -3000), undefined)
  assert.equal(headerAt([first, second], 3000)?.systemHash, "sys-a")
  assert.equal(headerAt([first, second], 4800)?.systemHash, "sys-b")
  assert.equal(headerAt([first, second], 9000)?.systemHash, "sys-b")
})
