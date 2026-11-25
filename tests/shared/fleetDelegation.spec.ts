import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { delegationsOf } from "../../src/shared/fleet.ts"
import { child, toolMessage } from "./fleetFixtures.ts"

describe("delegationsOf", () => {
  test("takes the child session id from the subagent result", () => {
    const rows = delegationsOf(
      "ses_parent",
      [
        toolMessage(
          "t1",
          "subagent",
          {
            status: "completed",
            input: { agent: "explore", description: "scan repo", prompt: "find all files" },
            content: [{ type: "text", text: "The subagent is working in the background (sessionID: ses_child)." }],
            metadata: { sessionID: "ses_child" },
          },
          1,
        ),
      ],
      [child],
    )

    assert.equal(rows.length, 1)
    assert.equal(rows[0].parentID, "ses_parent")
    assert.equal(rows[0].childID, "ses_child")
    assert.equal(rows[0].childTitle, "scan repo")
    assert.equal(rows[0].exact, true)
    assert.equal(rows[0].description, "scan repo")
    assert.equal(rows[0].agent, "explore")
    assert.equal(rows[0].prompt, "find all files")
    assert.equal(rows[0].status, "completed")
    assert.ok(rows[0].result?.includes("sessionID: ses_child"))
  })

  test("falls back to the child title and ignores other tools", () => {
    const rows = delegationsOf(
      "ses_parent",
      [
        toolMessage("t1", "read", { status: "completed", input: { path: "a.ts" }, content: [] }, 1),
        toolMessage(
          "t2",
          "task",
          {
            status: "running",
            input: { subagent_type: "general", description: "scan repo", prompt: "find all files" },
            metadata: {},
          },
          2,
        ),
      ],
      [child],
    )

    assert.equal(rows.length, 1)
    assert.equal(rows[0].childID, "ses_child")
    assert.equal(rows[0].exact, false)
    assert.equal(rows[0].agent, "general")
    assert.equal(rows[0].status, "running")
  })

  test("reads follow-up session ids and leaves unmatched calls unlinked", () => {
    const rows = delegationsOf(
      "ses_parent",
      [
        toolMessage(
          "t1",
          "subagent",
          {
            status: "completed",
            input: { sessionID: "ses_child", prompt: "keep going" },
            content: [{ type: "text", text: "done" }],
          },
          3,
        ),
        toolMessage(
          "t2",
          "subagent",
          {
            status: "completed",
            input: { description: "missing child", prompt: "nothing matches" },
            content: [{ type: "text", text: "done" }],
          },
          9,
        ),
      ],
      [child],
    )

    assert.equal(rows.length, 2)
    assert.equal(rows[0].childID, "ses_child")
    assert.equal(rows[0].exact, true)
    assert.equal(rows[1].childID, undefined)
    assert.equal(rows[1].exact, false)
    assert.equal(rows[1].description, "missing child")
  })
})
