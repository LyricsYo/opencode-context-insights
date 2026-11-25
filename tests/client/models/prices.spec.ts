import assert from "node:assert/strict"
import { afterAll, beforeEach, describe, test, vi } from "vitest"
import { buildPriceBook, priceOf } from "../../../src/shared/cost.ts"

type PricesModule = typeof import("../../../src/client/models/prices.ts")

const raw = {
  deepseek: {
    models: {
      "deepseek-v4-flash": {
        cost: { input: 0.15, output: 0.6, cache_read: 0.003 },
        canonical_model_id: "deepseek/deepseek-v4.1-flash-1017",
      },
    },
  },
  openrouter: {
    models: {
      "deepseek/deepseek-v4.1-flash": {
        cost: { input: 0.3, output: 1.2, cache_read: 0.006 },
      },
    },
  },
}

const entries = () => JSON.parse(JSON.stringify(buildPriceBook(raw)!.entries))
const originalFetch = globalThis.fetch
const start = Date.parse("2026-11-16T08:41:00Z")

/** The module caches its book, its in-flight promise and the last failure in module scope. */
async function fresh(): Promise<PricesModule> {
  vi.resetModules()
  return import("../../../src/client/models/prices.ts")
}

function stubFetch(handler: () => Promise<unknown>) {
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    return { ok: true, json: handler } as Response
  }) as typeof fetch
  return () => calls
}

async function reject(): Promise<unknown> {
  throw new Error("offline")
}

describe("loadHostPriceBook", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(start)
  })

  afterAll(() => {
    vi.useRealTimers()
    globalThis.fetch = originalFetch
  })

  test("rebuilds a price book from the host payload and caches it", async () => {
    const { loadHostPriceBook } = await fresh()
    const rebuilt = await loadHostPriceBook(async () => ({ entries: entries() }))
    assert.ok(rebuilt)
    assert.deepEqual(
      priceOf(rebuilt, "litellm-2", "deepseek-v4.1-flash"),
      priceOf(buildPriceBook(raw), "litellm-2", "deepseek-v4.1-flash"),
    )

    // The cache answers without touching the host or the network.
    const cached = await loadHostPriceBook(async () => {
      throw new Error("must not run")
    })
    assert.equal(cached, rebuilt)
  })

  test("falls back to the renderer fetch when the host reply has no entry list", async () => {
    const { loadHostPriceBook } = await fresh()
    const fetchCalls = stubFetch(async () => raw)
    const rebuilt = await loadHostPriceBook(async () => ({}))
    assert.ok(rebuilt)
    assert.equal(fetchCalls(), 1)
    assert.ok(priceOf(rebuilt, "deepseek", "deepseek-v4-flash"))

    // A null reply is not an object with entries either.
    vi.setSystemTime(start + 61 * 60 * 1000)
    const again = await loadHostPriceBook(async () => null)
    assert.ok(again)
    assert.equal(fetchCalls(), 2)
  })

  test("records a miss and backs off for thirty seconds", async () => {
    const { loadHostPriceBook } = await fresh()
    stubFetch(reject)
    const hostCalls: number[] = []
    const request = async () => {
      hostCalls.push(Date.now())
      return reject()
    }
    assert.equal(await loadHostPriceBook(request), undefined)
    assert.equal(hostCalls.length, 1)

    vi.setSystemTime(start + 10 * 1000)
    assert.equal(await loadHostPriceBook(request), undefined)
    assert.equal(hostCalls.length, 1)
  })

  test("asks the host again once the backoff expires", async () => {
    const { loadHostPriceBook } = await fresh()
    stubFetch(reject)
    assert.equal(await loadHostPriceBook(reject), undefined)

    vi.setSystemTime(start + 31 * 1000)
    const rebuilt = await loadHostPriceBook(async () => ({ entries: entries() }))
    assert.ok(rebuilt)
    assert.ok(priceOf(rebuilt, "litellm-2", "deepseek-v4.1-flash"))
  })

  test("treats an empty host catalogue as an answer", async () => {
    const { loadHostPriceBook } = await fresh()
    const fetchCalls = stubFetch(async () => raw)
    assert.equal(await loadHostPriceBook(async () => ({ entries: [] })), undefined)
    assert.equal(fetchCalls(), 0)
  })

  test("shares one in-flight request between callers", async () => {
    const { loadHostPriceBook } = await fresh()
    let release: (value: unknown) => void = () => {}
    const deferred = new Promise((resolve) => {
      release = resolve
    })
    let hostCalls = 0
    const first = loadHostPriceBook(async () => {
      hostCalls += 1
      return deferred
    })
    const second = loadHostPriceBook(async () => {
      throw new Error("must join the pending request")
    })
    assert.equal(first, second)
    release({ entries: entries() })
    const [left, right] = await Promise.all([first, second])
    assert.ok(left)
    assert.equal(left, right)
    assert.equal(hostCalls, 1)
  })

  test("re-reads the host after the one-hour cache expires", async () => {
    const { loadHostPriceBook } = await fresh()
    let hostCalls = 0
    const request = async () => {
      hostCalls += 1
      return { entries: entries() }
    }
    assert.ok(await loadHostPriceBook(request))
    assert.equal(hostCalls, 1)

    vi.setSystemTime(start + 61 * 60 * 1000)
    assert.ok(await loadHostPriceBook(request))
    assert.equal(hostCalls, 2)
  })
})
