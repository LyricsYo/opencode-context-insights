import assert from "node:assert/strict"
import { describe, test } from "vitest"
import {
  addText,
  baseToolName,
  contentText,
  delegationWaitOf,
  emptyCategories,
  excludedWaitOf,
  isDelegationTool,
  isQuestionTool,
  lineCount,
  numberOf,
  objectOf,
  questionWaitOf,
  skillToolOf,
  stringOf,
  sumCategories,
  textOf,
  unionMs,
} from "../../src/shared/reportInternal.ts"
import type { SessionMessageInfo } from "@opencode/client"

const at = (minute: number) => Date.UTC(2026, 0, 1, 0, minute)

describe("value helpers", () => {
  test("objectOf, numberOf and stringOf accept only their own types", () => {
    assert.deepEqual(objectOf({ a: 1 }), { a: 1 })
    assert.equal(objectOf(null), undefined)
    assert.equal(objectOf("x"), undefined)
    assert.equal(numberOf(0), 0)
    assert.equal(numberOf(Number.NaN), undefined)
    assert.equal(numberOf("1"), undefined)
    assert.equal(stringOf("x"), "x")
    assert.equal(stringOf(""), undefined)
    assert.equal(stringOf(1), undefined)
  })

  test("contentText joins text parts and names files", () => {
    assert.equal(contentText("not a list"), "")
    assert.equal(contentText([null, { type: "text", text: "a" }, { type: "text" }, { type: "file", name: "x.pdf" }, { type: "file", uri: "file:///y" }, { type: "file" }]), "a\n[file] x.pdf\n[file] file:///y\n[file] ")
  })

  test("lineCount counts lines and treats empty text as zero", () => {
    assert.equal(lineCount(""), 0)
    assert.equal(lineCount("a"), 1)
    assert.equal(lineCount("a\nb"), 2)
    assert.equal(lineCount("a\nb\n"), 2)
    assert.equal(lineCount("a\r\nb\r\n"), 2)
  })

  test("baseToolName keeps the last dotted segment", () => {
    assert.equal(baseToolName("mcp.read"), "read")
    assert.equal(baseToolName("read"), "read")
    assert.equal(baseToolName(""), "")
    assert.equal(isQuestionTool("mcp.question"), true)
    assert.equal(isQuestionTool("read"), false)
    assert.equal(isDelegationTool("mcp.task"), true)
    assert.equal(isDelegationTool("subagent"), true)
    assert.equal(isDelegationTool("read"), false)
  })

  test("categories start empty and sum through the order", () => {
    const categories = emptyCategories()
    assert.equal(sumCategories(categories), 0)
    addText(categories, "user", "abcd")
    assert.equal(categories.user, 1)
    assert.equal(sumCategories(categories), 1)
  })

  test("textOf returns strings, JSON and a stringified fallback", () => {
    assert.equal(textOf("x"), "x")
    assert.equal(textOf({ a: 1 }), '{"a":1}')
    assert.equal(textOf(undefined), "{}")
    const circular: Record<string, unknown> = {}
    circular.self = circular
    assert.equal(textOf(circular), "[object Object]")
  })
})

describe("skillToolOf", () => {
  test("reads names and text from metadata, input or the payload", () => {
    assert.deepEqual(
      skillToolOf({
        type: "tool",
        name: "skill",
        state: { metadata: { name: "Demo" }, input: { id: "x" }, content: [{ type: "text", text: "body" }] },
      }),
      { name: "Demo", text: "body" },
    )
    assert.deepEqual(
      skillToolOf({ type: "tool", name: "skill", state: { input: { id: "demo" }, content: [] } }),
      { name: "demo", text: "" },
    )
    assert.deepEqual(
      skillToolOf({ type: "tool", name: "skill", state: { error: { message: "failed" } } }),
      { name: "skill", text: "failed" },
    )
  })

  test("ignores other tools and a state-less call", () => {
    assert.equal(skillToolOf({ type: "tool", name: "read", state: {} }), undefined)
    assert.equal(skillToolOf({ type: "text", name: "skill" }), undefined)
    assert.equal(skillToolOf({ type: "tool", name: "skill" }), undefined)
    assert.equal(skillToolOf(null), undefined)
  })
})

describe("questionWaitOf", () => {
  const message = (content: unknown[], patch: Record<string, unknown> = {}) =>
    ({
      id: "a1",
      type: "assistant",
      time: { created: at(0), completed: at(10) },
      content,
      ...patch,
    }) as unknown as SessionMessageInfo

  test("returns zero without an assistant message, an end time or completed question parts", () => {
    assert.equal(questionWaitOf({ type: "user" } as SessionMessageInfo), 0)
    assert.equal(questionWaitOf(message([], { time: { created: at(0) } })), 0)
    assert.equal(
      questionWaitOf(
        message([
          { type: "tool", name: "question", time: { created: at(1) }, state: {} },
          { type: "text", text: "x" },
        ]),
      ),
      0,
    )
  })

  test("measures completed question waits inside the step", () => {
    const wait = questionWaitOf(
      message([
        { type: "tool", name: "question", time: { created: at(8), ran: at(2), completed: at(3) }, state: {} },
        { type: "tool", name: "question", time: { created: at(1), ran: at(4), completed: at(20) }, state: {} },
        { type: "tool", name: "mcp.question", time: { created: at(5), ran: at(5), completed: at(5) }, state: {} },
        { type: "tool", name: "read", time: { created: at(6), ran: at(6), completed: at(7) }, state: {} },
        { type: "tool", name: "question", time: { created: at(0) }, state: {} },
        { type: "tool", name: "question", time: { created: at(9), completed: at(10) }, state: {} },
      ]),
    )
    assert.equal(wait, 60_000 + 360_000)
  })

  test("measures delegation waits and merges them with question waits", () => {
    const content = [
      { type: "tool", name: "question", time: { created: at(2), ran: at(2), completed: at(5) }, state: {} },
      { type: "tool", name: "task", time: { created: at(4), ran: at(4), completed: at(6) }, state: {} },
      { type: "tool", name: "read", time: { created: at(6), ran: at(6), completed: at(7) }, state: {} },
    ]
    assert.equal(delegationWaitOf(message(content)), 120_000)
    // 2..5 and 4..6 overlap; the active-time exclusion counts 2..6 once.
    assert.equal(excludedWaitOf(message(content)), 240_000)
  })

  test("unionMs merges overlapping and adjacent intervals", () => {
    assert.equal(unionMs([]), 0)
    assert.equal(
      unionMs([
        { start: 0, end: 5 },
        { start: 3, end: 8 },
        { start: 8, end: 10 },
        { start: 20, end: 22 },
        { start: 15, end: 16 },
      ]),
      13,
    )
    assert.equal(unionMs([{ start: 5, end: 5 }]), 0)
  })
})
