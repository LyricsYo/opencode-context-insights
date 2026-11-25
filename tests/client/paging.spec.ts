import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { growOnScroll, LIST_PAGE, MESSAGE_PAGE } from "../../src/client/paging.ts"

describe("growOnScroll", () => {
  const element = (scrollTop: number, clientHeight: number, scrollHeight: number) =>
    ({ currentTarget: { scrollTop, clientHeight, scrollHeight } as HTMLDivElement })

  test("grows one page when the list nears the bottom", () => {
    const sizes: number[] = []
    growOnScroll(element(900, 100, 1_000), 50, 200, (next) => sizes.push(next))
    assert.deepEqual(sizes, [100])
  })

  test("stays put away from the bottom or once everything is shown", () => {
    const sizes: number[] = []
    growOnScroll(element(0, 100, 1_000), 50, 200, (next) => sizes.push(next))
    growOnScroll(element(900, 100, 1_000), 200, 200, (next) => sizes.push(next))
    assert.deepEqual(sizes, [])
  })

  test("never grows past the total", () => {
    const sizes: number[] = []
    growOnScroll(element(900, 100, 1_000), 190, 200, (next) => sizes.push(next))
    assert.deepEqual(sizes, [200])
  })

  test("keeps the list page sizes", () => {
    assert.equal(LIST_PAGE, 50)
    assert.equal(MESSAGE_PAGE, 20)
  })
})
