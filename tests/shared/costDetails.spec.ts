import assert from "node:assert/strict"
import { afterEach, describe, test, vi } from "vitest"
import {
  buildCost,
  buildPriceBook,
  buildPriceBookFromEntries,
  estimateCost,
  priceOf,
} from "../../src/shared/cost.ts"

const raw = {
  openai: {
    models: {
      "gpt-4o": { cost: { input: 2.5, output: 10, cache_write: 5 } },
      broken: { cost: { input: -1, output: 10 } },
      missing: { cost: { input: 1 } },
      "zero-cost": { cost: { input: 0, output: 0 } },
    },
  },
  "acme-coding-plan": {
    models: {
      "gpt-4o": { cost: { input: 0, output: 0 } },
    },
  },
  other: {
    models: {
      "gpt-4o": { cost: { input: 99, output: 99 } },
    },
  },
}

describe("buildPriceBook details", () => {
  test("skips invalid providers, models and rates", () => {
    const book = buildPriceBook({
      provider: "not an object",
      empty: {},
      nullish: { models: null },
      openai: {
        models: {
          good: { cost: { input: 1, output: 2 } },
          noCost: {},
          scalar: { cost: 5 },
          negative: { cost: { input: -1, output: 2 } },
          infinite: { cost: { input: 1, output: Number.POSITIVE_INFINITY } },
        },
      },
    })
    assert.ok(book)
    assert.equal(book.entries.length, 1)
    assert.equal(book.entries[0].model, "good")
  })

  test("keeps zero rates and reads an explicit cache-write price", () => {
    const book = buildPriceBook(raw)
    assert.ok(book)
    assert.deepEqual(priceOf(book, "openai", "gpt-4o"), { input: 2.5, output: 10, cacheRead: 2.5, cacheWrite: 5 })
    assert.deepEqual(priceOf(book, "openai", "zero-cost"), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
    assert.equal(priceOf(book, "openai", "broken"), undefined)
    assert.equal(priceOf(book, "openai", "missing"), undefined)
  })

  test("returns undefined for non-object input and an empty book for an empty catalogue", () => {
    assert.equal(buildPriceBook(null), undefined)
    assert.equal(buildPriceBook("nope"), undefined)
    const empty = buildPriceBook({})
    assert.ok(empty)
    assert.equal(empty.entries.length, 0)
  })

  test("is ambiguous when providers disagree and stable when they agree", () => {
    const conflicting = buildPriceBook({
      a: { models: { "shared-model": { cost: { input: 1, output: 2 } } } },
      b: { models: { "shared-model": { cost: { input: 3, output: 4 } } } },
    })
    assert.ok(conflicting)
    assert.equal(priceOf(conflicting, "unknown-gateway", "shared-model"), undefined)

    const agreeing = buildPriceBook({
      a: { models: { "same-model": { cost: { input: 1, output: 2 } } } },
      b: { models: { "same-model": { cost: { input: 1, output: 2 } } } },
    })
    assert.ok(agreeing)
    assert.deepEqual(priceOf(agreeing, "unknown-gateway", "same-model"), { input: 1, output: 2, cacheRead: 1, cacheWrite: 1 })
  })

  test("resolves deployment suffixes and prefix-less model names", () => {
    const book = buildPriceBook({
      openai: { models: { "gpt-4o": { cost: { input: 2, output: 4 } } } },
      vendor: { models: { "custom-llm": { cost: { input: 3, output: 6 } } } },
    })
    assert.ok(book)
    assert.equal(priceOf(book, "openai", "gpt-4o-v2")?.input, 2)
    assert.equal(priceOf(book, "openai", "gpt-4o@20240101")?.input, 2)
    assert.equal(priceOf(book, "openai", "gpt-4o-20240101")?.input, 2)
    assert.equal(priceOf(book, "openai", "GPT_4O")?.input, 2)
    assert.equal(priceOf(book, "elsewhere", "custom-llm")?.input, 3)
    assert.equal(priceOf(book, "elsewhere", "missing-model"), undefined)
    assert.equal(priceOf(book, "elsewhere", "gemini-unknown"), undefined)
    assert.equal(priceOf(undefined, "openai", "gpt-4o"), undefined)
  })

  test("falls back to a maker listing only when the canonical name matches", () => {
    const book = buildPriceBook({
      anthropic: {
        models: {
          "claude-sonnet": {
            cost: { input: 3, output: 15 },
            canonical_model_id: "anthropic/claude-sonnet-4-20250514",
          },
        },
      },
    })
    assert.ok(book)
    assert.equal(priceOf(book, "gateway", "claude-sonnet-4")?.input, 3)
    // The entry itself is named `claude-sonnet`, so that exact name still resolves.
    assert.equal(priceOf(book, "gateway", "claude-sonnet")?.input, 3)
    assert.equal(priceOf(book, "gateway", "claude-opus"), undefined)
  })

  test("does not lend a sibling variant's rate through the canonical fallback", () => {
    const book = buildPriceBook({
      openai: {
        models: {
          "gpt-5-mini": {
            cost: { input: 0.25, output: 2 },
            canonical_model_id: "openai/gpt-5-mini-2025",
          },
        },
      },
    })
    assert.ok(book)
    assert.equal(priceOf(book, "gateway", "gpt-5-mini")?.input, 0.25)
    assert.equal(priceOf(book, "gateway", "gpt-5"), undefined)
  })
})

describe("buildPriceBookFromEntries details", () => {
  test("keeps valid entries and skips plan providers and malformed rows", () => {
    const book = buildPriceBookFromEntries([
      { provider: "acme", model: "m1", rate: { input: 1, output: 2 } },
      { provider: "acme", model: "m1", rate: { input: 1, output: 2 } },
      { provider: "acme", model: "m2", rate: { input: 1, output: 2 }, canonical: "acme/m2-20250101" },
      { provider: "acme-token-plan", model: "m3", rate: { input: 1, output: 2 } },
      { provider: "", model: "m4", rate: { input: 1, output: 2 } },
      { provider: "acme", model: "", rate: { input: 1, output: 2 } },
      { provider: "acme", model: "m5", rate: { input: -1, output: 2 } },
      { provider: "acme", model: "m6", rate: { input: 1 } },
      null,
      "nope",
    ])
    assert.ok(book)
    assert.deepEqual(book.entries.map((entry) => entry.model), ["m1", "m1", "m2"])
    assert.deepEqual(priceOf(book, "acme", "m1"), { input: 1, output: 2, cacheRead: 1, cacheWrite: 1 })
    assert.equal(priceOf(book, "acme", "m3"), undefined)
  })

  test("fills cache prices from input and returns undefined without valid rows", () => {
    const book = buildPriceBookFromEntries([
      { provider: "p", model: "m", rate: { input: 2, output: 3, cacheRead: 1, cacheWrite: 4 } },
    ])
    assert.ok(book)
    assert.deepEqual(priceOf(book, "p", "m"), { input: 2, output: 3, cacheRead: 1, cacheWrite: 4 })
    assert.equal(buildPriceBookFromEntries([]), undefined)
  })
})

describe("buildCost details", () => {
  test("skips unrelated, unfinished and token-less messages", () => {
    const stats = buildCost([
      { type: "user" },
      { type: "compaction", status: "running", tokens: { input: 1, output: 1, cache: { read: 0, write: 0 } } },
      { type: "assistant", tokens: null, cost: 1 },
      { type: "assistant", tokens: undefined, cost: 1 },
    ])
    assert.deepEqual(stats, { total: 0, average: 0, steps: 0, estimated: 0, fallback: 0 })
  })

  test("uses provider cost when the model is missing or unpriced, and zero when cost is absent", () => {
    const stats = buildCost([
      { type: "assistant", model: null, tokens: { input: 1, output: 1, cache: { read: 0, write: 0 } }, cost: 2 },
      { type: "assistant", model: { providerID: "x", id: "y" }, tokens: { input: 1, output: 1, cache: { read: 0, write: 0 } } },
    ])
    assert.equal(stats.total, 2)
    assert.equal(stats.steps, 2)
    assert.equal(stats.fallback, 2)
    assert.equal(stats.estimated, 0)
    assert.equal(stats.average, 1)
  })
})

describe("loadPriceBook", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  test("loads once, caches the book and bumps the version", async () => {
    let calls = 0
    vi.stubGlobal("fetch", async () => {
      calls += 1
      return { ok: true, json: async () => ({ p: { models: { m: { cost: { input: 1, output: 2 } } } } }) }
    })
    vi.resetModules()
    const cost = await import("../../src/shared/cost.ts")
    const first = await cost.loadPriceBook()
    assert.ok(first)
    assert.equal(await cost.loadPriceBook(), first)
    assert.equal(calls, 1)
    assert.ok(cost.priceBookVersion() >= 1)
  })

  test("shares one pending request between concurrent callers", async () => {
    let calls = 0
    vi.stubGlobal("fetch", async () => {
      calls += 1
      return { ok: true, json: async () => ({ p: { models: { m: { cost: { input: 1, output: 2 } } } } }) }
    })
    vi.resetModules()
    const cost = await import("../../src/shared/cost.ts")
    const [left, right] = await Promise.all([cost.loadPriceBook(), cost.loadPriceBook()])
    assert.equal(left, right)
    assert.equal(calls, 1)
  })

  test("rejects a non-ok response and backs off", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 503 }))
    vi.resetModules()
    const cost = await import("../../src/shared/cost.ts")
    assert.equal(await cost.loadPriceBook(), undefined)
  })

  test("rejects a non-object catalogue", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => null }))
    vi.resetModules()
    const cost = await import("../../src/shared/cost.ts")
    assert.equal(await cost.loadPriceBook(), undefined)
  })

  test("keeps the cached book when a later refresh fails", async () => {
    let fail = false
    vi.stubGlobal("fetch", async () => {
      if (fail) throw new Error("offline")
      return { ok: true, json: async () => ({ p: { models: { m: { cost: { input: 1, output: 2 } } } } }) }
    })
    const realNow = Date.now
    let now = 1_000
    Date.now = () => now
    try {
      vi.resetModules()
      const cost = await import("../../src/shared/cost.ts")
      const book = await cost.loadPriceBook()
      assert.ok(book)
      fail = true
      now += 60 * 60 * 1000 + 1
      assert.equal(await cost.loadPriceBook(), book)
    } finally {
      Date.now = realNow
    }
  })

  test("skips the timeout signal when AbortSignal.timeout is unavailable", async () => {
    const timeout = AbortSignal.timeout
    let received: AbortSignal | undefined
    vi.stubGlobal("fetch", async (_url: string, init: { signal?: AbortSignal }) => {
      received = init.signal
      return { ok: true, json: async () => ({ p: { models: { m: { cost: { input: 1, output: 2 } } } } }) }
    })
    Object.defineProperty(AbortSignal, "timeout", { value: undefined, configurable: true })
    try {
      vi.resetModules()
      const cost = await import("../../src/shared/cost.ts")
      assert.ok(await cost.loadPriceBook())
      assert.equal(received, undefined)
    } finally {
      Object.defineProperty(AbortSignal, "timeout", { value: timeout, configurable: true })
    }
  })
})

describe("estimateCost with reasoning", () => {
  test("bills reasoning at the output rate", () => {
    const price = { input: 1, output: 10, cacheRead: 0.1, cacheWrite: 2 }
    assert.equal(
      estimateCost({ input: 1_000_000, output: 1_000_000, reasoning: 1_000_000, cache: { read: 1_000_000, write: 1_000_000 } }, price),
      0.1 + 1 + 2 + 20,
    )
  })
})
