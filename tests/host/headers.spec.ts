import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { createHeaderStore } from "../../src/host/headers/store.ts"
import { makeStorage } from "./helpers.ts"

const event = (text: string) => ({
  sessionID: "ses_test",
  system: [{ text: "ignored", metadata: { experimental: { instructions: [{ key: "core", text }] } } }],
  tools: { read: { description: "read a file", input: { type: "object" } } },
})

describe("createHeaderStore", () => {
  test("header versions page past the old 500-entry cap", async () => {
    const storage = makeStorage()
    const store = createHeaderStore(storage, { pageSize: 2 })
    const realNow = Date.now
    let now = 1000
    Date.now = () => now
    try {
      for (let index = 0; index < 5; index++) {
        now = 1000 + index * 1000
        await store.record(event(`prompt ${index}`))
      }
    } finally {
      Date.now = realNow
    }

    const versions = await store.versionsOf("ses_test")
    assert.equal(versions.length, 5)
    assert.deepEqual(
      versions.map((version) => version.at),
      [1000, 2000, 3000, 4000, 5000],
    )
  })

  test("new header values carry a schema version", async () => {
    const storage = makeStorage()
    const store = createHeaderStore(storage)
    await store.record(event("be brief"))
    const key = [...storage.map.keys()].find((entry) => entry.startsWith("ver/ses_test/"))
    assert.ok(key)
    const raw = storage.map.get(key) as { v?: number; value?: { systemHash?: string } }
    assert.equal(raw.v, 1)
    assert.equal(typeof raw.value?.systemHash, "string")
  })

  test("legacy bare values still load", async () => {
    const storage = makeStorage()
    const summary = { at: 1000, systemHash: "legacy", toolsHash: "legacy", system: [], tools: [] }
    storage.map.set("sys/legacy", [{ key: "core", text: "legacy prompt" }])
    storage.map.set("tools/legacy", [{ name: "read", description: "", schema: "{}" }])
    storage.map.set("ver/ses_legacy/0000000000001000-legacy", summary)

    const store = createHeaderStore(storage)
    const versions = await store.versionsOf("ses_legacy")
    assert.equal(versions.length, 1)
    const detail = await store.headerOf("ses_legacy", 1000)
    assert.equal(detail?.system[0]?.text, "legacy prompt")
    assert.equal(detail?.tools[0]?.name, "read")
  })
})
