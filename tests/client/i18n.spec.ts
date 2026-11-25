import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { i18n } from "../../src/client/i18n.ts"

describe("locale catalogs", () => {
  test("keeps the same key set in every language", () => {
    const english = Object.keys(i18n.en)
    const chinese = Object.keys(i18n.zh)
    assert.deepEqual(english.filter((key) => !(key in i18n.zh)), [])
    assert.deepEqual(chinese.filter((key) => !(key in i18n.en)), [])
  })

  test("keeps the English source copy non-empty", () => {
    assert.ok(Object.values(i18n.en).every((value) => value.trim() !== ""))
  })
})
