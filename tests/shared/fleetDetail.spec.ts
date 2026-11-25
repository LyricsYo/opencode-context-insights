import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { SessionMessageInfo } from "@opencode/client"
import { fleetDetailOf, fleetHeadOf, fleetRowsOfMessage } from "../../src/shared/fleet.ts"
import { stepComposition } from "../../src/shared/tokens.ts"
import { at } from "./fleetFixtures.ts"

describe("fleetDetailOf", () => {
  test("reads prompt, reply, transcript and context mix", () => {
    const messages = [
      { id: "u1", type: "user", text: "inspect the repo", time: { created: at(1) } },
      {
        id: "a1",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(2), completed: at(2) + 1000 },
        content: [{ type: "text", text: "the answer" }],
        tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
        cost: 0.01,
      },
    ] as unknown as SessionMessageInfo[]
    const versions = [
      { at: 0, systemHash: "s", toolsHash: "t", system: [{ key: "core", tokens: 30 }], tools: [{ name: "read", tokens: 20 }] },
    ]

    const detail = fleetDetailOf(messages, versions)
    assert.equal(detail.prompt?.text, "inspect the repo")
    assert.equal(detail.reply?.text, "the answer")
    assert.equal(detail.steps, 1)
    assert.equal(detail.cost, 0.01)
    assert.equal(detail.rows.length, 2)
    assert.equal(detail.composition?.byCategory.system, 30)
    assert.equal(detail.composition?.byCategory.tools, 20)
    assert.ok((detail.composition?.byCategory.user ?? 0) > 0)
    assert.equal(detail.composition?.headerMissing, false)
    // The streaming-tail patch must produce exactly the rows the full transcript holds for that message.
    assert.deepEqual(
      fleetRowsOfMessage(messages[1]),
      detail.rows.filter((row) => row.messageID === "a1"),
    )
  })

  test("keeps history before a compaction and system injections", () => {
    const assistant = (id: string, text: string, minute: number) =>
      ({
        id,
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(minute), completed: at(minute) + 1000 },
        content: [{ type: "text", text }],
      }) as unknown as SessionMessageInfo
    const messages = [
      { id: "u1", type: "user", text: "old prompt", time: { created: at(1) } },
      assistant("a1", "old reply", 2),
      { id: "c1", type: "compaction", status: "completed", reason: "auto", summary: "summary", time: { created: at(3) } },
      { id: "u2", type: "user", text: "new prompt", time: { created: at(4) } },
      { id: "s1", type: "system", text: "system note", description: "note", time: { created: at(5) } },
      assistant("a2", "new reply", 6),
    ] as SessionMessageInfo[]

    const detail = fleetDetailOf(messages, undefined)
    assert.deepEqual(
      detail.rows.map((row) => [row.kind, row.text]),
      [
        ["user", "old prompt"],
        ["reply", "old reply"],
        ["user", "new prompt"],
        ["system", "system note"],
        ["reply", "new reply"],
      ],
    )
  })

  test("marks headers pending while the versions load", () => {
    const detail = fleetDetailOf(
      [
        { id: "u1", type: "user", text: "hello", time: { created: at(1) } },
      ] as unknown as SessionMessageInfo[],
      undefined,
    )
    assert.equal(detail.prompt?.text, "hello")
    assert.equal(detail.composition, undefined)
    assert.equal(detail.steps, 0)
  })
})

describe("fleetHeadOf", () => {
  test("composition matches the context composition", () => {
    const messages = [
      { id: "u1", type: "user", text: "x".repeat(40), time: { created: at(1) } },
      {
        id: "a1",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(2), completed: at(2) + 1000 },
        content: [
          { type: "text", text: "the answer" },
          {
            type: "tool",
            id: "t1",
            name: "read",
            time: { created: at(2), ran: at(2), completed: at(2) + 100 },
            state: { status: "completed", input: { path: "src/a.ts" }, content: [] },
          },
        ],
        tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
        cost: 0.01,
      },
    ] as unknown as SessionMessageInfo[]
    const versions = [
      { at: 0, systemHash: "s", toolsHash: "t", system: [{ key: "core", tokens: 30 }], tools: [{ name: "read", tokens: 20 }] },
    ]

    const head = fleetHeadOf(messages, versions)
    const expected = stepComposition(messages, "a1", { summary: versions[0], system: [], tools: [] })
    assert.equal(head.steps, 1)
    assert.equal(head.composition?.total, expected.total)
    assert.deepEqual(head.composition?.byCategory, expected.byCategory)
    assert.deepEqual(head.composition?.items, [])
  })
})

describe("fleetRowsOfMessage", () => {
  test("refreshes when a message changes in place", () => {
    const message = {
      id: "u1",
      type: "user",
      text: "before",
      time: { created: at(1) },
    } as unknown as SessionMessageInfo
    assert.deepEqual(fleetRowsOfMessage(message).map((row) => row.text), ["before"])
    ;(message as unknown as { text: string }).text = "after the change"
    assert.deepEqual(fleetRowsOfMessage(message).map((row) => row.text), ["after the change"])

    const assistant = {
      id: "a1",
      type: "assistant",
      agent: "build",
      model: { id: "m", providerID: "p" },
      time: { created: at(2), completed: at(2) + 1000 },
      content: [{ type: "text", text: "one" }],
    } as unknown as SessionMessageInfo
    assert.deepEqual(fleetRowsOfMessage(assistant).map((row) => row.text), ["one"])
    ;(assistant as unknown as { content: Array<{ text: string }> }).content[0].text = "one two three"
    assert.deepEqual(fleetRowsOfMessage(assistant).map((row) => row.text), ["one two three"])
  })
})
