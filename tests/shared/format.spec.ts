import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { clock, fmt, percent, percent2, span, stamp } from "../../src/shared/format.ts"

describe("fmt", () => {
  test("rounds small numbers and adds k/M suffixes at their thresholds", () => {
    assert.equal(fmt(0), "0")
    assert.equal(fmt(999.4), "999")
    assert.equal(fmt(1000), "1.0k")
    assert.equal(fmt(9999), "10.0k")
    assert.equal(fmt(10_000), "10k")
    assert.equal(fmt(12_800), "13k")
    assert.equal(fmt(1_000_000), "1.0M")
    assert.equal(fmt(-1500), "-1500")
  })
})

describe("percent", () => {
  test("rounds to whole percent and handles a zero total", () => {
    assert.equal(percent(1, 3), "33%")
    assert.equal(percent(1, 1), "100%")
    assert.equal(percent(0, 0), "—")
  })
})

describe("stamp", () => {
  test("keeps the full date and seconds", () => {
    assert.match(stamp(Date.UTC(2026, 10, 16, 8, 41, 7)), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })
})

describe("span", () => {
  test("formats milliseconds, seconds, minutes and hours", () => {
    assert.equal(span(500), "500ms")
    assert.equal(span(2500), "2.5s")
    assert.equal(span(65_000), "1m05s")
    assert.equal(span(3 * 3_600_000 + 10 * 60_000), "3h10m")
    assert.equal(span(undefined), "—")
  })
})

describe("clock", () => {
  test("keeps the date next to the time", () => {
    assert.match(clock(Date.UTC(2026, 10, 16, 8, 41)), /^\d{2}-\d{2} \d{2}:\d{2}$/)
  })
})

describe("percent2", () => {
  test("keeps two decimals and handles a zero total", () => {
    assert.equal(percent2(2, 3), "66.67%")
    assert.equal(percent2(1, 1), "100.00%")
    assert.equal(percent2(0, 0), "—")
  })
})
