import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { makePlugin, makePluginContext, makeStorage } from "./helpers.ts"

function versionCount(store: Map<string, unknown>): number {
  return [...store.keys()].filter((key) => key.startsWith("ver/ses_test/")).length
}

describe("context recording", () => {
  test("dedupes unchanged headers and serves the matching version", async () => {
    const storage = makeStorage()
    const { ctx, handlers, hook } = makePluginContext(storage)

    await makePlugin().setup(ctx as never)
    const emit = hook()
    assert.ok(emit)

    const realNow = Date.now
    let now = 1000
    Date.now = () => now
    try {
      const event = (text: string) => ({
        sessionID: "ses_test",
        system: [{ text: "ignored", metadata: { experimental: { instructions: [{ key: "core", text }] } } }],
        tools: { read: { description: "read a file", input: { type: "object" } } },
        messages: [],
        agent: "build",
        model: { providerID: "p", id: "m" },
      })

      await emit(event("be brief"))
      await emit(event("be brief"))
      assert.equal(versionCount(storage.map), 1)

      now = 5000
      await emit(event("be very brief"))
      assert.equal(versionCount(storage.map), 2)
    } finally {
      Date.now = realNow
    }

    const header = handlers().header
    assert.ok(header)
    const headers = handlers().headers
    assert.ok(headers)

    const all = (await headers({ sessionID: "ses_test" })) as { headers: unknown[] }
    assert.equal(all.headers.length, 2)

    const early = (await header({ sessionID: "ses_test", at: 1000 })) as {
      header: { system: Array<{ text: string }> } | null
    }
    assert.equal(early.header?.system[0].text, "be brief")

    const late = (await header({ sessionID: "ses_test", at: 5000 })) as {
      header: { system: Array<{ text: string }> } | null
    }
    assert.equal(late.header?.system[0].text, "be very brief")

    const before = (await header({ sessionID: "ses_test", at: -4000 })) as { header: null }
    assert.equal(before.header, null)
  })
})
