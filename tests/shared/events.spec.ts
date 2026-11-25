import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { SessionMessageInfo } from "@opencode/client"
import { buildEvents } from "../../src/shared/events.ts"
import { buildTokenSteps, buildTools } from "../../src/shared/sessionIndex.ts"
import { buildBrowserGroups } from "../../src/shared/browser.ts"
import { assistant, at } from "./fixtures.ts"

describe("buildEvents", () => {
  test("carries turn spans, kinds and compaction deltas", () => {
    const messages = [
      { id: "u1", type: "user", text: "hello", time: { created: at(1) } },
      { id: "s1", type: "system", text: "AGENTS.md rules", description: "AGENTS.md", time: { created: at(2) } },
      assistant(100, 10, { id: "a1", content: [{ type: "text", text: "first" }] }),
      { id: "c1", type: "compaction", status: "completed", reason: "auto", summary: "summarized so far", time: { created: at(4) } },
      assistant(40, 5, { id: "a2", content: [{ type: "text", text: "second" }] }),
      {
        id: "m1",
        type: "model-switched",
        model: { id: "m2", providerID: "p" },
        previous: { id: "m1", providerID: "p" },
        time: { created: at(6) },
      },
      { id: "i1", type: "idle", outcome: "failed", error: { message: "boom" }, time: { created: at(7) } },
    ] as SessionMessageInfo[]

    const rows = buildEvents(messages)
    assert.deepEqual(
      rows.map((row) => row.kind),
      ["error", "model", "compaction", "inject"],
    )

    const inject = rows.find((row) => row.kind === "inject")!
    assert.equal(inject.name, "AGENTS.md")
    assert.equal(inject.turn, 1)
    assert.equal(inject.step, 1)
    assert.equal(inject.stepID, "a1")
    assert.ok((inject.tokens ?? 0) > 0)

    const compaction = rows.find((row) => row.kind === "compaction")!
    assert.equal(compaction.reason, "auto")
    assert.equal(compaction.status, "completed")
    assert.equal(compaction.fromTurn, 1)
    assert.equal(compaction.fromStep, 1)
    assert.equal(compaction.turn, 1)
    assert.equal(compaction.step, 2)
    assert.equal(compaction.stepID, "a2")
    assert.equal(compaction.count, 3)
    assert.equal(compaction.grossTokens, 100)
    assert.ok((compaction.tokens ?? 0) >= 0)

    const model = rows.find((row) => row.kind === "model")!
    assert.equal(model.from, "m1")
    assert.equal(model.to, "m2")
    assert.equal(model.stepID, undefined)
    assert.equal(model.turn, undefined)

    const error = rows.find((row) => row.kind === "error")!
    assert.equal(error.status, "failed")
    assert.equal(error.error, "boom")
    assert.equal(error.failed, true)
  })

  test("turns skill tool calls into skill injections", () => {
    const messages = [
      { id: "u1", type: "user", text: "use skill", time: { created: at(1) } },
      assistant(100, 10, {
        id: "a1",
        content: [
          {
            type: "tool",
            id: "call_skill",
            name: "skill",
            time: { created: at(2) },
            state: {
              status: "completed",
              input: { id: "opencode" },
              metadata: { name: "OpenCode" },
              content: [{ type: "text", text: '<skill_content name="OpenCode">guides</skill_content>' }],
            },
          },
        ],
      }),
      assistant(120, 5, { id: "a2", content: [{ type: "text", text: "done" }] }),
    ] as SessionMessageInfo[]

    const skill = buildEvents(messages).find((event) => event.kind === "skill")!
    assert.equal(skill.name, "OpenCode")
    assert.equal(skill.turn, 1)
    assert.equal(skill.step, 2)
    assert.equal(skill.stepID, "a2")
    assert.ok((skill.tokens ?? 0) > 0)

    assert.equal(buildTools(messages).some((tool) => tool.name === "skill"), false)
    const groups = buildBrowserGroups(messages, null, "a2", false)
    const skills = groups.find((group) => group.key === "skills")!
    assert.equal(skills.rows.length, 1)
    assert.equal(skills.rows[0].name, "OpenCode")
    assert.ok((buildTokenSteps(messages, [])[1].byCategory.skills ?? 0) > 0)
  })
})
