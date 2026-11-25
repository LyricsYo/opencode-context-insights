import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { SessionMessageInfo } from "@opencode/client"
import { buildSurface } from "../../src/shared/surface.ts"
import { estimateTokens } from "../../src/shared/estimate.ts"
import { at } from "./fixtures.ts"

describe("buildSurface", () => {
  test("starts after the last compaction and stops at the selected step", () => {
    const entries = buildSurface(
      [
        { id: "u1", type: "user", text: "old", time: { created: at(1) } },
        { id: "c1", type: "compaction", status: "completed", reason: "auto", summary: "summary", time: { created: at(2) } },
        { id: "u2", type: "user", text: "new", time: { created: at(3) } },
        {
          id: "a1",
          type: "assistant",
          agent: "build",
          model: { id: "m", providerID: "p" },
          time: { created: at(4) },
          content: [
            { type: "text", text: "reply" },
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
          ],
        },
      ] as SessionMessageInfo[],
      "a1",
    )

    assert.deepEqual(entries.map((entry) => entry.kind), ["compaction", "user", "reply", "tool"])
    // Turn numbers keep counting across the compaction instead of restarting at the window start.
    assert.equal(entries[1].turn, 2)
    assert.equal(entries[1].step, 1)
    assert.equal(entries[2].turn, 2)
    assert.equal(entries[2].step, 1)
    assert.equal(entries[2].text, "reply")
    assert.equal(entries[3].input, '{\n "path": "a.ts"\n}')
    assert.equal(entries[3].output, "body")
    assert.equal(entries[3].truncated, true)
  })

  test("classifies injected and skill text like compose", () => {
    const entries = buildSurface([
      { id: "u1", type: "user", text: '<context source="plugin">ctx</context>', time: { created: at(1) } },
      { id: "u2", type: "user", text: '<skill_content name="demo">body</skill_content>', time: { created: at(2) } },
      { id: "u3", type: "user", text: "hello", time: { created: at(3) } },
      { id: "u4", type: "user", text: 'notes: tools return <skill_content name="x"> blocks', time: { created: at(4) } },
      { id: "u5", type: "user", text: "<conversation-checkpoint>summary</conversation-checkpoint>", time: { created: at(5) } },
    ] as SessionMessageInfo[])

    assert.deepEqual(entries.map((entry) => entry.kind), ["synthetic", "skill", "user", "user", "synthetic"])
    assert.equal(entries[4].name, "Conversation checkpoint")
    assert.equal(entries[0].name, "Injected context")
    assert.equal(entries[1].name, "demo")
    assert.equal(entries[2].turn, 3)
    assert.equal(entries[2].step, 1)
  })

  test("carries user and tool file attachments", () => {
    const entries = buildSurface([
      {
        id: "u1",
        type: "user",
        text: "look",
        files: [{ data: "aGk=", mime: "image/png", source: "clipboard", name: "shot.png" }],
        time: { created: at(1) },
      },
      {
        id: "a1",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(2) },
        content: [
          {
            type: "tool",
            id: "t1",
            name: "read",
            time: { created: at(2) },
            state: {
              status: "completed",
              input: { path: "x.pdf" },
              metadata: {},
              content: [
                { type: "text", text: "ok" },
                { type: "file", uri: "file:///x.pdf", mime: "application/pdf", name: "x.pdf" },
              ],
            },
          },
        ],
      },
    ] as SessionMessageInfo[])

    assert.equal(entries[0].files?.[0].name, "shot.png")
    assert.equal(entries[0].files?.[0].data, "aGk=")
    assert.ok(entries[0].tokens > estimateTokens("look"))
    const tool = entries.find((entry) => entry.kind === "tool")
    assert.equal(tool?.files?.[0].name, "x.pdf")
    assert.equal(tool?.files?.[0].mime, "application/pdf")
  })
})
