import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { HEADERS_MANY_MAX } from "../../src/shared/rpc.ts"
import { HOST_CONTRACT } from "../../src/shared/host.ts"
import { makePlugin, makePluginContext, makeStorage } from "./helpers.ts"

interface Handlers {
  [name: string]: (input: unknown) => Promise<unknown>
}

async function setup(overrides: Parameters<typeof makePluginContext>[0] = makeStorage()) {
  const { ctx, handlers, hook } = makePluginContext(overrides)
  await makePlugin().setup(ctx as never)
  return { handlers: handlers() as Handlers, hook: hook(), storage: overrides }
}

describe("host handshake", () => {
  test("advertises its contract, storage schema, app and methods", async () => {
    const { handlers } = await setup()
    const info = (await handlers.hello({})) as {
      plugin: string
      contract: number
      storage: number
      app: string
      appVersion: string
      methods: readonly string[]
    }
    assert.equal(info.plugin, "opencode-context-insights")
    assert.equal(info.contract, HOST_CONTRACT)
    assert.equal(info.storage, 1)
    assert.equal(info.app, "opencode")
    assert.equal(info.appVersion, "2.2.6")
    assert.deepEqual(info.methods, ["hello", "prices", "snapshot", "header", "headers", "headersMany"])
  })
})

describe("headersMany", () => {
  test("dedupes ids and stops at the batch cap", async () => {
    const storage = makeStorage()
    for (let index = 0; index < 70; index++) {
      storage.map.set(`ver/ses_${String(index).padStart(2, "0")}/0000000000001000-s`, {
        at: 1000,
        systemHash: "s",
        toolsHash: "t",
        system: [],
        tools: [],
      })
    }
    const { handlers } = await setup(storage)
    const ids = ["ses_00", "", ...Array.from({ length: 70 }, (_, index) => `ses_${String(index).padStart(2, "0")}`)]
    const result = (await handlers.headersMany({ sessionIDs: ids })) as { headers: Record<string, unknown[]> }
    assert.equal(Object.keys(result.headers).length, HEADERS_MANY_MAX)
    assert.ok(result.headers.ses_00)
    assert.ok(result.headers.ses_63)
    assert.equal(result.headers.ses_64, undefined)
    assert.deepEqual(await handlers.headersMany({ sessionIDs: [] }), { headers: {} })
  })

  test("answers an empty list for a session whose scan fails", async () => {
    const storage = makeStorage()
    const failing = {
      ...storage,
      async scan(options: { prefix: string }) {
        if (options.prefix === "ver/ses_bad/") throw new Error("boom")
        return storage.scan(options)
      },
    }
    const { handlers } = await setup(failing)
    const result = (await handlers.headersMany({ sessionIDs: ["ses_bad", "ses_ok"] })) as {
      headers: Record<string, unknown[]>
    }
    assert.deepEqual(result.headers.ses_bad, [])
    assert.deepEqual(result.headers.ses_ok, [])
  })
})

describe("host RPC reads", () => {
  test("serves the recorded snapshot, header versions and one header", async () => {
    const { handlers, hook } = await setup()
    assert.ok(hook)
    const realNow = Date.now
    Date.now = () => 5_000
    try {
      await hook({
        sessionID: "ses_test",
        system: [{ text: "ignored", metadata: { experimental: { instructions: [{ key: "core", text: "be brief" }] } } }],
        tools: { read: { description: "read", input: { type: "object" } } },
        messages: [],
        agent: "build",
        model: { providerID: "p", id: "m" },
      })
    } finally {
      Date.now = realNow
    }

    const snapshot = (await handlers.snapshot({ sessionID: "ses_test" })) as {
      snapshot: { sessionID: string; agent: string; at: number; model: { providerID: string; id: string } } | null
    }
    assert.equal(snapshot.snapshot?.sessionID, "ses_test")
    assert.equal(snapshot.snapshot?.agent, "build")
    assert.equal(snapshot.snapshot?.at, 5_000)
    assert.equal(snapshot.snapshot?.model.providerID, "p")
    assert.equal(snapshot.snapshot?.model.id, "m")
    assert.deepEqual(await handlers.snapshot({ sessionID: "ses_missing" }), { snapshot: null })

    const versions = (await handlers.headers({ sessionID: "ses_test" })) as { headers: Array<{ at: number }> }
    assert.deepEqual(versions.headers.map((version) => version.at), [5_000])

    const detail = (await handlers.header({ sessionID: "ses_test", at: 5_000 })) as {
      header: { system: Array<{ text: string }> } | null
    }
    assert.equal(detail.header?.system[0]?.text, "be brief")
    assert.deepEqual(await handlers.header({ sessionID: "ses_test", at: 0 }), { header: null })
  })

  test("does not fail the request when recording throws", async () => {
    const storage = makeStorage()
    const failing = {
      ...storage,
      async get() {
        throw new Error("storage down")
      },
      async scan() {
        throw new Error("storage down")
      },
    }
    const { handlers, hook } = await setup(failing)
    assert.ok(hook)
    await hook({
      sessionID: "ses_test",
      system: [],
      tools: {},
      messages: [],
      agent: "build",
      model: { providerID: "p", id: "m" },
    })
    const snapshot = (await handlers.snapshot({ sessionID: "ses_test" })) as { snapshot: unknown }
    assert.ok(snapshot.snapshot)
  })

  test("serves the price catalogue and its readiness", async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error("offline")
    }) as typeof fetch
    try {
      const { handlers } = await setup()
      const prices = (await handlers.prices({})) as { entries: unknown[]; ready: boolean; version: number }
      assert.deepEqual(prices.entries, [])
      assert.equal(prices.ready, false)
      assert.equal(typeof prices.version, "number")
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
