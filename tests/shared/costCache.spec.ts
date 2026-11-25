import assert from "node:assert/strict"
import { test } from "vitest"
import { loadPriceBook } from "../../src/shared/cost.ts"

test("a failed catalogue fetch backs off for 30 seconds", async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    throw new Error("offline")
  }) as typeof fetch
  try {
    assert.equal(await loadPriceBook(), undefined)
    assert.equal(await loadPriceBook(), undefined)
    assert.equal(calls, 1)
  } finally {
    globalThis.fetch = original
  }
})
