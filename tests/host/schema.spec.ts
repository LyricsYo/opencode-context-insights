import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { HEADER_STORAGE_VERSION, packValue, unpackValue } from "../../src/host/headers/schema.ts"

describe("header storage schema", () => {
  test("packs values with the current version", () => {
    assert.deepEqual(packValue({ a: 1 }), { v: HEADER_STORAGE_VERSION, value: { a: 1 } })
  })

  test("unpacks versioned, bare, null and array values", () => {
    assert.deepEqual(unpackValue({ v: 1, value: { a: 1 } }), { a: 1 })
    assert.deepEqual(unpackValue([1, 2]), [1, 2])
    assert.equal(unpackValue(null), undefined)
    assert.equal(unpackValue(undefined), undefined)
    assert.equal(unpackValue("text"), "text")
  })
})
