import assert from "node:assert/strict"
import { test } from "vitest"
import { buildCost, buildPriceBook, buildPriceBookFromEntries, estimateCost, priceOf } from "../../src/shared/cost.ts"

const raw = {
  deepseek: {
    models: {
      "deepseek-v4-flash": {
        cost: { input: 0.15, output: 0.6, cache_read: 0.003 },
        canonical_model_id: "deepseek/deepseek-v4.1-flash-1017",
      },
      "deepseek-v4-pro": {
        cost: { input: 0.66, output: 1.98, cache_read: 0.022 },
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
  "acme-coding-plan": {
    models: {
      "deepseek-v4.1-flash": { cost: { input: 0, output: 0 } },
    },
  },
}

test("a provider branch keeps its own rate", () => {
  const book = buildPriceBook(raw)
  assert.ok(book)
  assert.equal(book.byProvider.has("acme-coding-plan"), false)
  assert.deepEqual(priceOf(book, "openrouter", "deepseek/deepseek-v4.1-flash"), {
    input: 0.3,
    output: 1.2,
    cacheRead: 0.006,
    cacheWrite: 0.3,
  })
})

test("an unknown gateway falls back to the maker's canonical listing", () => {
  const book = buildPriceBook(raw)
  assert.ok(book)
  assert.deepEqual(priceOf(book, "litellm-2", "deepseek-v4.1-flash"), {
    input: 0.15,
    output: 0.6,
    cacheRead: 0.003,
    cacheWrite: 0.15,
  })
  assert.equal(priceOf(book, "litellm-2", "acme-private-2099"), undefined)
})

test("cost uses uncached input, cache reads/writes and output", () => {
  const book = buildPriceBook(raw)
  assert.ok(book)
  const price = priceOf(book, "litellm-2", "deepseek-v4.1-flash")
  assert.ok(price)
  const cost = estimateCost(
    { input: 728, output: 195, cache: { read: 250_880, write: 0 } },
    price,
  )
  assert.ok(Math.abs(cost - 0.00097884) < 1e-12)
  const reasoned = estimateCost(
    { input: 1_255, output: 301, reasoning: 172, cache: { read: 380_544, write: 0 } },
    price,
  )
  assert.ok(Math.abs(reasoned - 0.001613682) < 1e-12)
})

test("buildCost estimates priced steps and falls back to provider cost", () => {
  const book = buildPriceBook(raw)
  assert.ok(book)
  const messages = [
    {
      type: "assistant",
      model: { providerID: "litellm-2", id: "deepseek-v4.1-flash" },
      tokens: { input: 728, output: 195, cache: { read: 250_880, write: 0 } },
      cost: 9,
    },
    {
      type: "compaction",
      status: "completed",
      model: { providerID: "litellm-2", id: "deepseek-v4.1-flash" },
      tokens: { input: 0, output: 0, cache: { read: 0, write: 0 } },
      cost: 0,
    },
    {
      type: "assistant",
      model: { providerID: "unknown", id: "acme-private-2099" },
      tokens: { input: 1_000_000, output: 0, cache: { read: 0, write: 0 } },
      cost: 1.23,
    },
    {
      type: "compaction",
      status: "running",
      model: { providerID: "litellm-2", id: "deepseek-v4.1-flash" },
      tokens: { input: 1_000_000, output: 0, cache: { read: 0, write: 0 } },
      cost: 99,
    },
  ]
  const stats = buildCost(messages, book)
  assert.equal(stats.steps, 2)
  assert.equal(stats.estimated, 2)
  assert.equal(stats.fallback, 1)
  assert.ok(Math.abs(stats.total - (0.00097884 + 1.23)) < 1e-12)
  // Two assistant steps plus the completed compaction call were priced.
  assert.ok(Math.abs(stats.average - stats.total / 3) < 1e-12)
})

test("a book rebuilt from host entries resolves the same rates", () => {
  const original = buildPriceBook(raw)
  assert.ok(original)
  const rebuilt = buildPriceBookFromEntries(JSON.parse(JSON.stringify(original.entries)))
  assert.ok(rebuilt)
  assert.deepEqual(
    priceOf(rebuilt, "litellm-2", "deepseek-v4.1-flash"),
    priceOf(original, "litellm-2", "deepseek-v4.1-flash"),
  )
  assert.deepEqual(
    priceOf(rebuilt, "openrouter", "deepseek/deepseek-v4.1-flash"),
    priceOf(original, "openrouter", "deepseek/deepseek-v4.1-flash"),
  )
  assert.equal(buildPriceBookFromEntries([{ provider: "acme", model: "broken" }]), undefined)
})
