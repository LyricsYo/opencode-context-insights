import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { buildPriceBook, priceOf } from "../../src/shared/cost.ts"
import { priceModelId } from "../../src/shared/priceIdentity.ts"

describe("price lookup", () => {
  test("ignores gateway prefixes and variant suffixes", () => {
    const book = buildPriceBook({
      openai: { models: { "gpt-4o": { cost: { input: 2.5, output: 10 } } } },
      openrouter: { models: { "deepseek/deepseek-chat-v3": { cost: { input: 0.27, output: 1.1 } } } },
    })
    assert.ok(book)
    assert.equal(priceOf(book, "openai", "gpt-4o")?.input, 2.5)
    assert.equal(priceOf(book, "openai", "gpt-4o:free")?.input, 2.5)
    assert.equal(priceOf(book, "openai", "gpt-4o@default")?.input, 2.5)
    assert.equal(priceOf(book, "openrouter", "deepseek/deepseek-chat-v3:free")?.input, 0.27)
    assert.equal(priceOf(book, "openrouter", "@cf/meta/llama-3-8b")?.input, undefined)
    assert.equal(priceOf(book, "openai", "gpt-4o-v2")?.input, 2.5)
  })
})

describe("priceModelId", () => {
  test("strips only what the catalogue never uses", () => {
    assert.equal(priceModelId("gpt-4o"), "gpt-4o")
    assert.equal(priceModelId("gpt-4o:free"), "gpt-4o")
    assert.equal(priceModelId("gpt-4o:free:beta"), "gpt-4o")
    assert.equal(priceModelId("gpt-4o:beta:online"), "gpt-4o")
    assert.equal(priceModelId("@cf/meta/llama-3-8b"), "meta/llama-3-8b")
    assert.equal(priceModelId("us.anthropic.claude-3"), "anthropic.claude-3")
    assert.equal(priceModelId("hf:deepseek-ai/DeepSeek-V3"), "deepseek-ai/DeepSeek-V3")
    assert.equal(priceModelId("gpt-4o-v2"), "gpt-4o-v2")
  })
})
