import assert from "node:assert/strict"
import { test } from "vitest"
import { clip, compose, estimateTokens } from "../../src/shared/estimate.ts"

test("counts CJK as about one token and ASCII as about four characters", () => {
  assert.equal(estimateTokens(""), 0)
  assert.equal(estimateTokens("abcd"), 1)
  assert.equal(estimateTokens("上下文管理"), 5)
  assert.ok(estimateTokens("hello 世界") >= 3)
})

test("clips long text without normalising the whole payload", () => {
  assert.equal(clip("  hello \n\t world  "), "hello world")
  assert.equal(clip(`${"a ".repeat(5000)}tail`, 10), "a a a a a…")
  // A whitespace-heavy head can collapse below the clip length; the rest of the text still matters.
  assert.equal(clip(`${" ".repeat(1000)}hello`, 5), "hello")
})

test("splits a request into categories and keeps the total consistent", () => {
  const result = compose({
    system: [{ text: "You are a helpful assistant." }],
    tools: { read: { description: "Read a file", input: { type: "object" } } },
    messages: [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Hi" },
          { type: "reasoning", text: "Think first" },
          { type: "tool-call", name: "read", input: { path: "a.txt" } },
        ],
      },
      { role: "tool", content: [{ type: "tool-result", name: "read", result: { type: "text", value: "file body" } }] },
    ],
  })

  for (const category of ["system", "tools", "user", "assistant", "reasoning", "toolCalls", "toolResults"] as const) {
    assert.ok(result.byCategory[category] > 0, `${category} should be counted`)
  }
  assert.equal(result.byCategory.injected, 0)
  assert.equal(
    result.total,
    Object.values(result.byCategory).reduce((sum, value) => sum + value, 0),
  )
})

test("recognises skill and instruction injections", () => {
  const result = compose({
    system: [],
    tools: {},
    messages: [
      { role: "user", content: [{ type: "text", text: '<skill_content name="review">long rules</skill_content>' }] },
      { role: "user", content: [{ type: "text", text: '<context key="deploy">production</context>' }] },
      { role: "system", content: [{ type: "text", text: "Injected reminder" }] },
    ],
  })

  assert.ok(result.byCategory.skills > 0)
  assert.ok(result.byCategory.injected > 0)
  assert.equal(result.items.find((item) => item.category === "skills")?.name, "review")
})

test("a skill tag mentioned inside prose stays a user message", () => {
  const result = compose({
    system: [],
    tools: {},
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: 'checkpoint: tools return <skill_content name="x"> blocks' }],
      },
    ],
  })

  assert.equal(result.byCategory.skills, 0)
  assert.ok(result.byCategory.user > 0)
})

test("a conversation checkpoint is injected context, not skills", () => {
  const result = compose({
    system: [],
    tools: {},
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: '<conversation-checkpoint>\nskills appear as <skill_content name="x">\n</conversation-checkpoint>' }],
      },
    ],
  })

  assert.equal(result.byCategory.skills, 0)
  assert.equal(result.byCategory.user, 0)
  assert.ok(result.byCategory.injected > 0)
})

test("counts a skill tool result as a skill, not a tool result", () => {
  const skillText = '<skill_content name="demo">body</skill_content>'
  const result = compose({
    system: [],
    tools: {},
    messages: [
      { role: "assistant", content: [{ type: "tool-call", name: "skill", input: { id: "demo" } }] },
      {
        role: "tool",
        content: [
          { type: "tool-result", name: "skill", result: { type: "text", value: skillText } },
          { type: "tool-result", name: "read", result: { type: "text", value: "file body" } },
        ],
      },
    ],
  })

  assert.equal(result.byCategory.skills, estimateTokens(skillText))
  assert.equal(result.byCategory.toolResults, estimateTokens("file body"))
})
