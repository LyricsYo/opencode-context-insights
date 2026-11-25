import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { createHeaderStore } from "../../src/host/headers/store.ts"
import { makeStorage } from "./helpers.ts"

const system = (text: string) => [{ text: "ignored", metadata: { experimental: { instructions: [{ key: "core", text }] } } }]
const tools = { read: { description: "read a file", input: { type: "object" } } }
const event = (text: string, sessionID = "ses_test") => ({ sessionID, system: system(text), tools })

function withClock<T>(run: (advance: (ms: number) => void) => Promise<T>): Promise<T> {
  const realNow = Date.now
  let now = 1_000
  Date.now = () => now
  return run((ms) => {
    now += ms
  }).finally(() => {
    Date.now = realNow
  })
}

describe("createHeaderStore cache bounds", () => {
  test("evicts the oldest session list beyond the limit", async () => {
    const storage = makeStorage()
    const store = createHeaderStore(storage, { maxSessions: 2 })
    await withClock(async () => {
      await store.record(event("one", "ses_a"))
      await store.record(event("one", "ses_b"))
      await store.record(event("one", "ses_c"))
    })
    // ses_a fell out of memory but still loads from storage.
    assert.equal((await store.versionsOf("ses_a")).length, 1)
    assert.equal((await store.versionsOf("ses_a")).length, 1)
  })

  test("bounds the remembered blob keys and re-reads an evicted blob", async () => {
    const storage = makeStorage()
    const store = createHeaderStore(storage, { maxKnownBlobs: 1 })
    await withClock(async (advance) => {
      await store.record(event("one"))
      advance(1_000)
      await store.record(event("two"))
      advance(1_000)
      await store.record(event("three"))
      advance(1_000)
      // The sys/tools keys for "one" were evicted, so this call re-reads storage and finds them.
      await store.record(event("one", "ses_other"))
    })
    assert.equal((await store.versionsOf("ses_test")).length, 3)
    assert.equal((await store.versionsOf("ses_other")).length, 1)
    const detail = await store.headerOf("ses_test", 1_000)
    assert.equal(detail?.system[0]?.text, "one")
    assert.equal((await store.headerOf("ses_test", 3_000))?.system[0]?.text, "three")
    // Every blob was written once: the repeat found the stored copy instead of overwriting it.
    assert.equal([...storage.map.keys()].filter((key) => key.startsWith("sys/")).length, 3)
  })
})

describe("createHeaderStore scans", () => {
  test("ignores values that are not header summaries", async () => {
    const storage = makeStorage()
    storage.map.set("ver/ses_test/0000000000001000-a", { v: 1, value: { at: "x" } })
    storage.map.set("ver/ses_test/0000000000002000-b", { v: 1, value: null })
    const store = createHeaderStore(storage)
    assert.deepEqual(await store.versionsOf("ses_test"), [])
  })

  test("walks every storage page", async () => {
    const storage = makeStorage()
    const writer = createHeaderStore(storage)
    await withClock(async (advance) => {
      for (let index = 0; index < 3; index++) {
        await writer.record(event(`prompt ${index}`))
        advance(1_000)
      }
    })
    // A fresh store has no list in memory, so the page walk starts from storage.
    const store = createHeaderStore(storage, { pageSize: 1 })
    const versions = await store.versionsOf("ses_test")
    assert.deepEqual(
      versions.map((version) => version.at),
      [1_000, 2_000, 3_000],
    )
  })

  test("clears the in-memory caches", async () => {
    const storage = makeStorage()
    const store = createHeaderStore(storage)
    await withClock(async () => {
      await store.record(event("one"))
    })
    store.clear()
    assert.equal((await store.versionsOf("ses_test")).length, 1)
  })
})

describe("createHeaderStore headerOf", () => {
  test("returns the stored blobs and defaults missing ones to empty lists", async () => {
    const storage = makeStorage()
    const store = createHeaderStore(storage)
    await withClock(async () => {
      await store.record(event("one"))
    })
    const detail = await store.headerOf("ses_test", 1_000)
    assert.equal(detail?.summary.systemHash.length, 16)
    assert.equal(detail?.tools[0]?.name, "read")

    const key = [...storage.map.keys()].find((entry) => entry.startsWith("sys/"))!
    storage.map.delete(key)
    const legacy = await store.headerOf("ses_test", 1_000)
    assert.deepEqual(legacy?.system, [])

    const toolsKey = [...storage.map.keys()].find((entry) => entry.startsWith("tools/"))!
    storage.map.delete(toolsKey)
    const noTools = await store.headerOf("ses_test", 1_000)
    assert.deepEqual(noTools?.tools, [])

    assert.equal(await store.headerOf("ses_test", 0), null)
  })

  test("leaves a corrupted blob as an empty list", async () => {
    const storage = makeStorage()
    const store = createHeaderStore(storage)
    await withClock(async () => {
      await store.record(event("one"))
    })
    const key = [...storage.map.keys()].find((entry) => entry.startsWith("sys/"))!
    storage.map.set(key, { v: 99, value: "nope" })
    store.clear()
    const detail = await store.headerOf("ses_test", 1_000)
    assert.deepEqual(detail?.system, [])
  })
})
